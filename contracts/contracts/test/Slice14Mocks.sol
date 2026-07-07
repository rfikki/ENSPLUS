// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IENSRegistryRead} from "../core/CitizenResolver.sol";

/// @dev TEST-ONLY ENS registry: settable node owners.
contract MockENSRegistry is IENSRegistryRead {
    mapping(bytes32 => address) public owners;

    function setOwner(bytes32 node, address owner_) external {
        owners[node] = owner_;
    }

    function owner(bytes32 node) external view returns (address) {
        return owners[node];
    }
}
