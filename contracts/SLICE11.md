# ENSPLUS Contracts — Slice 11: LibTrust (L1-native reputation)

Verified: 118/118 tests passing (slices 1–11) · cross-fuzz EVM ≡ JS mirror (400 cases) · solc 0.8.26, zero warnings.

## Why
The EFP-based trust graph depended on Base + a winding-down protocol (ethid.org).
LibTrust replaces it with a reputation signal composed ENTIRELY from mainnet
data ENSPLUS already owns — no social graph, no Base, no third party. With L1
gas now negligible, building identity from owned on-chain primitives is both
cheaper to operate and strictly harder to game.

## Contents
- `contracts/libraries/LibTrust.sol` — pure library. Composes four sub-scores
  (each 0..10000 bps) into a bounded reputation, then a [1.0x, 1.25x] multiplier:
  * PROVENANCE (weight 4000) — era band (Modern 1e18 .. Prepunk 4e18) + rank
    tier. The apex anti-sybil signal: costs 2017, not tokens.
  * TENURE (2500) — time wrapped (2y = full) + banked renewal years. Costs time.
  * PARTICIPATION (3000) — consistency (share of epochs voted) + volume
    (distinct active epochs) + credits earned. Costs sustained effort.
  * CATEGORY (500) — unspoofable algorithmic club bits (popcount).
- `contracts/test/LibTrustHarness.sol` — TEST-ONLY external wrappers.
- `tools/libtrust_mirror.mjs` — independent BigInt reimplementation (written
  from spec, not from the Solidity) for cross-fuzzing.

## The property that matters
SYBIL RESISTANCE BY CONSTRUCTION: a fresh-wallet sybil has no provenance, no
tenure, no participation, no category -> reputation 0 -> multiplier exactly
1.0x (tested). This is the same guarantee the EFP graph gave (bought followers =
1.0x) but with ZERO external dependency and strictly harder to game — none of
the inputs can be minted on demand; they must be earned or aged into. A prepunk
veteran (2017 name, rank 42, 3y tenure, 18/20 epochs voted, 1500 credits) earns
a high score but the multiplier stays capped at +25% (D11).

## Scope / wiring
LibTrust is an identity/standing signal for the social + airdrop + guild layer.
Feeding it into governance weight remains a SEPARATE, T2-gated, two-key decision
(exactly as the EFP score was) to avoid double-counting provenance already in
the vote-weight composition. The thin aggregator that reads live inputs
(AttestorRegistry era/rank, InternalGovernor epochs, RenewalPool banked years,
Citizen credits, LibCategory bits) and calls this library is the next wiring
step — the scoring math is now fixed and verified.

## Cross-fuzz
400 random input vectors diffed between the EVM harness and the JS mirror, zero
mismatches — the LibWeight/LibDinoSeed methodology applied to reputation.
