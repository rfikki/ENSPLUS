// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IBaseRegistrar} from "../core/NameVault.sol";

/// @dev TEST-ONLY BaseRegistrar with expiry (ENS nameExpires surface) plus the
///      IBaseRegistrar custody surface the NameVault needs.
contract MockExpiryRegistrar is ERC721, IBaseRegistrar {
    mapping(uint256 => address) public registryController;
    mapping(uint256 => uint256) public expiries;

    constructor() ERC721("MockExpiryRegistrar", "MEXR") {}

    function register(uint256 tokenId, address owner) external {
        _mint(owner, tokenId);
        registryController[tokenId] = owner;
    }

    function setExpiry(uint256 tokenId, uint256 expiry) external {
        expiries[tokenId] = expiry;
    }

    function nameExpires(uint256 tokenId) external view returns (uint256) {
        return expiries[tokenId];
    }

    function reclaim(uint256 id, address owner) external {
        require(msg.sender == ownerOf(id), "not registrar owner");
        registryController[id] = owner;
    }

    function ownerOf(uint256 tokenId) public view override(ERC721, IBaseRegistrar) returns (address) {
        return super.ownerOf(tokenId);
    }

    function transferFrom(address from, address to, uint256 tokenId)
        public
        override(ERC721, IBaseRegistrar)
    {
        super.transferFrom(from, to, tokenId);
    }
}
