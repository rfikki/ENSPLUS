// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {GovernorExecuted} from "./GovernorExecuted.sol";
import {InternalGovernor} from "./InternalGovernor.sol";
import {ConstitutionRegistry} from "./ConstitutionRegistry.sol";

/// @title  StandingOrders — the constitution as executable voting policy
/// @notice Skeleton of the autopilot spec §5 pipeline: ratified standing
///         orders, keeper-posted classifications of external (ENS DAO)
///         proposals, a bonded challenge window that escalates to an Override
///         internal vote, and the conflict-rule position the GovernorAdapter
///         reads for Policy-A silent weight.
///
/// @dev    CONFLICT RULE (autopilot §5.2-5): when multiple finalized
///         classifications disagree, the most protective wins:
///         AGAINST > ABSTAIN > FOR. Unclassified externals default to ABSTAIN —
///         the system never guesses.
///         CHALLENGES: anyone may bond against a pending classification within
///         the window by opening an Override-kind internal proposal bound to
///         the classification id. Succeeded override => classification VOIDED,
///         bond refunded. Defeated/QuorumFailed => classification FINAL, bond
///         forfeited to the bondSink (splitter). Fail-to-policy: a challenged
///         classification that cannot resolve before the external deadline is
///         simply not final — silent weight abstains (never fail-to-silence
///         for already-final protective positions).
///         SO SET: genesis orders inscribed at construction (the ratified
///         rulebook); additions require Treasury-kind (T2) proposals.
contract StandingOrders is GovernorExecuted {
    uint8 public constant POS_AGAINST = 0;
    uint8 public constant POS_FOR = 1;
    uint8 public constant POS_ABSTAIN = 2;

    bytes32 public constant ACTION_ADD_ORDER = keccak256("ADD_STANDING_ORDER");
    bytes32 public constant ACTION_CHALLENGE = keccak256("CHALLENGE_CLASSIFICATION");

    enum CStatus {
        None,
        Pending,     // posted, window open
        Final,       // window elapsed unchallenged, or challenge defeated
        Challenged,  // override proposal live
        Voided       // override succeeded
    }

    struct Order {
        uint8 position; // POS_*
        uint16[] articleIds;
        bytes32 criteriaHash; // ruleset document hash
        bool active;
        uint256 ratifiedByProposal; // 0 = genesis
    }

    struct Classification {
        bytes32 externalId; // ENS DAO proposal identifier (id/hash)
        uint32 orderId;
        address poster;
        uint48 postedAt;
        CStatus status;
        address challenger;
        uint256 challengeProposalId;
    }

    ConstitutionRegistry public immutable constitution;
    uint48 public immutable challengeWindow;
    uint256 public immutable challengeBond;
    address public immutable bondSink; // forfeited bonds (genesis: RevenueSplitter)

    Order[] private _orders; // index 0 unused
    Classification[] private _classifications; // index 0 unused

    /// @dev finalized position bits per external proposal: bit0 AGAINST,
    ///      bit1 FOR, bit2 ABSTAIN.
    mapping(bytes32 externalId => uint8) public finalPositionBits;

    event OrderInscribed(uint32 indexed orderId, uint8 position, bytes32 criteriaHash, uint256 proposalId);
    event ClassificationPosted(uint256 indexed classificationId, bytes32 indexed externalId, uint32 orderId, address poster);
    event ClassificationChallenged(uint256 indexed classificationId, address challenger, uint256 overrideProposalId);
    event ClassificationFinalized(uint256 indexed classificationId, bytes32 indexed externalId, uint8 position);
    event ClassificationVoided(uint256 indexed classificationId);
    event BondForfeited(uint256 indexed classificationId, uint256 amount);
    event BondRefunded(uint256 indexed classificationId, uint256 amount);

    error ZeroArg();
    error BadPosition(uint8 position);
    error ArticleNotInForce(uint16 articleId);
    error UnknownOrder(uint32 orderId);
    error OrderInactive(uint32 orderId);
    error UnknownClassification(uint256 id);
    error NotPending(uint256 id);
    error WindowClosed(uint256 id);
    error WindowStillOpen(uint256 id);
    error WrongBond(uint256 sent, uint256 required);
    error WrongChallengeBinding();
    error OverrideNotEnded(uint256 proposalId);
    error EthTransferFailed();

    struct GenesisOrder {
        uint8 position;
        uint16[] articleIds;
        bytes32 criteriaHash;
    }

    /// @dev Scalars grouped to keep the constructor's ABI decoder within
    ///      stack limits (same pattern as InternalGovernor.Config).
    struct Config {
        InternalGovernor governor;
        ConstitutionRegistry constitution;
        uint48 challengeWindow;
        uint256 challengeBond;
        address bondSink;
    }

    constructor(Config memory cfg, GenesisOrder[] memory genesisOrders)
        GovernorExecuted(cfg.governor)
    {
        if (address(cfg.constitution) == address(0) || cfg.bondSink == address(0)) revert ZeroArg();
        if (cfg.challengeWindow == 0) revert ZeroArg();
        constitution = cfg.constitution;
        challengeWindow = cfg.challengeWindow;
        challengeBond = cfg.challengeBond;
        bondSink = cfg.bondSink;
        _orders.push(); // burn 0
        _classifications.push(); // burn 0
        for (uint256 i = 0; i < genesisOrders.length; ++i) {
            _inscribe(genesisOrders[i].position, genesisOrders[i].articleIds, genesisOrders[i].criteriaHash, 0);
        }
    }

    // ---------------------------------------------------------------- orders
    /// @notice Add a standing order via a Succeeded Treasury-kind (T2) proposal.
    function addOrder(
        uint256 proposalId,
        uint8 position,
        uint16[] calldata articleIds,
        bytes32 criteriaHash
    ) external returns (uint32 orderId) {
        _consumeProposal(
            proposalId,
            InternalGovernor.ProposalKind.Treasury,
            ACTION_ADD_ORDER,
            keccak256(abi.encode(position, articleIds, criteriaHash))
        );
        return _inscribe(position, articleIds, criteriaHash, proposalId);
    }

    function _inscribe(
        uint8 position,
        uint16[] memory articleIds,
        bytes32 criteriaHash,
        uint256 proposalId
    ) internal returns (uint32 orderId) {
        if (position > POS_ABSTAIN) revert BadPosition(position);
        if (articleIds.length == 0) revert ZeroArg();
        for (uint256 i = 0; i < articleIds.length; ++i) {
            if (!constitution.articleInForce(articleIds[i])) {
                revert ArticleNotInForce(articleIds[i]);
            }
        }
        _orders.push(
            Order({
                position: position,
                articleIds: articleIds,
                criteriaHash: criteriaHash,
                active: true,
                ratifiedByProposal: proposalId
            })
        );
        orderId = uint32(_orders.length - 1);
        emit OrderInscribed(orderId, position, criteriaHash, proposalId);
    }

    // -------------------------------------------------------- classification
    /// @notice Keeper job: classify an external proposal under a standing
    ///         order. Enters the challenge window.
    function postClassification(bytes32 externalId, uint32 orderId)
        external
        returns (uint256 classificationId)
    {
        if (externalId == bytes32(0)) revert ZeroArg();
        Order storage o = _order(orderId);
        if (!o.active) revert OrderInactive(orderId);
        _classifications.push(
            Classification({
                externalId: externalId,
                orderId: orderId,
                poster: msg.sender,
                postedAt: uint48(block.timestamp),
                status: CStatus.Pending,
                challenger: address(0),
                challengeProposalId: 0
            })
        );
        classificationId = _classifications.length - 1;
        emit ClassificationPosted(classificationId, externalId, orderId, msg.sender);
    }

    /// @notice Bond against a pending classification within the window. The
    ///         challenger must have opened an Override internal proposal whose
    ///         descriptionHash binds this classification id.
    function challenge(uint256 classificationId, uint256 overrideProposalId) external payable {
        Classification storage c = _classification(classificationId);
        if (c.status != CStatus.Pending) revert NotPending(classificationId);
        if (block.timestamp >= c.postedAt + challengeWindow) revert WindowClosed(classificationId);
        if (msg.value != challengeBond) revert WrongBond(msg.value, challengeBond);

        InternalGovernor.Proposal memory p = governor.proposal(overrideProposalId);
        bytes32 expected = expectedDescriptionHash(ACTION_CHALLENGE, keccak256(abi.encode(classificationId)));
        if (p.descriptionHash != expected) revert WrongChallengeBinding();

        c.status = CStatus.Challenged;
        c.challenger = msg.sender;
        c.challengeProposalId = overrideProposalId;
        emit ClassificationChallenged(classificationId, msg.sender, overrideProposalId);
    }

    /// @notice Finalize an unchallenged classification after its window, OR
    ///         resolve a challenged one after its override vote ends.
    ///         Permissionless keeper job.
    function finalize(uint256 classificationId) external {
        Classification storage c = _classification(classificationId);

        if (c.status == CStatus.Pending) {
            if (block.timestamp < c.postedAt + challengeWindow) {
                revert WindowStillOpen(classificationId);
            }
            _finalizeInto(c, classificationId);
        } else if (c.status == CStatus.Challenged) {
            InternalGovernor.Outcome o = governor.outcome(c.challengeProposalId);
            if (o == InternalGovernor.Outcome.NotEnded) revert OverrideNotEnded(c.challengeProposalId);
            if (o == InternalGovernor.Outcome.Succeeded) {
                c.status = CStatus.Voided;
                emit ClassificationVoided(classificationId);
                _pay(c.challenger, challengeBond);
                emit BondRefunded(classificationId, challengeBond);
            } else {
                _finalizeInto(c, classificationId);
                _pay(bondSink, challengeBond);
                emit BondForfeited(classificationId, challengeBond);
            }
        } else {
            revert NotPending(classificationId);
        }
    }

    function _finalizeInto(Classification storage c, uint256 classificationId) internal {
        c.status = CStatus.Final;
        uint8 position = _orders[c.orderId].position;
        finalPositionBits[c.externalId] |= uint8(1 << position);
        emit ClassificationFinalized(classificationId, c.externalId, position);
    }

    // ----------------------------------------------------------------- reads
    /// @notice Policy-A default position for an external proposal, applying
    ///         the conflict rule (AGAINST > ABSTAIN > FOR). Unclassified =>
    ///         (ABSTAIN, classified=false) — the system never guesses.
    function positionFor(bytes32 externalId) external view returns (uint8 position, bool classified) {
        uint8 bits = finalPositionBits[externalId];
        if (bits == 0) return (POS_ABSTAIN, false);
        if (bits & (1 << POS_AGAINST) != 0) return (POS_AGAINST, true);
        if (bits & (1 << POS_ABSTAIN) != 0) return (POS_ABSTAIN, true);
        return (POS_FOR, true);
    }

    function order(uint32 orderId) external view returns (Order memory) {
        return _order(orderId);
    }

    function orderCount() external view returns (uint256) {
        return _orders.length - 1;
    }

    function classification(uint256 id) external view returns (Classification memory) {
        return _classification(id);
    }

    function _order(uint32 orderId) internal view returns (Order storage) {
        if (orderId == 0 || orderId >= _orders.length) revert UnknownOrder(orderId);
        return _orders[orderId];
    }

    function _classification(uint256 id) internal view returns (Classification storage) {
        if (id == 0 || id >= _classifications.length) revert UnknownClassification(id);
        return _classifications[id];
    }

    function _pay(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }
}
