# ENSPLUS — Pre-audit Code-Affecting Decisions (RESOLVED)

The four open decisions that could still change audited code, now settled. Each
records the problem, the options, the resolution, and where it landed in code.

---

## D-POLICY — per-holder Policy A/B accounting vs whole-bloc casting
**Problem.** Should the bloc's EXTERNAL vote weight each holder's silent weight
by their Policy A (follow Standing Orders) / Policy B (abstain) election?

**Resolution — whole-bloc directional; Policy A/B recorded but not composed (v1).**
The live ENS governor is GovernorCountingSimple (no fractional voting, see
D12/GovernorAdapter), so a per-holder split of silent weight CANNOT be expressed
externally at all. Composing silent weight per-policy *internally* would add
snapshot-timing and gaming surface — the opposite of what we want right before an
audit. v1 treats ALL silent weight as ABSTAIN (never speaks for the silent;
honours the covenant "never auto-votes on people"). The `silentPolicy` registry
stays as a recorded UI signal and the ratified-activation hook for a future
fractional-capable era.
**Code:** `InternalGovernor.SilentPolicy` natspec marked RESERVED/not-composed.

## D-CAP — capBps vs community size (the flattening finding)
**Problem.** A fixed per-identity cap hits "≤2% per identity" only at one
community size; smaller communities flatten (everyone equal), larger ones let a
whale exceed 2%.

**Resolution — fixed genesis parameter, conservative lean; no adaptive cap.**
holderCount-adaptive caps are rejected (dust wallets could grind holderCount to
move the cap). The relationship capBps ≈ 0.02·√N·10000 is documented so genesis
sets capBps from the adoption model, leaning LOW (whale-resistant): under-shooting
flattens toward egalitarian (acceptable, even on-mission), over-shooting leaks
whale power (the risk direction to avoid). Hard-bounded (1, BPS] at construction.
**Code:** `InternalGovernor.capBps` natspec documents the rule + rejection.

## D-RAFFLE — RenewalPool raffle randomness (blockhash vs VRF)
**Problem.** The EMBER raffle used `blockhash` (weakest post-merge source).

**Resolution — block.prevrandao (RANDAO); no external VRF.** Stakes are a single
base renewal, so a funded Chainlink VRF subscription would cost the protocol its
ownerlessness for no real benefit; `blockhash` is too weak. `block.prevrandao`
raises the bar to "a validator forgoes block rewards to bias one renewal," and
the once-per-epoch guard blocks intra-epoch grinding. VRF via a chartered module
amendment stays the upgrade path IF raffle prizes ever grow materially.
**Code:** `RenewalPool.raffleDraw` seed = `keccak256(block.prevrandao, ep, this)`.

## D-DERIVATION — era/rank freeze (LibAttestation semantics)
**Problem.** Freeze the era/rank semantics before generating the genesis Merkle
root. **This surfaced a real bug:** `LibTrust.provenanceScore` used rank bands
999/9999/99999 while `LibAttestation.rankTier` (the canonical D5 semantic) uses
100/1000/10000 — two definitions that would drift.

**Resolution — single canonical rank tier.** `LibTrust` now calls
`LibAttestation.rankTier` and maps TOP_100/TOP_1K/TOP_10K → 3000/2000/1000, with
ranks outside the top-10k carrying no rank bonus (era still counts). One source
of truth; drift impossible. The frozen off-chain derivation rules the dry-run
must implement are in `FROZEN_DERIVATION_SPEC.md`.
**Code:** `LibTrust.provenanceScore` uses `LibAttestation.rankTier`; JS mirror +
tests aligned. (137→144 tests all green.)

---

*All four resolved with the discipline of NOT adding mechanism before audit: one
strict improvement (RANDAO), one real bug fix (rank reconciliation), two
decisions locked as documented policy. The audited code is now final on these.*
