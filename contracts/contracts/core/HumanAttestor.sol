// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// ── zkPassport onchain-verification interfaces (docs.zkpassport.id). The
//    verifier is deployed at the same deterministic address on mainnet/Sepolia/
//    Base. Structs mirror the zkPassport SDK's compressed-evm proof shape.
//    (Interface pattern adapted from gwei-names' HumanRegistrar.) ──
struct ProofVerificationData {
    bytes32 vkeyHash;
    bytes proof;
    bytes32[] publicInputs;
}

struct ServiceConfig {
    uint256 validityPeriodInSeconds;
    string domain;
    string scope;
    bool devMode;
}

struct ProofVerificationParams {
    bytes32 version;
    ProofVerificationData proofVerificationData;
    bytes committedInputs;
    ServiceConfig serviceConfig;
}

struct BoundData {
    address senderAddress;
    uint256 chainId;
    string customData;
}

interface IZKPassportHelper {
    function verifyScopes(bytes32[] calldata publicInputs, string calldata domain, string calldata scope)
        external
        pure
        returns (bool);
    function getBoundData(bytes calldata committedInputs) external pure returns (BoundData memory);
}

interface IZKPassportVerifier {
    function verify(ProofVerificationParams calldata params)
        external
        returns (bool verified, bytes32 uniqueIdentifier, IZKPassportHelper helper);
}

/// @title  HumanAttestor — one verified human, one civic identity (ownerless)
/// @notice A privacy-preserving proof-of-humanity attestation for ENSPLUS.
///         A member proves, with a zkPassport proof bound to their address and
///         chain, that they are a unique human; the attestor records the
///         binding so the TrustOracle can treat them as sybil-proof. One
///         passport maps to one address (rebindable on wallet rotation), so a
///         sybil cannot manufacture verified humans — the apex complement to
///         LibTrust's history-based signals.
///
/// @dev    OWNERLESS by construction (the gwei-names standard):
///         * No owner, no admin, no upgrade, no pause. The only state is the
///           passport<->address bijection; the only writer is claim().
///         * The verifier address, app domain, scope, and dev-mode flag are
///           IMMUTABLE (set once at deploy; allowDevMode MUST be false on
///           mainnet — a dev-mode proof's certificate root is not in the
///           mainnet registry, so verify() reverts there regardless).
///         * No ETH ever touches this contract; nothing to extract.
///
///         PRIVACY: only the zkPassport `uniqueIdentifier` (a nullifier, not
///         passport data) is stored. The attestor learns "distinct human", not
///         who. No document details, no PII, ever on-chain.
contract HumanAttestor is ReentrancyGuard {
    /// @dev zkPassport verifier (immutable; mockable in tests).
    IZKPassportVerifier public immutable verifier;
    /// @dev App domain the proof is bound to (must match the serving origin).
    string public domain;
    /// @dev App scope (must match the frontend QR scope).
    string public constant SCOPE = "ensplus.citizen";
    /// @dev Accept dev-mode/mock proofs. MUST be false on mainnet.
    bool public immutable allowDevMode;

    /// @notice passport nullifier -> the address it is bound to.
    mapping(bytes32 uniqueIdentifier => address) public humanOf;
    /// @notice address -> its bound passport nullifier (0 = unverified).
    mapping(address human => bytes32) public passportOf;
    /// @notice Count of distinct verified humans (monotonic up; rebinds don't change it).
    uint256 public verifiedCount;

    event HumanityVerified(bytes32 indexed uniqueIdentifier, address indexed human);
    event HumanityRebound(bytes32 indexed uniqueIdentifier, address indexed from, address indexed to);

    error NotVerified();
    error WrongScope();
    error WrongSender();
    error WrongChain();
    error DevModeNotAllowed();
    error AddressBoundToAnotherPassport(bytes32 existing);
    error AlreadyBoundToCaller();

    constructor(IZKPassportVerifier verifier_, string memory domain_, bool allowDevMode_) {
        require(address(verifier_) != address(0), "verifier=0");
        verifier = verifier_;
        domain = domain_;
        allowDevMode = allowDevMode_;
    }

    /// @notice Prove humanity with a zkPassport proof bound to msg.sender on this
    ///         chain. Binds the passport to the caller. If the passport was
    ///         bound to another address (wallet rotation), it rebinds — the old
    ///         address loses its verified status (a human is in one place).
    function claim(ProofVerificationParams calldata params) external nonReentrant {
        // dev-mode fast-fail (real protection is the verifier's cert registry).
        if (!allowDevMode && params.serviceConfig.devMode) revert DevModeNotAllowed();

        (bool verified, bytes32 uid, IZKPassportHelper helper) = verifier.verify(params);
        if (!verified) revert NotVerified();
        if (!helper.verifyScopes(params.proofVerificationData.publicInputs, domain, SCOPE)) {
            revert WrongScope();
        }
        BoundData memory bound = helper.getBoundData(params.committedInputs);
        if (bound.senderAddress != msg.sender) revert WrongSender();
        if (bound.chainId != block.chainid) revert WrongChain();

        // caller must not already hold a DIFFERENT passport (one address, one human)
        bytes32 existing = passportOf[msg.sender];
        if (existing != 0) {
            if (existing == uid) revert AlreadyBoundToCaller();
            revert AddressBoundToAnotherPassport(existing);
        }

        address prev = humanOf[uid];
        if (prev == address(0)) {
            verifiedCount += 1;
            humanOf[uid] = msg.sender;
            passportOf[msg.sender] = uid;
            emit HumanityVerified(uid, msg.sender);
        } else {
            // rebind the passport to the new wallet; old address is cleared
            delete passportOf[prev];
            humanOf[uid] = msg.sender;
            passportOf[msg.sender] = uid;
            emit HumanityRebound(uid, prev, msg.sender);
        }
    }

    /// @notice Whether `account` is a verified unique human.
    function isVerifiedHuman(address account) external view returns (bool) {
        return passportOf[account] != 0;
    }
}
