// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {InternalGovernor} from "./InternalGovernor.sol";

/// @title  GovernorExecuted — execute-by-proposal base
/// @notice Contracts inheriting this actuate governance decisions WITHOUT the
///         governor holding an execution engine or any admin key existing:
///         anyone may call an execution function, which verifies that a
///         Succeeded internal proposal of sufficient kind EXACTLY authorized
///         this payload on this contract, then consumes the proposal.
///
/// @dev    PAYLOAD BINDING: the proposal's descriptionHash must equal
///           keccak256(abi.encode(address(this), actionTag, payloadHash))
///         which binds the decision to (target contract, action, exact content)
///         — no cross-contract replay, no payload substitution, and each
///         proposal executes at most once (consumed).
///         KIND ORDERING: Override < Standard < Treasury < Constitutional; a
///         higher-kind proposal may authorize a lower-kind action (>=).
abstract contract GovernorExecuted {
    InternalGovernor public immutable governor;

    mapping(uint256 proposalId => bool) public proposalConsumed;

    event ProposalExecuted(uint256 indexed proposalId, bytes32 indexed actionTag, address executor);

    error ZeroGovernor();
    error ProposalNotSucceeded(uint256 proposalId);
    error ProposalKindTooLow(uint8 have, uint8 need);
    error PayloadMismatch(bytes32 expected, bytes32 actual);
    error ProposalAlreadyConsumed(uint256 proposalId);

    constructor(InternalGovernor governor_) {
        if (address(governor_) == address(0)) revert ZeroGovernor();
        governor = governor_;
    }

    /// @notice The descriptionHash a proposal must carry to authorize
    ///         (actionTag, payloadHash) on this contract.
    function expectedDescriptionHash(bytes32 actionTag, bytes32 payloadHash)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(address(this), actionTag, payloadHash));
    }

    function _consumeProposal(
        uint256 proposalId,
        InternalGovernor.ProposalKind minKind,
        bytes32 actionTag,
        bytes32 payloadHash
    ) internal {
        if (proposalConsumed[proposalId]) revert ProposalAlreadyConsumed(proposalId);
        if (governor.outcome(proposalId) != InternalGovernor.Outcome.Succeeded) {
            revert ProposalNotSucceeded(proposalId);
        }
        InternalGovernor.Proposal memory p = governor.proposal(proposalId);
        if (uint8(p.kind) < uint8(minKind)) revert ProposalKindTooLow(uint8(p.kind), uint8(minKind));
        bytes32 expected = expectedDescriptionHash(actionTag, payloadHash);
        if (p.descriptionHash != expected) revert PayloadMismatch(expected, p.descriptionHash);
        proposalConsumed[proposalId] = true;
        emit ProposalExecuted(proposalId, actionTag, msg.sender);
    }
}
