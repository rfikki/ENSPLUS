// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {GovernorExecuted} from "./GovernorExecuted.sol";
import {InternalGovernor} from "./InternalGovernor.sol";

/// @dev ENS BaseRegistrar surface (tokenId = uint256(labelhash)).
interface IBaseRegistrar {
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
    /// @notice Sets the ENS Registry controller for the name. The vault calls
    ///         this toward the MEMBER on wrap-in so resolution control never
    ///         leaves them (decision D7).
    function reclaim(uint256 id, address owner) external;
}

/// @dev ENS NameWrapper surface (tokenId = uint256(namehash node)).
interface INameWrapper {
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
    function getData(uint256 id) external view returns (address owner, uint32 fuses, uint64 expiry);
    /// @notice Record-manager approval; the vault grants it to the MEMBER on
    ///         wrap-in so they keep managing records (D7 for wrapped names).
    function approve(address to, uint256 tokenId) external;
}

/// @dev Optional per-owner transfer/unwrap guard (SentinelLock). Consulted by
///      the vault at its two asset-exit points. Returns silently when the
///      caller/owner is unarmed; reverts when an armed owner's action has not
///      cleared its self-imposed timelock or is frozen. The guard is the
///      OWNER's opt-in self-protection — it is NOT governance, and it can never
///      block an unarmed exit, so covenant C4 (protocol cannot gate exit) holds.
interface ISentinel {
    function consumeTransfer(address from, address to, uint256 tokenId) external;
    function consumeUnwrap(address owner, uint256 tokenId) external;
}

