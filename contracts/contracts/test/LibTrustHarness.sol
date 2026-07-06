// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LibTrust} from "../libraries/LibTrust.sol";

/// @title LibTrust test harness (TEST-ONLY, never deployed to production).
contract LibTrustHarness {
    function provenanceScore(uint256 w, uint32 r) external pure returns (uint256) {
        return LibTrust.provenanceScore(w, r);
    }

    function tenureScore(uint64 s, uint32 b) external pure returns (uint256) {
        return LibTrust.tenureScore(s, b);
    }

    function participationScore(uint32 a, uint32 j, uint256 c) external pure returns (uint256) {
        return LibTrust.participationScore(a, j, c);
    }

    function categoryScore(uint16 b) external pure returns (uint256) {
        return LibTrust.categoryScore(b);
    }

    function reputation(LibTrust.TrustInputs calldata t) external pure returns (uint256) {
        return LibTrust.reputation(t);
    }

    function trustMultiplierWad(LibTrust.TrustInputs calldata t) external pure returns (uint256) {
        return LibTrust.trustMultiplierWad(t);
    }
}
