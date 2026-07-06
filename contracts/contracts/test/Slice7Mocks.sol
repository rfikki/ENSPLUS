// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IRenewalExecutor} from "../core/RenewalPool.sol";

/// @dev TEST-ONLY renewal executor: enforces exact payment (pricePerYear x
///      years), tracks expiries, records call history.
contract MockRenewalExecutor is IRenewalExecutor {
    uint256 public immutable pricePerYear;
    mapping(uint256 => uint64) public expiryOf;
    uint256 public renewCalls;
    uint256 public totalReceived;

    constructor(uint256 pricePerYear_) {
        pricePerYear = pricePerYear_;
    }

    function renew(uint256 tokenId, uint256 numYears) external payable returns (uint64) {
        require(msg.value == pricePerYear * numYears, "wrong renewal payment");
        if (expiryOf[tokenId] == 0) expiryOf[tokenId] = uint64(block.timestamp);
        expiryOf[tokenId] += uint64(numYears * 365 days);
        renewCalls++;
        totalReceived += msg.value;
        return expiryOf[tokenId];
    }
}