/// @title  NameVault — dual-custody .eth name wrapper ("ENSPLUS Names")
/// @notice Members wrap names for Sentinel protection, Renewal Pool
///         enrollment, provenance claims, and Citizen identity — while their
///         resolution control NEVER leaves them.
///
/// @dev    COVENANTS (mirror of the token vault's C1–C4, verified in tests):
///         C1. OUTFLOW: underlying names leave only via (a) unwrap() to the
///             position owner, or (b) executeMigration() to the ratified
///             MigrationAdapter for positions the holder AFFIRMATIVELY elected
///             (invariant I8). No sweep, no rescue, no admin transfer.
///         C2. CONSERVATION: every live position corresponds 1:1 to an
///             underlying asset held, per custody class.
///         C3. NO PRIVILEGED MUTATION: no owner, no pause, no upgrade. The
///             migration slot is BORN EMPTY and can be filled exactly once,
///             only by a consumed Constitutional-kind proposal (Article X).
///         C4. EXIT SOVEREIGNTY: unwrap is feeless, queueless, pauseless, and
///             clears any pending migration election (exit supersedes
///             migration, Article IX).
///
///         CUSTODY CLASSES (migration spec §2.1):
///         * U-721: unwrapped .eth on the BaseRegistrar. tokenId =
///           uint256(labelhash). On wrap the vault takes registrar ownership
///           and immediately reclaim()s Registry control to the member —
///           resolver and records stay theirs; resolution is untouched.
///         * W-1155: v1-NameWrapper names. tokenId = uint256(namehash). Fuse
///           and expiry state snapshotted at wrap-in (determines the v2
///           wrapper-aware upgrade path, F7). The vault grants the member
///           NameWrapper record-manager approval on wrap-in.
///         * Position NFT id == underlying token id in its source contract;
///           custodyClass disambiguates the hash space.
///
///         PER-OWNER INDEX (D9): O(1)-maintained per-holder position lists;
///         no global enumeration surface exists anywhere in this contract.
///
///         v2Status (migration spec §2.1): LEGACY -> (electUpgrade/rescind by
///         holder) -> UPGRADE_ELECTED -> (adapter) -> UPGRADED. Silence means
///         LEGACY forever; legacy is a valid permanent home.
contract NameVault is ERC721, ReentrancyGuard, GovernorExecuted, IERC1155Receiver {
    // ---------------------------------------------------------------- config
    IBaseRegistrar public immutable registrar;
    INameWrapper public immutable nameWrapper;
    address public immutable feeSplitter;
    uint256 public immutable wrapFeeWei;

    bytes32 public constant ACTION_SET_MIGRATION_ADAPTER = keccak256("SET_MIGRATION_ADAPTER");
    bytes32 public constant ACTION_SET_SENTINEL = keccak256("SET_SENTINEL");

    /// @notice Born empty; fillable exactly once via Constitutional proposal.
    address public migrationAdapter;

    /// @notice Optional theft-protection guard (SentinelLock). Born empty;
    ///         fillable exactly once via Constitutional proposal. When unset,
    ///         the vault behaves exactly as before (no guarding).
    address public sentinel;

    // ------------------------------------------------------------- positions
    uint8 public constant CUSTODY_U721 = 1;
    uint8 public constant CUSTODY_W1155 = 2;

    uint8 public constant V2_LEGACY = 0;
    uint8 public constant V2_UPGRADE_ELECTED = 1;
    uint8 public constant V2_UPGRADED = 2;

    struct Position {
        uint8 custodyClass;
        uint8 v2Status;
        uint48 wrappedAt;
        uint32 fuseSnapshot;   // W-1155 only
        uint64 expirySnapshot; // W-1155 only
    }

    mapping(uint256 tokenId => Position) private _positions;
    uint256 public positionCount; // live positions (C2 accounting)

    // per-owner index (D9): O(1) updates, holder-bounded reads
    mapping(address owner => uint256[]) private _owned;
    mapping(uint256 tokenId => uint256) private _ownedIndex;

    // 1155 receive guard: nonzero only during our own pull
    uint256 private _expecting1155;

    // ---------------------------------------------------------------- events
    event NameWrapped(uint256 indexed tokenId, address indexed member, uint8 custodyClass, uint256 feePaid);
    event NameUnwrapped(uint256 indexed tokenId, address indexed member, uint8 custodyClass);
    event UpgradeElected(uint256 indexed tokenId, address indexed holder);
    event UpgradeRescinded(uint256 indexed tokenId, address indexed holder);
    event MigrationAdapterSet(address indexed adapter, uint256 proposalId);
    event PositionMigrated(uint256 indexed tokenId, address indexed adapter);
    event SentinelSet(address indexed sentinel, uint256 proposalId);

    // ---------------------------------------------------------------- errors
    error ZeroArg();
    error WrongFee(uint256 sent, uint256 required);
    error NotPositionOwner(uint256 tokenId, address caller);
    error UnknownPosition(uint256 tokenId);
    error UnsolicitedTransfer();
    error AdapterAlreadySet(address adapter);
    error SentinelAlreadySet(address sentinel);
    error AdapterNotSet();
    error NotMigrationAdapter(address caller);
    error NotElected(uint256 tokenId);
    error FeeForwardFailed();

    constructor(
        InternalGovernor governor_,
        IBaseRegistrar registrar_,
        INameWrapper nameWrapper_,
        address feeSplitter_,
        uint256 wrapFeeWei_
    ) ERC721("ENSPLUS Names", "ENS+N") GovernorExecuted(governor_) {
        if (
            address(registrar_) == address(0) || address(nameWrapper_) == address(0)
                || feeSplitter_ == address(0)
        ) revert ZeroArg();
        registrar = registrar_;
        nameWrapper = nameWrapper_;
        feeSplitter = feeSplitter_;
        wrapFeeWei = wrapFeeWei_;
    }

    // ------------------------------------------------------------ wrap flows
    /// @notice Wrap an unwrapped .eth name (registrar ERC-721). The member's
    ///         Registry control is restored in the same transaction (D7).
    function wrapName(uint256 tokenId) external payable nonReentrant {
        _takeFee();
        registrar.transferFrom(msg.sender, address(this), tokenId);
        // resolution control back to the member, atomically
        registrar.reclaim(tokenId, msg.sender);
        _open(tokenId, msg.sender, CUSTODY_U721, 0, 0);
    }

    /// @notice Wrap a v1-NameWrapper name (ERC-1155). Fuses and expiry are
    ///         snapshotted; the member keeps record-manager approval.
    function wrapWrappedName(uint256 tokenId) external payable nonReentrant {
        _takeFee();
        (, uint32 fuses, uint64 expiry) = nameWrapper.getData(tokenId);
        _expecting1155 = tokenId;
        nameWrapper.safeTransferFrom(msg.sender, address(this), tokenId, 1, "");
        _expecting1155 = 0;
        nameWrapper.approve(msg.sender, tokenId); // records stay theirs (D7)
        _open(tokenId, msg.sender, CUSTODY_W1155, fuses, expiry);
    }

    /// @notice Unwrap: return the underlying to the position owner. Feeless and
    ///         pauseless by the protocol. If the OWNER has opted into Sentinel
    ///         protection, their own self-imposed timelock applies here — the
    ///         protocol still never blocks exit (C4); the owner has chosen to
    ///         guard their own door and can always release it themselves.
    function unwrap(uint256 tokenId) external nonReentrant {
        if (ownerOf(tokenId) != msg.sender) revert NotPositionOwner(tokenId, msg.sender);
        if (sentinel != address(0)) ISentinel(sentinel).consumeUnwrap(msg.sender, tokenId);
        uint8 custody = _positions[tokenId].custodyClass;
        _close(tokenId);
        if (custody == CUSTODY_U721) {
            registrar.transferFrom(address(this), msg.sender, tokenId);
        } else {
            nameWrapper.safeTransferFrom(address(this), msg.sender, tokenId, 1, "");
        }
        emit NameUnwrapped(tokenId, msg.sender, custody);
    }

    // ------------------------------------------------------------- migration
    /// @notice Elect this position for the (future) ratified migration.
    ///         Holder-only; rescindable; silence = LEGACY forever.
    function electUpgrade(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotPositionOwner(tokenId, msg.sender);
        _positions[tokenId].v2Status = V2_UPGRADE_ELECTED;
        emit UpgradeElected(tokenId, msg.sender);
    }

    function rescindUpgrade(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotPositionOwner(tokenId, msg.sender);
        _positions[tokenId].v2Status = V2_LEGACY;
        emit UpgradeRescinded(tokenId, msg.sender);
    }

    /// @notice Fill the migration slot — exactly once, Constitutional kind
    ///         (Article X). Permissionless execution of the ratified decision.
    function setMigrationAdapter(uint256 proposalId, address adapter) external {
        if (adapter == address(0)) revert ZeroArg();
        if (migrationAdapter != address(0)) revert AdapterAlreadySet(migrationAdapter);
        _consumeProposal(
            proposalId,
            InternalGovernor.ProposalKind.Constitutional,
            ACTION_SET_MIGRATION_ADAPTER,
            keccak256(abi.encode(adapter))
        );
        migrationAdapter = adapter;
        emit MigrationAdapterSet(adapter, proposalId);
    }

    /// @notice Fill the sentinel slot — exactly once, Constitutional kind.
    ///         The sentinel is a member-opt-in guard; the protocol enabling the
    ///         slot does not itself restrict anyone (unarmed owners are never
    ///         gated), so exit sovereignty is preserved.
    function setSentinel(uint256 proposalId, address sentinel_) external {
        if (sentinel_ == address(0)) revert ZeroArg();
        if (sentinel != address(0)) revert SentinelAlreadySet(sentinel);
        _consumeProposal(
            proposalId,
            InternalGovernor.ProposalKind.Constitutional,
            ACTION_SET_SENTINEL,
            keccak256(abi.encode(sentinel_))
        );
        sentinel = sentinel_;
        emit SentinelSet(sentinel_, proposalId);
    }

    /// @notice Adapter-only, per-position, ELECTED-only underlying release
    ///         (covenant C1-b; invariant I8). The full M1–M5 verification
    ///         machinery lives in the adapter (Wave 3).
    function executeMigration(uint256 tokenId) external nonReentrant {
        if (migrationAdapter == address(0)) revert AdapterNotSet();
        if (msg.sender != migrationAdapter) revert NotMigrationAdapter(msg.sender);
        Position storage p = _position(tokenId);
        if (p.v2Status != V2_UPGRADE_ELECTED) revert NotElected(tokenId);
        uint8 custody = p.custodyClass;
        p.v2Status = V2_UPGRADED;
        if (custody == CUSTODY_U721) {
            registrar.transferFrom(address(this), migrationAdapter, tokenId);
        } else {
            nameWrapper.safeTransferFrom(address(this), migrationAdapter, tokenId, 1, "");
        }
        emit PositionMigrated(tokenId, migrationAdapter);
    }

    // ----------------------------------------------------------------- views
    function position(uint256 tokenId) external view returns (Position memory) {
        return _position(tokenId);
    }

    /// @notice All positions of `owner` — O(holder's own count), never global (D9).
    function positionsOf(address owner) external view returns (uint256[] memory) {
        return _owned[owner];
    }

    // ------------------------------------------------------------- internals
    function _takeFee() internal {
        if (msg.value != wrapFeeWei) revert WrongFee(msg.value, wrapFeeWei);
        if (msg.value > 0) {
            (bool ok,) = feeSplitter.call{value: msg.value}("");
            if (!ok) revert FeeForwardFailed();
        }
    }

    function _open(uint256 tokenId, address member, uint8 custody, uint32 fuses, uint64 expiry)
        internal
    {
        _positions[tokenId] = Position({
            custodyClass: custody,
            v2Status: V2_LEGACY,
            wrappedAt: uint48(block.timestamp),
            fuseSnapshot: fuses,
            expirySnapshot: expiry
        });
        positionCount += 1;
        _safeMint(member, tokenId);
        emit NameWrapped(tokenId, member, custody, msg.value);
    }

    function _close(uint256 tokenId) internal {
        delete _positions[tokenId];
        positionCount -= 1;
        _burn(tokenId);
    }

    function _position(uint256 tokenId) internal view returns (Position storage p) {
        p = _positions[tokenId];
        if (p.custodyClass == 0) revert UnknownPosition(tokenId);
    }

    /// @dev per-owner index maintenance (swap-and-pop), O(1) per transfer.
    ///      Member-to-member transfers consult the Sentinel guard when set;
    ///      mint (from==0) and burn (to==0) are never guarded here (wrap is not
    ///      an exit, and unwrap is guarded explicitly in unwrap()).
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address from)
    {
        from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0) && sentinel != address(0)) {
            ISentinel(sentinel).consumeTransfer(from, to, tokenId);
        }
        if (from != address(0)) {
            uint256[] storage list = _owned[from];
            uint256 idx = _ownedIndex[tokenId];
            uint256 lastId = list[list.length - 1];
            list[idx] = lastId;
            _ownedIndex[lastId] = idx;
            list.pop();
        }
        if (to != address(0)) {
            _ownedIndex[tokenId] = _owned[to].length;
            _owned[to].push(tokenId);
        }
    }

    // --------------------------------------------------------- receive guards
    /// @dev Accept 1155 transfers ONLY during our own pull; everything else is
    ///      an unsolicited transfer and reverts (fake-deposit guard, V4).
    function onERC1155Received(address operator, address, uint256 id, uint256, bytes calldata)
        external
        view
        returns (bytes4)
    {
        if (msg.sender != address(nameWrapper) || operator != address(this) || id != _expecting1155) {
            revert UnsolicitedTransfer();
        }
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert UnsolicitedTransfer();
    }

    // ---------------------------------------------------------------- ERC165
    /// @dev The complete interface set, declared and tested — the lesson from
    ///      LNR (line 382) and GRDO, never to be repeated.
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, IERC165)
        returns (bool)
    {
        return interfaceId == type(IERC1155Receiver).interfaceId
            || super.supportsInterface(interfaceId); // ERC165 + ERC721 + ERC721Metadata
    }
}
