# ENSPLUS Contracts — Slice 12: TrustOracle (LibTrust, live)

Verified: 121/121 tests passing (slices 1–12) · solc 0.8.26, optimizer 200, cancun, zero warnings.

## Contents
- `contracts/core/TrustOracle.sol` — a pure READ-ONLY aggregator (no state, no
  admin, no writes, no privileged surface) that makes LibTrust live. It gathers
  a member's L1-native reputation inputs from the five sources ENSPLUS already
  owns and returns reputation / multiplier / a full breakdown. Designed to be
  called via eth_call by the dApp / indexer, so the O(epochs) participation scan
  is free (view, never a tx).
  * inputsOf / reputationOf / multiplierOf / breakdownOf(member, label)
  * Anchored to a name the member presents by LABEL (self-verifying preimage of
    the labelhash/tokenId).
- `contracts/core/AttestorRegistry.sol` — added `boundRank` persistence (rank is
  now stored per bound claim, mirroring boundEra), so rank is a live signal.
  Slice-5 attestor tests unchanged (8/8).

## Signal sourcing (faithful to each contract's real read surface)
- PROVENANCE (era + rank): only behind an attestation binding
  (attestor.boundTo == member). Era 0 = Prepunk is trusted ONLY behind that
  binding — the LNR "0 is real, not a sentinel" rule enforced at the boundary
  (an unbound name never reads as Prepunk; proven in test 1).
- CATEGORY: LibCategory over the presented label (algorithmic, unspoofable).
- TENURE + BANKED YEARS: only for a position the member CURRENTLY owns in the
  vault (guards against stale attestation bindings) — NameVault.position.wrappedAt
  and RenewalPool.yearsBanked.
- PARTICIPATION: scanned from the governor's activeInEpoch mapping, anchored to
  the member's TRUE first active epoch (scan from 0), so the consistency
  denominator cannot be gamed by a caller-chosen window.
- CREDITS: Citizen.creditsOf (member-level).

## Verified live behavior
- A stranger asking about a name they neither own nor attested -> reverts
  (NotMembersName). An owned-but-unattested 999-club name scores category only,
  provenance 0 (era 0 not trusted without a binding).
- Claiming a 2017 prepunk name (era 0, rank 1) maxes provenance (7000 era +
  3000 rank = 10000), lifts reputation, and the multiplier stays <= +25% (cap
  holds). Rank is now persisted on-chain (boundRank).
- Voting across epochs lifts the participation sub-score and total reputation.
- Every test also asserts the oracle reproduces LibTrust's exact composition
  (weights + cap), i.e. the live wiring matches the fuzzed math from Slice 11.

## Scope / next
The oracle is read-only and unwired to governance by design; consuming the
multiplier as a (T2-gated, two-key) governance-weight modifier remains a
separate decision (avoids double-counting provenance already in vote weight).
Natural follow-ons: expose breakdownOf in the EIK profile card, and a
members-batch view for the guild/airdrop leaderboards.
