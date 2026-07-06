# ENSPLUS Contracts — Slice 1: Pure Libraries

Delivered compiled (solc 0.8.26+commit.8a97fa7a, optimizer 200, cancun) and verified:
23/23 unit tests passing · 10,494 cross-fuzz checks, 0 mismatches.

## Contents
- `contracts/libraries/LibCategory.sol` — algorithmic category bitmap (bits 0..15): 999/10k/100k clubs, 3-letter, palindrome, repeated-char. Raw-label semantics (D6); non-ASCII → 0 by design.
- `contracts/libraries/LibAttestation.sol` — attestation leaf struct/hash (OZ StandardMerkleTree double-hash convention), Merkle verify, era & flag constants, read-time rank tiers (D5). Era 0 = Prepunk = real data, never a sentinel (LNR era-0 lesson).
- `contracts/libraries/LibWeight.sol` — quadratic weight (floor sqrt), snapshot cap (bps), linear vesting ramp, dormancy halving (per-3, floor 1/32), composeWeight with 4x parameter fat-finger ceiling. Overflow-safe by construction (documented bound).
- `contracts/test/Harnesses.sol` — external wrappers, test-only.
- `test/*.test.js` — Hardhat/mocha unit suites (chai matchers incl. custom-error asserts).
- `tools/build.js` — offline-safe compile (npm solc → Hardhat artifacts).
- `tools/fuzz.js` — independent BigInt mirrors diffed vs EVM (LibDinoSeed methodology). `FUZZ_N=5000 npm run fuzz` for deeper runs.

## On your machine
    npm install
    npx hardhat test        # compiles with real solc 0.8.26, runs suite
    npm run fuzz            # cross-fuzz (after any compile)

## JS leaf encoding (derivation pipeline MUST match)
    StandardMerkleTree.of(leaves, ["bytes32","uint40","uint32","uint8","uint16","uint8"])
    // [labelhash, registrationTimestamp, ordinalRank, era, flags, leafVersion]

## Next slices
2: TokenVault + Covenants + RevenueSplitter (invariants I1–I4 as tests)
3: InternalGovernor (consumes LibWeight; commit-reveal, snapshots, Policy A/B)
4: ConstitutionRegistry + ModuleRegistry + Standing Orders engine
