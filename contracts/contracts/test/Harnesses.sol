// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibCategory} from "../libraries/LibCategory.sol";
import {LibAttestation} from "../libraries/LibAttestation.sol";
import {LibWeight} from "../libraries/LibWeight.sol";

/// @title Slice-1 test harnesses
/// @notice Thin external wrappers so unit tests and the JS cross-fuzz harness
///         can exercise the internal library functions on a real EVM.
///         TEST-ONLY: never deployed to production.

contract CategoryHarness {
    function categoryBits(bytes calldata label) external pure returns (uint256) {
        return LibCategory.categoryBits(label);
    }
}

contract AttestationHarness {
    function leafHash(LibAttestation.Leaf calldata leaf) external pure returns (bytes32) {
        return LibAttestation.leafHash(leaf);
    }

    function verify(bytes32[] calldata proof, bytes32 root, LibAttestation.Leaf calldata leaf)
        external
        pure
        returns (bool)
    {
        return LibAttestation.verify(proof, root, leaf);
    }

    function rankTier(uint32 rank) external pure returns (uint8) {
        return LibAttestation.rankTier(rank);
    }

    function hasFlag(LibAttestation.Leaf calldata leaf, uint16 flag) external pure returns (bool) {
        return LibAttestation.hasFlag(leaf, flag);
    }
}

contract WeightHarness {
    function quadraticWeight(uint256 balance) external pure returns (uint256) {
        return LibWeight.quadraticWeight(balance);
    }

    function cappedWeight(uint256 weight, uint256 total, uint256 capBps) external pure returns (uint256) {
        return LibWeight.cappedWeight(weight, total, capBps);
    }

    function vestingWad(uint256 elapsed, uint256 period) external pure returns (uint256) {
        return LibWeight.vestingWad(elapsed, period);
    }

    function dormancyWad(uint256 missed) external pure returns (uint256) {
        return LibWeight.dormancyWad(missed);
    }

    function composeWeight(uint256 balance, uint256 prov, uint256 vest, uint256 dorm)
        external
        pure
        returns (uint256)
    {
        return LibWeight.composeWeight(balance, prov, vest, dorm);
    }
}
