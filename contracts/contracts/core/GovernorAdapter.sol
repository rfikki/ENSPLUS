// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {InternalGovernor} from "./InternalGovernor.sol";
import {StandingOrders} from "./StandingOrders.sol";
import {ENSPLUSVault} from "./ENSPLUSVault.sol";
import {GovernorExecuted} from "./GovernorExecuted.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @dev External-governor surface the adapter targets: the REAL ENS DAO
///      governor (governor.ensdao.eth, an OpenZeppelin Governor deployed
///      Nov 2021 using GovernorCountingSimple / Bravo-compatible counting).
///      That module casts a delegate's FULL weight to ONE option per proposal;
///      it predates GovernorCountingFractional, so proportional/fractional
///      casting is NOT available. The adapter therefore casts DIRECTIONALLY.
///      support follows Bravo: 0 = Against, 1 = For, 2 = Abstain.
///      The adapter is a ratified, swappable slot: if ENS ever migrates to a
///      fractional-capable governor, swap this binding for true proportional
///      mirror without touching the core (verify current governor pre-genesis).
interface INominalExternalGovernor {
    function proposalSnapshot(uint256 proposalId) external view returns (uint256);
    function getVotes(address account, uint256 timepoint) external view returns (uint256);
    function castVoteWithReason(uint256 proposalId, uint8 support, string calldata reason)
        external
        returns (uint256);
}


/// @title  GovernorAdapter — the bloc's external voice (directional)
/// @notice Composes ENSPLUS's vote on an external (ENS DAO) proposal from the
///         internal tally and the Standing Orders, then casts the vault's FULL
///         delegated power in ONE direction (For / Against / Abstain).
///
/// @dev    WHY DIRECTIONAL, NOT PROPORTIONAL: the live ENS governor uses
///         GovernorCountingSimple (full weight, one option) and predates
///         fractional counting. "Mirror mode" therefore mirrors the internal
///         DECISION, not the internal SPLIT. This is also strictly MORE
///         effective as a counterweight: a bloc that splits its own vote is
///         weaker at changing outcomes; full weight behind the winning
///         position maximises impact.
///
///         COMPOSITION:
///         * Internal quorum REACHED -> MIRROR the decision:
///             - decisive = for + against weight (abstain picks no side).
///             - winnerShare = max(for,against) / decisive.
///             - if the vote is a tie OR winnerShare < confidenceThresholdBps,
///               cast ABSTAIN externally (a divided bloc does not ram a narrow
///               majority onto the DAO); else cast the winner (For/Against).
///         * Internal quorum FAILED  -> STANDING ORDER: classified -> cast the
///           SO position at full power; unclassified -> ABSTAIN (never guess).
///         Minorities are protected by (a) having voted internally, (b) the
///         abstain-on-division threshold, and (c) rage-quit exit before the
///         cast binds them.
///
///         BINDING: a mirror requires the internal proposal's descriptionHash
///         to bind THIS adapter + the external id. ORDERING: first cast wins
///         per external id.
///
///         DIVERGENCE FLAG (unchanged from v1): the autopilot spec composes
///         silent weight per-holder (Policy A follows SO, Policy B abstains);
///         v1 casts the whole bloc by the rules above. Per-policy aggregate
///         accounting needs vault/governor hooks not yet wired — decide at
///         genesis parameter review.
contract GovernorAdapter {
    bytes32 public constant ACTION_EXTERNAL_VOTE = keccak256("EXTERNAL_VOTE");

    uint8 public constant SUPPORT_AGAINST = 0;
    uint8 public constant SUPPORT_FOR = 1;
    uint8 public constant SUPPORT_ABSTAIN = 2;
    uint256 public constant BPS = 10_000;

    InternalGovernor public immutable governor;
    StandingOrders public immutable orders;
    INominalExternalGovernor public immutable externalGovernor;

    /// @notice Minimum winner share of decisive (for+against) weight required to
    ///         cast a direction; below it the bloc abstains externally. Bounded
    ///         [5000, 10000] (>= simple majority). Tuned at genesis.
    uint256 public immutable confidenceThresholdBps;

    enum CastMode {
        None,
        Mirror,
        StandingOrder,
        AbstainDefault
    }

    mapping(uint256 externalId => CastMode) public castModeOf;
    mapping(uint256 externalId => uint8) public supportOf;

    event ExternalCast(
        uint256 indexed externalId,
        uint256 indexed internalId,
        CastMode mode,
        uint8 support,
        uint256 power
    );

    error ZeroArg();
    error BadThreshold(uint256 bps);
    error AlreadyCast(uint256 externalId);
    error InternalNotEnded(uint256 internalId);
    error WrongBinding(bytes32 expected, bytes32 actual);
    error NoExternalPower();

    constructor(
        InternalGovernor governor_,
        StandingOrders orders_,
        INominalExternalGovernor externalGovernor_,
        uint256 confidenceThresholdBps_
    ) {
        if (
            address(governor_) == address(0) || address(orders_) == address(0)
                || address(externalGovernor_) == address(0)
        ) revert ZeroArg();
        if (confidenceThresholdBps_ < 5000 || confidenceThresholdBps_ > BPS) {
            revert BadThreshold(confidenceThresholdBps_);
        }
        governor = governor_;
        orders = orders_;
        externalGovernor = externalGovernor_;
        confidenceThresholdBps = confidenceThresholdBps_;
    }

    /// @notice descriptionHash an internal proposal must carry to speak for
    ///         `externalId` through this adapter.
    function externalBindingHash(uint256 externalId) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), ACTION_EXTERNAL_VOTE, externalId));
    }

    /// @notice Cast the bloc's vote on `externalId` from the Ended internal
    ///         proposal bound to it. Permissionless (keeper job).
    function castMirror(uint256 internalId, uint256 externalId) external {
        if (castModeOf[externalId] != CastMode.None) revert AlreadyCast(externalId);
        if (governor.state(internalId) != InternalGovernor.ProposalState.Ended) {
            revert InternalNotEnded(internalId);
        }
        InternalGovernor.Proposal memory p = governor.proposal(internalId);
        bytes32 expected = externalBindingHash(externalId);
        if (p.descriptionHash != expected) revert WrongBinding(expected, p.descriptionHash);

        (uint8 support, CastMode mode) = _decide(internalId, externalId);
        _cast(externalId, internalId, support, mode);
    }

    /// @notice Cast by Standing Order alone (no internal proposal). Keepers use
    ///         this for externals nobody opened a live vote on.
    function castStandingOrder(uint256 externalId) external {
        if (castModeOf[externalId] != CastMode.None) revert AlreadyCast(externalId);
        (uint8 support, CastMode mode) = _standingOrderPosition(externalId);
        _cast(externalId, 0, support, mode);
    }

    // ------------------------------------------------------------- internals
    function _decide(uint256 internalId, uint256 externalId)
        internal
        view
        returns (uint8 support, CastMode mode)
    {
        if (!governor.quorumReached(internalId)) {
            return _standingOrderPosition(externalId);
        }
        InternalGovernor.Tally memory t = governor.tally(internalId);
        uint256 decisive = t.forWeight + t.againstWeight;
        if (decisive == 0 || t.forWeight == t.againstWeight) {
            return (SUPPORT_ABSTAIN, CastMode.Mirror); // all-abstain or tie
        }
        bool forWins = t.forWeight > t.againstWeight;
        uint256 winner = forWins ? t.forWeight : t.againstWeight;
        if ((winner * BPS) / decisive < confidenceThresholdBps) {
            return (SUPPORT_ABSTAIN, CastMode.Mirror); // too divided to speak
        }
        return (forWins ? SUPPORT_FOR : SUPPORT_AGAINST, CastMode.Mirror);
    }

    function _standingOrderPosition(uint256 externalId)
        internal
        view
        returns (uint8 support, CastMode mode)
    {
        (uint8 pos, bool classified) = orders.positionFor(bytes32(externalId));
        if (!classified) return (SUPPORT_ABSTAIN, CastMode.AbstainDefault);
        if (pos == orders.POS_FOR()) return (SUPPORT_FOR, CastMode.StandingOrder);
        if (pos == orders.POS_AGAINST()) return (SUPPORT_AGAINST, CastMode.StandingOrder);
        return (SUPPORT_ABSTAIN, CastMode.StandingOrder);
    }

    function _power(uint256 externalId) internal view returns (uint256 power) {
        uint256 snap = externalGovernor.proposalSnapshot(externalId);
        power = externalGovernor.getVotes(address(this), snap);
        if (power == 0) revert NoExternalPower();
    }

    function _cast(uint256 externalId, uint256 internalId, uint8 support, CastMode mode) internal {
        uint256 power = _power(externalId);
        castModeOf[externalId] = mode;
        supportOf[externalId] = support;
        externalGovernor.castVoteWithReason(
            externalId,
            support,
            "ENSPLUS constitutional bloc: direction composed per internal tally and standing orders (SO-M3)"
        );
        emit ExternalCast(externalId, internalId, mode, support, power);
    }
}

