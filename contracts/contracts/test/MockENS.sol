// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/// @title MockENS — test stand-in for the canonical ENS governance token.
/// @dev   Mirrors the relevant surface: plain ERC20 transfers + IVotes
///        delegation with checkpointed voting power. TEST-ONLY.
contract MockENS is ERC20, ERC20Permit, ERC20Votes {
    constructor() ERC20("Ethereum Name Service", "ENS") ERC20Permit("Ethereum Name Service") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    // ----- required overrides (OZ v5 multiple inheritance)
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}
