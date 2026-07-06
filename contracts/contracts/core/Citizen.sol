// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ENSPLUSVault} from "./ENSPLUSVault.sol";
import {NameVault} from "./NameVault.sol";
import {ModuleRegistry} from "./ModuleRegistry.sol";

/// @title  CitizenAccount — a minimal token-bound account for a Citizen NFT
/// @notice Holds assets and acts on behalf of one Citizen: whoever owns the
///         Citizen NFT controls the account. Because the account is an
///         ADDRESS, the wider identity stack can attach to it — following a
///         CitizenAccount on EFP means following the civic identity itself.
/// @dev    v1 is a spec-minimal token-bound account deployed via CREATE2 by
///         the Citizen contract (deterministic, predictable addresses).
///         FLAGGED: genesis should evaluate binding to the canonical ERC-6551
///         registry deployment instead, for maximal ecosystem composability —
///         the interface here (owner via NFT, gated execute) is the same shape.
contract CitizenAccount {
    address public immutable citizenContract;
    uint256 public immutable citizenId;

    event Executed(address indexed to, uint256 value, bytes data);

    error NotCitizenOwner(address caller);
    error CallFailed();

    constructor(address citizenContract_, uint256 citizenId_) {
        citizenContract = citizenContract_;
        citizenId = citizenId_;
    }

    receive() external payable {}

    function owner() public view returns (address) {
        return IERC721(citizenContract).ownerOf(citizenId);
    }

    function execute(address to, uint256 value, bytes calldata data)
        external
        returns (bytes memory result)
    {
        if (msg.sender != owner()) revert NotCitizenOwner(msg.sender);
        bool ok;
        (ok, result) = to.call{value: value}(data);
        if (!ok) revert CallFailed();
        emit Executed(to, value, data);
    }
}

/// @title  Citizen — the ENSPLUS civic identity ("ENSPLUS Citizens")
/// @notice One soulbound identity per member: badges, streaks, and CREDITS
///         live here; a deterministic token-bound account is deployed at mint
///         so the identity is a composable on-chain actor.
///
/// @dev    DESIGN DECISIONS ENCODED:
///         * ONE PER ADDRESS, SOULBOUND: the Citizen is an identity, not an
///           asset — transfers revert (there is no market for civic standing;
///           threat T4/T5: credits are unbuyable priority). Recovery for
///           rotated wallets is a designed later mechanism (guardians /
///           dead-man's-switch family), never transferability.
///         * MEMBERSHIP GATE: minting requires being a member — holding ENS+
///           or at least one NameVault position at mint time.
///         * CREDITS ARE CHARTER-GATED: only an ACTIVE ModuleRegistry module
///           holding P_CREDIT may mint credits — the manifest's permission
///           taxonomy enforced AT USE, not just at registration. Retire the
///           module and its minting stops the same block.
///         * tokenURI is the OZ default until the gallery module binds
///           (the Citizen's evolving artwork lands with the Specimen system).
contract Citizen is ERC721 {
    ENSPLUSVault public immutable tokenVault;
    NameVault public immutable nameVault;
    ModuleRegistry public immutable moduleRegistry;

    uint256 public citizenCount;
    mapping(address member => uint256) public citizenOf; // 0 = none
    mapping(uint256 citizenId => address) public accountOf;

    mapping(address member => uint256) public creditsOf;
    uint256 public totalCredits;

    event CitizenMinted(uint256 indexed citizenId, address indexed member, address account);
    event CreditsMinted(address indexed member, uint256 amount, address indexed module);

    error ZeroArg();
    error NotAMember(address caller);
    error AlreadyCitizen(address caller, uint256 citizenId);
    error Soulbound();
    error NotCreditModule(address caller);
    error NoCitizen(address member);

    constructor(ENSPLUSVault tokenVault_, NameVault nameVault_, ModuleRegistry moduleRegistry_)
        ERC721("ENSPLUS Citizens", "CITIZEN")
    {
        if (
            address(tokenVault_) == address(0) || address(nameVault_) == address(0)
                || address(moduleRegistry_) == address(0)
        ) revert ZeroArg();
        tokenVault = tokenVault_;
        nameVault = nameVault_;
        moduleRegistry = moduleRegistry_;
    }

    // ------------------------------------------------------------------ mint
    /// @notice Become a Citizen: one per address, member-gated, soulbound.
    ///         Deploys the token-bound account deterministically.
    function mintCitizen() external returns (uint256 citizenId, address account) {
        if (citizenOf[msg.sender] != 0) revert AlreadyCitizen(msg.sender, citizenOf[msg.sender]);
        if (tokenVault.balanceOf(msg.sender) == 0 && nameVault.balanceOf(msg.sender) == 0) {
            revert NotAMember(msg.sender);
        }
        citizenId = ++citizenCount;
        citizenOf[msg.sender] = citizenId;
        _safeMint(msg.sender, citizenId);

        account = address(
            new CitizenAccount{salt: bytes32(citizenId)}(address(this), citizenId)
        );
        accountOf[citizenId] = account;
        emit CitizenMinted(citizenId, msg.sender, account);
    }

    /// @notice Predict a citizen account address before it exists.
    function predictAccount(uint256 citizenId) external view returns (address) {
        bytes32 initHash = keccak256(
            abi.encodePacked(
                type(CitizenAccount).creationCode, abi.encode(address(this), citizenId)
            )
        );
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(bytes1(0xff), address(this), bytes32(citizenId), initHash)
                    )
                )
            )
        );
    }

    // --------------------------------------------------------------- credits
    /// @notice Mint soulbound credits to a Citizen. Callable ONLY by an ACTIVE
    ///         chartered module holding P_CREDIT (runtime charter check).
    function mintCredits(address member, uint256 amount) external {
        if (!moduleRegistry.hasActivePermission(msg.sender, moduleRegistry.P_CREDIT())) {
            revert NotCreditModule(msg.sender);
        }
        if (citizenOf[member] == 0) revert NoCitizen(member);
        creditsOf[member] += amount;
        totalCredits += amount;
        emit CreditsMinted(member, amount, msg.sender);
    }

    // ------------------------------------------------------------- soulbound
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound(); // mint-only
        return super._update(to, tokenId, auth);
    }
}
