// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IENSPLUSModule — minimal identity surface every chartered module
///        must expose. The ModuleRegistry verifies BOTH interface ids via
///        ERC-165 at registration (the LNR/GRDO supportsInterface lesson,
///        promoted to a registration gate).
interface IENSPLUSModule is IERC165 {
    /// @notice The module's charter slug (must match its registered manifest).
    function moduleId() external view returns (string memory);

    /// @notice The manifest version this deployment implements.
    function charterVersion() external view returns (uint16);
}
