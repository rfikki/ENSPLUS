# ENSPLUS — Project Checklist
**As of:** 2026-07-09 · **Test status:** 146/146 passing (slices 1–14 + hardening) · cross-fuzz EVM ≡ JS mirror, 0 mismatches · solc 0.8.26, zero warnings

---

## ✅ FINISHED — design documents
- [x] `ENSPLUS_OVERVIEW.md` — plain-language TL;DR, mission/vision, 8 problems / 8 fixes, full feature catalog, honest guarantees table, glossary (START HERE)
- [x] `ENSPLUS_ENSV2_MIGRATION_SPEC.md` — v2 facts, custody classes (U-721/W-1155, Mode A/B), adapter architecture, MigrationAdapter envelope (M1–M5)
- [x] `ENSPLUS_AUTOPILOT_SPEC.md` — tier ladder T0–T3, Tier-0 autonomy table, Standing Orders SO-1..10 + SO-M1..3, Custodian Mode, Policy A/B
- [x] `ENSPLUS_THREAT_MODEL.md` — 14 adversaries, ~45 threats, strength classes, invariants I1–I10, claims register (§11)
- [x] `ENSPLUS_MODULE_MANIFEST_SPEC.md` — charter format, permission taxonomy, tier-gated ratification, machine checks
- [x] `ENSPLUS_SOCIAL_MODULE_CHARTER.md` — first charter instance (+ dependency-resilience section: EFP/EIK/Grails optional-with-fallback)
- [x] `ADOPTED_IMPROVEMENTS.md` — gwei-names benchmark: verdict + what was adopted / deferred
- [x] `README.md` — project index, decisions log, reuse map, roadmap

## ✅ FINISHED — contracts (146/146 tests)
- [x] **Slice 1 — pure libraries**: LibCategory, LibAttestation (era 0 = Prepunk real-never-sentinel), LibWeight (quadratic/cap/vesting/dormancy)
- [x] **Slice 2 — custody core**: ENSPLUSVault (1:1 wrap, checkpoints, vesting, holderCount) + RevenueSplitter; invariants I1–I4 as 800-op randomized tests
- [x] **Slice 3 — InternalGovernor**: commit-reveal ballots, capped tallies, outcomes, epochs, trailing-min tier ladder, Policy A/B registry
- [x] **Slice 4 — constitutional machinery**: GovernorExecuted (execute-by-proposal, zero admin keys), ConstitutionRegistry, ModuleRegistry (machine checks + ERC-165 gate), StandingOrders
- [x] **Slice 5 — bloc voice**: AttestorRegistry (claim-based provenance, rebind-on-sale, boundRank persisted), GovernorAdapter, VaultSteward; genesis ceremony with address precomputation
- [x] **Slice 5-rev — directional casting**: GovernorAdapter reworked fractional→directional nominal (verified: live ENS governor is GovernorCountingSimple, no fractional); confidence-threshold abstain
- [x] **Slice 6 — NameVault**: dual custody U-721/W-1155, D7 controller retention, D9 per-owner index, Article-X migration slot, sentinel slot (both born-empty, one-shot)
- [x] **Slice 7 — RenewalPool**: CR tier ladder Ember→Eternal, 25% epoch budgets, matching, raffle, tithe, banked years; first real charter through ModuleRegistry
- [x] **Slice 8 — Citizen + ParticipationCredits**: soulbound identity, CREATE2 token-bound account, runtime charter-gated credits; genesis-ordering locked with two tests; retire-stops-minting
- [x] **Slice 9 — SentinelLock**: opt-in per-owner transfer + unwrap timelocks, M-of-N guardians, panic freeze; guards NameVault _update chokepoint (I10); full theft scenario tested
- [x] **Slice 10 — Watchtower**: expiry escalation ladder, permissionless keeper checkpoints, alarms, confusable watchlist, resurrection anchor; pure observation (no privileged surface)
- [x] **Slice 11 — LibTrust**: L1-native sybil-resistant reputation (provenance + tenure + participation + category + humanity); cross-fuzzed; replaces EFP trust graph
- [x] **Slice 12 — TrustOracle**: read-only aggregator making LibTrust live against attestor/governor/namevault/renewalpool/citizen/human; boundRank persisted
- [x] **Slice 13 — HumanAttestor**: ownerless zkPassport proof-of-humanity (one human ↔ one identity, rebindable); feeds LibTrust as sybil-proof signal
- [x] **Slice 14 — CitizenResolver**: ownerless ENS resolver — FORWARD (addr/text/contenthash) + REVERSE (EIP-181 `name`); live civic records (ensplus.*); recordVersion clearing; ENSIP-10 + CCIP-read; label↔node binding verified; provenance-safe on transfer

