// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IBaseRegistrar, INameWrapper} from "../core/NameVault.sol";

/// @dev TEST-ONLY BaseRegistrar: real ERC721 + reclaim recording.
contract MockBaseRegistrar is ERC721, IBaseRegistrar {
    mapping(uint256 => address) public registryController; // reclaim() effect

    constructor() ERC721("MockRegistrar", "MREG") {}

    function register(uint256 tokenId, address owner) external {
        _mint(owner, tokenId);
        registryController[tokenId] = owner;
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

/// @dev TEST-ONLY NameWrapper: real ERC1155 + fuse data + record approvals.
contract MockNameWrapper is ERC1155, INameWrapper {
    mapping(uint256 => uint32) public fusesOf;
    mapping(uint256 => uint64) public expiryOf;
    mapping(uint256 => address) public recordApproval;

    constructor() ERC1155("") {}

    function mintWrapped(uint256 id, address owner, uint32 fuses, uint64 expiry) external {
        _mint(owner, id, 1, "");
        fusesOf[id] = fuses;
        expiryOf[id] = expiry;
    }

    function getData(uint256 id) external view returns (address, uint32, uint64) {
        return (address(0), fusesOf[id], expiryOf[id]);
    }

    function approve(address to, uint256 tokenId) external {
        require(balanceOf(msg.sender, tokenId) == 1, "not holder");
        recordApproval[tokenId] = to;
    }

    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes memory data)
        public
        override(ERC1155, INameWrapper)
    {
        super.safeTransferFrom(from, to, id, amount, data);
    }

    /// @dev attack helper: push a token at the vault without its pull flow.
    function attackTransfer(address from, address to, uint256 id) external {
        _safeTransferFrom(from, to, id, 1, "");
    }
}
