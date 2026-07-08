// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {GovernorExecuted} from "./GovernorExecuted.sol";
import {InternalGovernor} from "./InternalGovernor.sol";
import {NameVault} from "./NameVault.sol";
import {IENSPLUSModule} from "../interfaces/IENSPLUSModule.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Renewal execution adapter (genesis: the wrapped-controller path per
///      decision D8 — the desync-safe UniversalRegistrarRenewalWithReferrer
///      pattern, referrer = pool). Swappable adapter slot by design.
interface IRenewalExecutor {
    /// @notice Renew `tokenId` (uint256(labelhash)) for `numYears`, paying
    ///         exactly msg.value. Returns the new expiry.
    function renew(uint256 tokenId, uint256 numYears) external payable returns (uint64 newExpiry);
}

/// @title  RenewalPool — the Eternal Flame (charter module `renewal-pool` v1)
/// @notice A fixed slice of protocol revenue keeps citizens' names alive.
///         Generosity is a pure function of the Coverage Ratio:
///
///           CR = pool balance / (enrolled names x base annual cost)
///
///         Tier ladder (autopilot Tier-0: formulas, never ballots):
///           EMBER   (CR < 0.25): raffle — K random enrolled names fully
///                                renewed per epoch.
///           KINDLED (0.25-0.5) : matching — member pays a year, pool adds one.
///           STEADY  (0.5-1.0)  : base coverage — keeper batches renew every
///                                enrolled name once per epoch.
///           ETERNAL (>= 1.0)   : coverage guaranteed; surplus above the
///                                eternal line tithes to public goods (Art VIII).
///
/// @dev    TIER-0 GUARANTEES (charter §2.3, executable here):
///         * Every mechanism above is formula + permissionless keeper call.
///         * Epoch spend cap: each pool epoch may spend at most SPEND_CAP_BPS
///           (25%) of the balance snapshotted at the epoch's first action —
///           a bad revenue quarter degrades tier gracefully, never to zero.
///         * BANKED YEARS: each executed renewal is registrar-level and
///           irreversible (threat R5 HARD claim); the pool records
///           yearsBanked per name as the on-chain scoreboard.
///         * Enrollment: NameVault position holders only, refundable bond,
///           per-citizen cap (anti-farming R1). Positions that leave the vault
///           are evictable by anyone (bond joins the pool).
///         * The ONLY governed surface is baseAnnualCostWei (Standard-kind
///           proposal — renewal pricing tracks ETH/USD) and the tithe
///           parameters are immutable. No owner, no pause; unenroll and
///           bond refund work in every state.
///         * RAFFLE RANDOMNESS: block.prevrandao (RANDAO) seeded per epoch.
///           Chosen over blockhash (weakest post-merge) and over Chainlink VRF
///           (an external dependency + funded subscription would cost the
///           protocol its ownerlessness) because the stakes are a single base
///           renewal — a validator must forgo block rewards to bias RANDAO, far
///           exceeding that reward. raffleDrawn[ep] blocks intra-epoch grinding.
///           If raffle prizes ever grow materially, VRF via a chartered module
///           amendment remains the upgrade path (DECISION D-RAFFLE, resolved).
contract RenewalPool is GovernorExecuted, ReentrancyGuard, IENSPLUSModule {
    // ---------------------------------------------------------------- config
    NameVault public immutable nameVault;
    IRenewalExecutor public immutable executor;
    address public immutable titheSink;

    uint256 public constant SPEND_CAP_BPS = 2500; // 25% per epoch
    uint256 public constant BPS = 10_000;
    uint256 public immutable titheBps;        // slice of eternal surplus per epoch
    uint256 public immutable enrollmentBond;
    uint256 public immutable maxEnrolledPerOwner;
    uint256 public immutable raffleWinnersPerEpoch;
    uint48 public immutable epochDuration;
    uint48 public immutable genesisTime;

    bytes32 public constant ACTION_SET_BASE_COST = keccak256("SET_BASE_ANNUAL_COST");

    /// @notice Base annual renewal cost in wei (5+ char rate). Governed:
    ///         Standard-kind proposal (tracks ETH/USD drift).
    uint256 public baseAnnualCostWei;

    // ------------------------------------------------------------ enrollment
    struct Enrollment {
        address enroller;
        uint48 enrolledAt;
        uint32 listIndex;
    }

    mapping(uint256 tokenId => Enrollment) private _enrollments;
    uint256[] private _enrolledList;
    mapping(address owner => uint256) public enrolledCountOf;

    // ----------------------------------------------------------- epoch state
    mapping(uint256 epoch => uint256) public epochBudget;    // snapshot; 0 = not opened
    mapping(uint256 epoch => uint256) public epochSpent;
    mapping(uint256 epoch => mapping(uint256 tokenId => bool)) public renewedInEpoch;
    mapping(uint256 epoch => bool) public raffleDrawn;

    mapping(uint256 tokenId => uint256) public yearsBanked;

    // ---------------------------------------------------------------- events
    event Enrolled(uint256 indexed tokenId, address indexed enroller);
    event Unenrolled(uint256 indexed tokenId, address indexed enroller, bool bondRefunded);
    event Evicted(uint256 indexed tokenId, address indexed caller);
    event EpochOpened(uint256 indexed epoch, uint256 budget, uint256 tithed);
    event Renewed(uint256 indexed tokenId, uint256 indexed epoch, uint256 years_, uint256 poolPaid, uint256 memberPaid, uint64 newExpiry);
    event RaffleDrawn(uint256 indexed epoch, uint256 winners);
    event BaseCostSet(uint256 newCostWei, uint256 proposalId);
    event Funded(address indexed from, uint256 amount);

    // ---------------------------------------------------------------- errors
    error ZeroArg();
    error NotPositionHolder(uint256 tokenId, address caller);
    error AlreadyEnrolled(uint256 tokenId);
    error NotEnrolled(uint256 tokenId);
    error EnrollCapReached(address owner, uint256 cap);
    error WrongBond(uint256 sent, uint256 required);
    error PositionStillLive(uint256 tokenId);
    error WrongTier(uint8 have, uint8 need);
    error AlreadyRenewedThisEpoch(uint256 tokenId);
    error EpochBudgetExhausted(uint256 epoch);
    error RaffleAlreadyDrawn(uint256 epoch);
    error WrongMatchPayment(uint256 sent, uint256 required);
    error EthTransferFailed();

    constructor(
        InternalGovernor governor_,
        NameVault nameVault_,
        IRenewalExecutor executor_,
        address titheSink_,
        uint256 baseAnnualCostWei_,
        uint256 titheBps_,
        uint256 enrollmentBond_,
        uint256 maxEnrolledPerOwner_,
        uint256 raffleWinnersPerEpoch_,
        uint48 epochDuration_
    ) GovernorExecuted(governor_) {
        if (
            address(nameVault_) == address(0) || address(executor_) == address(0)
                || titheSink_ == address(0) || baseAnnualCostWei_ == 0 || epochDuration_ == 0
                || maxEnrolledPerOwner_ == 0 || raffleWinnersPerEpoch_ == 0 || titheBps_ > BPS
        ) revert ZeroArg();
        nameVault = nameVault_;
        executor = executor_;
        titheSink = titheSink_;
        baseAnnualCostWei = baseAnnualCostWei_;
        titheBps = titheBps_;
        enrollmentBond = enrollmentBond_;
        maxEnrolledPerOwner = maxEnrolledPerOwner_;
        raffleWinnersPerEpoch = raffleWinnersPerEpoch_;
        epochDuration = epochDuration_;
        genesisTime = uint48(block.timestamp);
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    // ------------------------------------------------------------ enrollment
    /// @notice Enroll a NameVault position for coverage. Refundable bond;
    ///         per-owner cap (anti-farming R1).
    function enroll(uint256 tokenId) external payable nonReentrant {
        if (nameVault.ownerOf(tokenId) != msg.sender) revert NotPositionHolder(tokenId, msg.sender);
        if (_enrollments[tokenId].enroller != address(0)) revert AlreadyEnrolled(tokenId);
        if (enrolledCountOf[msg.sender] >= maxEnrolledPerOwner) {
            revert EnrollCapReached(msg.sender, maxEnrolledPerOwner);
        }
        if (msg.value != enrollmentBond) revert WrongBond(msg.value, enrollmentBond);

        _enrollments[tokenId] = Enrollment({
            enroller: msg.sender,
            enrolledAt: uint48(block.timestamp),
            listIndex: uint32(_enrolledList.length)
        });
        _enrolledList.push(tokenId);
        enrolledCountOf[msg.sender] += 1;
        emit Enrolled(tokenId, msg.sender);
    }

    /// @notice Unenroll and refund the bond. Works in every state (Tier-0).
    function unenroll(uint256 tokenId) external nonReentrant {
        Enrollment memory e = _enrolled(tokenId);
        if (nameVault.ownerOf(tokenId) != msg.sender) revert NotPositionHolder(tokenId, msg.sender);
        _remove(tokenId, e);
        _pay(msg.sender, enrollmentBond);
        emit Unenrolled(tokenId, e.enroller, true);
    }

    /// @notice Evict an enrollment whose position no longer exists in the
    ///         NameVault (unwrapped/migrated without unenrolling). Anyone may
    ///         call; the bond joins the pool.
    function evict(uint256 tokenId) external {
        Enrollment memory e = _enrolled(tokenId);
        try nameVault.ownerOf(tokenId) returns (address) {
            revert PositionStillLive(tokenId);
        } catch {
            _remove(tokenId, e);
            emit Evicted(tokenId, msg.sender);
        }
    }

    // ------------------------------------------------------- coverage & tier
    uint8 public constant TIER_EMBER = 0;
    uint8 public constant TIER_KINDLED = 1;
    uint8 public constant TIER_STEADY = 2;
    uint8 public constant TIER_ETERNAL = 3;

    /// @notice Annual renewal liability of all enrolled names, in wei.
    function annualLiability() public view returns (uint256) {
        return _enrolledList.length * baseAnnualCostWei;
    }

    /// @notice Coverage ratio, WAD (1e18 = 1.0). Empty pool with no names = 0.
    function coverageRatio() public view returns (uint256) {
        uint256 liability = annualLiability();
        if (liability == 0) return 0;
        return (address(this).balance * 1e18) / liability;
    }

    function tier() public view returns (uint8) {
        uint256 cr = coverageRatio();
        if (cr >= 1e18) return TIER_ETERNAL;
        if (cr >= 5e17) return TIER_STEADY;
        if (cr >= 25e16) return TIER_KINDLED;
        return TIER_EMBER;
    }

    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - genesisTime) / epochDuration;
    }

    function enrolledCount() external view returns (uint256) {
        return _enrolledList.length;
    }

    function enrollment(uint256 tokenId) external view returns (Enrollment memory) {
        return _enrolled(tokenId);
    }

    // --------------------------------------------------------------- renewals
    /// @notice Keeper batch: base-rate renewals at STEADY or ETERNAL, one per
    ///         name per epoch, within the epoch budget.
    function renewBatch(uint256[] calldata tokenIds) external nonReentrant {
        uint8 t = tier();
        if (t < TIER_STEADY) revert WrongTier(t, TIER_STEADY);
        uint256 ep = _openEpoch();
        uint256 cost = baseAnnualCostWei;
        for (uint256 i = 0; i < tokenIds.length; ++i) {
            uint256 id = tokenIds[i];
            _enrolled(id);
            if (renewedInEpoch[ep][id]) revert AlreadyRenewedThisEpoch(id);
            if (epochSpent[ep] + cost > epochBudget[ep]) revert EpochBudgetExhausted(ep);
            renewedInEpoch[ep][id] = true;
            epochSpent[ep] += cost;
            uint64 newExpiry = executor.renew{value: cost}(id, 1);
            yearsBanked[id] += 1;
            emit Renewed(id, ep, 1, cost, 0, newExpiry);
        }
    }

    /// @notice KINDLED matching: the member pays a year, the pool adds a year.
    function matchRenew(uint256 tokenId) external payable nonReentrant {
        if (tier() != TIER_KINDLED) revert WrongTier(tier(), TIER_KINDLED);
        _enrolled(tokenId);
        if (nameVault.ownerOf(tokenId) != msg.sender) revert NotPositionHolder(tokenId, msg.sender);
        uint256 cost = baseAnnualCostWei;
        if (msg.value != cost) revert WrongMatchPayment(msg.value, cost);
        uint256 ep = _openEpoch();
        if (renewedInEpoch[ep][tokenId]) revert AlreadyRenewedThisEpoch(tokenId);
        if (epochSpent[ep] + cost > epochBudget[ep]) revert EpochBudgetExhausted(ep);
        renewedInEpoch[ep][tokenId] = true;
        epochSpent[ep] += cost;
        uint64 newExpiry = executor.renew{value: cost * 2}(tokenId, 2);
        yearsBanked[tokenId] += 2;
        emit Renewed(tokenId, ep, 2, cost, cost, newExpiry);
    }

    /// @notice EMBER raffle: renew up to K pseudo-random enrolled names, once
    ///         per epoch. Randomness is block.prevrandao (RANDAO); once-per-epoch
    ///         guard prevents grinding. (DECISION D-RAFFLE.)
    function raffleDraw() external nonReentrant {
        if (tier() != TIER_EMBER) revert WrongTier(tier(), TIER_EMBER);
        uint256 ep = _openEpoch();
        if (raffleDrawn[ep]) revert RaffleAlreadyDrawn(ep);
        raffleDrawn[ep] = true;
        uint256 n = _enrolledList.length;
        if (n == 0) return;
        uint256 cost = baseAnnualCostWei;
        uint256 winners;
        bytes32 seed = keccak256(abi.encode(block.prevrandao, ep, address(this)));
        for (uint256 k = 0; k < raffleWinnersPerEpoch && winners < n; ++k) {
            if (epochSpent[ep] + cost > epochBudget[ep]) break;
            uint256 id = _enrolledList[uint256(keccak256(abi.encode(seed, k))) % n];
            if (renewedInEpoch[ep][id]) continue;
            renewedInEpoch[ep][id] = true;
            epochSpent[ep] += cost;
            uint64 newExpiry = executor.renew{value: cost}(id, 1);
            yearsBanked[id] += 1;
            winners++;
            emit Renewed(id, ep, 1, cost, 0, newExpiry);
        }
        emit RaffleDrawn(ep, winners);
    }

    // ------------------------------------------------------------ governance
    /// @notice Re-price the base annual cost (ETH/USD drift) via a Succeeded
    ///         Standard-kind proposal binding the exact value.
    function setBaseAnnualCost(uint256 proposalId, uint256 newCostWei) external {
        if (newCostWei == 0) revert ZeroArg();
        _consumeProposal(
            proposalId,
            InternalGovernor.ProposalKind.Standard,
            ACTION_SET_BASE_COST,
            keccak256(abi.encode(newCostWei))
        );
        baseAnnualCostWei = newCostWei;
        emit BaseCostSet(newCostWei, proposalId);
    }

    // ------------------------------------------------------------- internals
    /// @dev Lazily opens the current epoch: tithe the eternal surplus first,
    ///      then snapshot the 25% spend budget.
    function _openEpoch() internal returns (uint256 ep) {
        ep = currentEpoch();
        if (epochBudget[ep] != 0) return ep;
        // eternal-surplus tithe (Article VIII pattern)
        uint256 liability = annualLiability();
        if (liability > 0 && address(this).balance > liability) {
            uint256 surplus = address(this).balance - liability;
            uint256 tithed = (surplus * titheBps) / BPS;
            if (tithed > 0) {
                _pay(titheSink, tithed);
                emit EpochOpened(ep, 0, tithed); // budget event follows below
            }
        }
        uint256 budget = (address(this).balance * SPEND_CAP_BPS) / BPS;
        epochBudget[ep] = budget == 0 ? 1 : budget; // 1 wei sentinel = opened-but-empty
        emit EpochOpened(ep, epochBudget[ep], 0);
    }

    function _enrolled(uint256 tokenId) internal view returns (Enrollment storage e) {
        e = _enrollments[tokenId];
        if (e.enroller == address(0)) revert NotEnrolled(tokenId);
    }

    function _remove(uint256 tokenId, Enrollment memory e) internal {
        uint256 lastId = _enrolledList[_enrolledList.length - 1];
        _enrolledList[e.listIndex] = lastId;
        _enrollments[lastId].listIndex = e.listIndex;
        _enrolledList.pop();
        delete _enrollments[tokenId];
        enrolledCountOf[e.enroller] -= 1;
    }

    function _pay(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    // ------------------------------------------------------- module identity
    function moduleId() external pure returns (string memory) {
        return "renewal-pool";
    }

    function charterVersion() external pure returns (uint16) {
        return 1;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId
            || interfaceId == type(IENSPLUSModule).interfaceId;
    }
}
