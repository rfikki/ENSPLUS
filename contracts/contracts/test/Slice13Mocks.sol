// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IZKPassportVerifier,
    IZKPassportHelper,
    ProofVerificationParams,
    BoundData
} from "../core/HumanAttestor.sol";

/// @dev TEST-ONLY helper. Keeps the interface's pure mutability by decoding the
///      scope flag + bound data straight out of `committedInputs`/publicInputs,
///      which the test encodes. publicInputs[0] != 0 => scope ok.
contract MockZKHelper is IZKPassportHelper {
    function verifyScopes(bytes32[] calldata publicInputs, string calldata, string calldata)
        external
        pure
        returns (bool)
    {
        return publicInputs.length > 0 && publicInputs[0] != bytes32(0);
    }

    function getBoundData(bytes calldata committedInputs) external pure returns (BoundData memory) {
        (address sender, uint256 chainId) = abi.decode(committedInputs, (address, uint256));
        return BoundData({senderAddress: sender, chainId: chainId, customData: ""});
    }
}

/// @dev TEST-ONLY verifier: returns a configurable (verified, uid) + the helper.
contract MockZKVerifier is IZKPassportVerifier {
    bool public ok = true;
    bytes32 public uid;
    MockZKHelper public helper;

    constructor(MockZKHelper helper_) {
        helper = helper_;
    }

    function set(bool ok_, bytes32 uid_) external {
        ok = ok_;
        uid = uid_;
    }

    function verify(ProofVerificationParams calldata)
        external
        view
        returns (bool, bytes32, IZKPassportHelper)
    {
        return (ok, uid, helper);
    }
}
