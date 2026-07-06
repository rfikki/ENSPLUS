// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title  LibAttestation — historic-name attestation leaves for ENSPLUS
/// @notice Leaf format, hashing convention, proof verification, and read-time
///         rank/era semantics for the Registry of Elders attestation system.
///
/// @dev    DESIGN DECISIONS ENCODED HERE (traceable to project docs):
///         * Claim-based model (D4): contracts store only roots; holders submit
///           proofs. This library is the verification primitive.
///         * Leaf fields (migration spec §"Attestation leaf"): labelhash,
///           registrationTimestamp, ordinalRank, era, flags, leafVersion.
///         * HASHING CONVENTION: OpenZeppelin StandardMerkleTree —
///             leafHash = keccak256(bytes.concat(keccak256(abi.encode(...))))
///           The double-hash prevents second-preimage/internal-node confusion
///           and makes leaves directly compatible with the OpenZeppelin
///           merkle-tree JS library (npm: openzeppelin/merkle-tree) used by the derivation
///           pipeline (and by ensdomains/merkle-builder-style tooling).
///           JS side MUST encode the tuple as:
///             ["bytes32","uint40","uint32","uint8","uint16","uint8"]
///         * Rank tiers derive from ordinalRank AT READ TIME (D5) — never
///           stored — so tier thresholds can never drift from rank data.
///         * era==0 is a real value (Prepunk). Contracts MUST NOT use era==0
///           as an "unset" sentinel (LNR V5 lesson: the era=0 bug class).
///           Presence is proven by the Merkle proof itself, never by field
///           sentinels.
library LibAttestation {
    // ------------------------------------------------------------------ leaf
    struct Leaf {
        bytes32 labelhash;             // keccak256(raw registered label)
        uint40 registrationTimestamp;  // from original registrar event
        uint32 ordinalRank;            // global registration ordinal; 0 = unranked
        uint8 era;                     // Era enum below
        uint16 flags;                  // FLAG_* bitfield
        uint8 leafVersion;             // derivation version; genesis = 1
    }

    // ------------------------------------------------------------------ eras
    uint8 internal constant ERA_PREPUNK   = 0; // <= 2017-06-23 (CryptoPunks cutoff)
    uint8 internal constant ERA_AUCTION   = 1; // 2017-06-24 .. permanent-registrar migration
    uint8 internal constant ERA_PERMANENT = 2; // migration .. 2021-10-31 (airdrop snapshot)
    uint8 internal constant ERA_MODERN    = 3; // after
    uint8 internal constant ERA_MAX       = 3;

    // ----------------------------------------------------------------- flags
    uint16 internal constant FLAG_LABEL_UNKNOWN     = 1 << 0; // hash-only "blank"
    uint16 internal constant FLAG_RECOVERED         = 1 << 1; // preimage cracked post-derivation
    uint16 internal constant FLAG_CONTINUOUS        = 1 << 2; // continuous ownership attested
    uint16 internal constant FLAG_AIRDROP_FRANCHISE = 1 << 3; // registered before 2021-10-31 snapshot

    // ------------------------------------------------------------ rank tiers
    uint8 internal constant TIER_NONE    = 0;
    uint8 internal constant TIER_TOP_10K = 1;
    uint8 internal constant TIER_TOP_1K  = 2;
    uint8 internal constant TIER_TOP_100 = 3;

    // ---------------------------------------------------------------- errors
    error InvalidEra(uint8 era);

    // --------------------------------------------------------------- hashing
    /// @notice OZ StandardMerkleTree leaf hash of an attestation leaf.
    function leafHash(Leaf memory leaf) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        leaf.labelhash,
                        leaf.registrationTimestamp,
                        leaf.ordinalRank,
                        leaf.era,
                        leaf.flags,
                        leaf.leafVersion
                    )
                )
            )
        );
    }

    // ---------------------------------------------------------------- verify
    /// @notice Verify a leaf against a fixed root. Reverts on structurally
    ///         invalid era so malformed leaves can never verify "by accident"
    ///         against a colliding encoding.
    function verify(bytes32[] memory proof, bytes32 root, Leaf memory leaf)
        internal
        pure
        returns (bool)
    {
        if (leaf.era > ERA_MAX) revert InvalidEra(leaf.era);
        return MerkleProof.verify(proof, root, leafHash(leaf));
    }

    // ------------------------------------------------------------- semantics
    /// @notice Rank tier derived at read time (D5). rank==0 means unranked.
    function rankTier(uint32 ordinalRank) internal pure returns (uint8) {
        if (ordinalRank == 0) return TIER_NONE;
        if (ordinalRank <= 100) return TIER_TOP_100;
        if (ordinalRank <= 1000) return TIER_TOP_1K;
        if (ordinalRank <= 10_000) return TIER_TOP_10K;
        return TIER_NONE;
    }

    function hasFlag(Leaf memory leaf, uint16 flag) internal pure returns (bool) {
        return leaf.flags & flag != 0;
    }
}
