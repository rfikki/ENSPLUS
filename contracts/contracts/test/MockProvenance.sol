// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IProvenanceSource} from "../core/InternalGovernor.sol";

/// @dev TEST-ONLY provenance source with settable multipliers.
contract MockProvenance is IProvenanceSource {
    mapping(address => uint256) public provenanceWad;

    function set(address account, uint256 wad) external {
        provenanceWad[account] = wad;
    }
}
