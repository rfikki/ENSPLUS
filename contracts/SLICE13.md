# ENSPLUS Contracts — Slice 13: HumanAttestor + gwei-names hardening

Verified: 129/129 tests passing (slices 1–13) · cross-fuzz EVM ≡ JS mirror (now incl. verifiedHuman) · solc 0.8.26, zero warnings.

## Why
Benchmarked against gwei-names (an ownerless .gwei namespace with 3 audits,
gas snapshots, a TS SDK, and a zkPassport human registrar). ENSPLUS's core was
already at the same ownerless standard (immutable, no admin, feeless exit); this
slice adopts gwei-names' best ideas that ENSPLUS lacked.

## Contents
- `contracts/core/HumanAttestor.sol` — OWNERLESS zkPassport proof-of-humanity.
  One passport <-> one address (rebindable on wallet rotation), privacy-
  preserving (stores only the zk nullifier, never PII). No owner, no admin, no
  upgrade, no ETH; the ONLY state-changing entry point is claim() (asserted in
  test). Rejects unverified proofs, wrong scope/sender/chain, and dev-mode on
  mainnet. The apex sybil-proof complement to LibTrust's history signals.
- `contracts/test/Slice13Mocks.sol` — pure-mutability mock verifier + helper.
- LibTrust + mirror: added `verifiedHuman` input and a capped HUMANITY_BONUS
  (+2000 bps toward the cap). Cross-fuzz updated (verifiedHuman randomized).
- TrustOracle: reads HumanAttestor.isVerifiedHuman (optional; address(0) = off)
  and feeds it into the live reputation. Proven end-to-end: proving humanity
  lifts a member's live oracle reputation by the bonus.

## gwei-names improvements adopted (see docs/ADOPTED_IMPROVEMENTS.md)
- HumanAttestor (zkPassport one-human-one-identity) — this slice.
- `tools/ensplus-utils/` — the ENSPLUS SDK: EFP follows, ENS+EFP profile
  resolve + card render, and live reputation via the TrustOracle, one client,
  no hosted API. Smoke-tested (4/4).
- `tools/gas_snapshot.js` -> `.gas-snapshot` — deploy + key-call gas, so
  regressions are visible (the gwei-names practice).
- `tools/deploy.js` — deterministic genesis deploy blueprint; same deployer +
  nonces => same CREATE addresses on every chain. Dry-run deploys all 15
  contracts in the one dependency-satisfying order; the ModuleRegistry address
  prediction is asserted to match.

## Not adopted (deliberate)
solady/soledge + solc 0.8.30 (ENSPLUS pins OZ 5.1.0 + 0.8.26 for auditor
familiarity and toolchain stability; gas is negligible on L1 now). Fee-burning
(ENSPLUS routes fees to public goods per Article III via the immutable splitter,
not private extraction — a deliberate, non-extractive different choice).

## Still open (the real robustness gap)
External audit(s) + mainnet deployment. gwei-names has three audits and is live;
ENSPLUS has the threat model + invariants + cross-fuzz to be audit-ready but is
neither audited nor deployed. That remains the top genesis-gating item.