/// @title  VaultSteward — the vault's one governed knob, governed properly
/// @notice The ENSPLUSVault's immutable `governor` address points HERE, and
///         this contract re-points the vault's underlying delegation only when
///         a Succeeded internal proposal (Override kind suffices — delegatee
///         direction is T0-legal) binds the exact new delegatee.
///         Genesis ceremony: the steward's address is precomputed (deployment
///         nonce or CREATE2) so the vault can be constructed first.
contract VaultSteward is GovernorExecuted {
    bytes32 public constant ACTION_REDIRECT = keccak256("REDIRECT_DELEGATEE");

    ENSPLUSVault public immutable vault;

    event DelegateeRedirected(uint256 indexed proposalId, address newDelegatee);

    error ZeroVault();

    constructor(InternalGovernor governor_, ENSPLUSVault vault_) GovernorExecuted(governor_) {
        if (address(vault_) == address(0)) revert ZeroVault();
        vault = vault_;
    }

    /// @notice Execute a ratified delegatee redirection. Permissionless.
    function redirectDelegatee(uint256 proposalId, address newDelegatee) external {
        _consumeProposal(
            proposalId,
            InternalGovernor.ProposalKind.Override,
            ACTION_REDIRECT,
            keccak256(abi.encode(newDelegatee))
        );
        vault.setDelegatee(newDelegatee);
        emit DelegateeRedirected(proposalId, newDelegatee);
    }
}
