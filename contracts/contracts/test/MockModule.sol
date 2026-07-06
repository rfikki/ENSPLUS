// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IENSPLUSModule} from "../interfaces/IENSPLUSModule.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @dev TEST-ONLY module implementations for ModuleRegistry checks.
contract MockModule is IENSPLUSModule {
    string private _id;

    constructor(string memory id) {
        _id = id;
    }

    function moduleId() external view returns (string memory) {
        return _id;
    }

    function charterVersion() external pure returns (uint16) {
        return 1;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId
            || interfaceId == type(IENSPLUSModule).interfaceId;
    }
}

/// @dev Declares ERC-165 but NOT the module interface — the LNR/GRDO bug class.
contract BadInterfaceModule {
    function moduleId() external pure returns (string memory) {
        return "bad";
    }

    function charterVersion() external pure returns (uint16) {
        return 1;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId; // module id missing
    }
}
