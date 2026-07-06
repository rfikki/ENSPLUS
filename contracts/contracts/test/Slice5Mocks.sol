// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {INameRegistrar} from "../core/AttestorRegistry.sol";

/// @dev TEST-ONLY minimal registrar: tokenId => owner, settable.
contract MockRegistrar is INameRegistrar {
    mapping(uint256 => address) private _owners;

    function setOwner(uint256 tokenId, address owner) external {
        _owners[tokenId] = owner;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address o = _owners[tokenId];
        require(o != address(0), "nonexistent");
        return o;
    }
}

/// @dev TEST-ONLY external governor: records fractional casts for assertions.
contract MockExternalGovernor {
    mapping(uint256 => uint256) public snapshotOf;
    mapping(address => mapping(uint256 => uint256)) public votesAt;

    struct Cast {
        uint256 proposalId;
        uint8 support;
        string reason;
    }

    Cast public lastCast;
    uint256 public castCount;

    function setSnapshot(uint256 proposalId, uint256 timepoint) external {
        snapshotOf[proposalId] = timepoint;
    }

    function setVotes(address account, uint256 timepoint, uint256 votes) external {
        votesAt[account][timepoint] = votes;
    }

    function proposalSnapshot(uint256 proposalId) external view returns (uint256) {
        return snapshotOf[proposalId];
    }

    function getVotes(address account, uint256 timepoint) external view returns (uint256) {
        return votesAt[account][timepoint];
    }

    /// @dev Nominal Bravo cast (GovernorCountingSimple): full weight, one option.
    function castVoteWithReason(uint256 proposalId, uint8 support, string calldata reason)
        external
        returns (uint256)
    {
        lastCast = Cast(proposalId, support, reason);
        castCount++;
        return votesAt[msg.sender][snapshotOf[proposalId]];
    }
}
