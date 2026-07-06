// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {InternalGovernor} from "./InternalGovernor.sol";
import {Citizen} from "./Citizen.sol";
import {IENSPLUSModule} from "../interfaces/IENSPLUSModule.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title  ParticipationCredits — charter module `participation-credits` v1
/// @notice The base civic reward: every revealed internal ballot earns a fixed
///         credit grant, claimable once per (proposal, voter). Pure Tier-0:
///         a formula anyone can trigger, no governance in the loop.
///
/// @dev    Charter shape: P_READ (governor ballots) + P_CREDIT (Citizen mint).
///         Claiming is permissionless ON BEHALF of the voter — keepers may
///         batch-claim for citizens (the credit always lands on the voter).
///         Inverse-scaling epoch emission and streak multipliers are the
///         designed v2 of this module (autopilot §"inverse-scaling rewards");
///         v1 ships the flat, auditable base rate.
contract ParticipationCredits is IENSPLUSModule {
    InternalGovernor public immutable governor;
    Citizen public immutable citizen;

    uint256 public constant CREDIT_PER_VOTE = 100e18;

    mapping(uint256 proposalId => mapping(address voter => bool)) public claimed;

    event VoteCredited(uint256 indexed proposalId, address indexed voter, uint256 amount);

    error ZeroArg();
    error NotRevealed(uint256 proposalId, address voter);
    error AlreadyClaimed(uint256 proposalId, address voter);

    constructor(InternalGovernor governor_, Citizen citizen_) {
        if (address(governor_) == address(0) || address(citizen_) == address(0)) revert ZeroArg();
        governor = governor_;
        citizen = citizen_;
    }

    /// @notice Credit a revealed ballot. Permissionless; credit lands on the voter.
    function claim(uint256 proposalId, address voter) external {
        if (!governor.ballot(proposalId, voter).revealed) revert NotRevealed(proposalId, voter);
        if (claimed[proposalId][voter]) revert AlreadyClaimed(proposalId, voter);
        claimed[proposalId][voter] = true;
        citizen.mintCredits(voter, CREDIT_PER_VOTE);
        emit VoteCredited(proposalId, voter, CREDIT_PER_VOTE);
    }

    // ------------------------------------------------------- module identity
    function moduleId() external pure returns (string memory) {
        return "participation-credits";
    }

    function charterVersion() external pure returns (uint16) {
        return 1;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId
            || interfaceId == type(IENSPLUSModule).interfaceId;
    }
}