## ✅ FINISHED — tooling & SDK
- [x] `tools/efp_onchain.mjs` (+test) — EFP follows read directly from Base contracts, no hosted API; decoders verified vs EFP docs vectors
- [x] `tools/eik_profile.mjs` (+test) — on-chain ENS+EFP profile resolver + self-contained, injection-safe SVG card renderer
- [x] `tools/libtrust_mirror.mjs` — independent BigInt mirror of LibTrust (cross-fuzz oracle)
- [x] `tools/ensplus-utils/` — the ENSPLUS SDK (one client: EFP follows, profile resolve/render, live reputation via TrustOracle)
- [x] `tools/gas_snapshot.js` → `.gas-snapshot` — deploy + key-call gas regression tracking
- [x] `tools/deploy.js` — deterministic genesis deploy blueprint (same deployer+nonces ⇒ same CREATE addresses; registry prediction asserted)
- [x] `tools/adoption_model.mjs` — wrapped-supply → governance-impact threshold model
- [x] `tools/fuzz.js` — EVM-vs-JS cross-fuzz harness

## ✅ FINISHED — front-end
- [x] `app/ensplus_console.html` — self-contained single-file console (16 panels): Overview, **User Guide**, ENS+ Vault, Name Vault, Internal Governor, Constitution, Bloc Voice, Renewal Pool, Sentinel Lock, Watchtower, Citizen & Provenance, Reputation, Participation Credits, Civic Resolver, Follow Graph (optional), Guilds (planned preview). No build step, no CDN; status of each feature labelled honestly in-app.

## 📐 DEFERRED — post-audit / separate reviews (asset-moving, higher risk)
- [ ] Marketplace / leasing / Subname Foundry (move assets — own audit)
- [ ] Inheritance / dead-man's switch (asset-moving on triggers — own audit)
- [ ] Wave 3 v2 kit: MigrationAdapter (M1–M5), RegistrarAdapter v2, Covenant Registry (blocked on ENSv2 going live)
- [ ] Curated-category TCR, guilds, hash-recovery bounties (additive, mostly non-custodial)
- [ ] Specimen Plate art module (tokenURI/gallery + ERC-2981) + HTML testbed
- [ ] Protocol Watch desk (fork of ENS dao-proposal-monitor; mostly off-chain)

## 🔧 PRE-AUDIT HARDENING (finish before external audit)
- [ ] Stateful invariant tests for custody-adjacent contracts (SentinelLock especially; Watchtower, TrustOracle)
- [x] Settle code-affecting decisions — ALL RESOLVED (see docs/DECISIONS_RESOLVED.md): D-POLICY (whole-bloc directional, Policy A/B reserved), D-CAP (fixed genesis param, conservative lean, no adaptive), D-RAFFLE (block.prevrandao, no VRF), D-DERIVATION (canonical rank tier — fixed a real LibTrust/LibAttestation drift; frozen spec in docs/FROZEN_DERIVATION_SPEC.md)
- [x] Audit-scope document — docs/ENSPLUS_AUDIT_SCOPE.md (22 contracts / ~3,045 SLOC in scope; deferred waves + externals out; invariants I1–I10; accepted findings; 8 focus questions)

## 🚧 GATING GENESIS (non-code)
- [x] Live ENS governor fractional-voting verification — DONE: GovernorCountingSimple, no fractional; adapter pivoted to directional
- [x] EFP dependency resilience — DONE: on-chain reader (Base) + L1-native LibTrust replacing the EFP graph
- [ ] Prepunk derivation dry-run — 3-way diff (BigQuery × Grails 79,720-row corpus × ENS subgraph); freezes era/rank; emits proof shards (~$10, ~4 days; Rocky's machine) — ARCHIVE GRAILS CORPUS before its sunset
- [ ] Constitutional text in ratifiable language (Layer 0 verbatim + Articles V–X)
- [ ] Parameter review — capBps vs community size, ladders, windows, fees
- [ ] Red-team: SO classification gaps (S1) + aged-name acquisition-cost study (G2)
- [ ] Legal review — utility-first entity/securities framing (B7)
- [ ] **External audit(s)** scoped to invariants I1–I10 — the top remaining item; the one thing that makes ENSPLUS as *proven* as it is *reasoned*
