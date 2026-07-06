# ENSPLUS — Project Checklist
**As of:** 2026-07-05 · **Test status:** 95/95 passing (slices 1–8) · 8,694+ fuzz checks, 0 mismatches

---

## ✅ FINISHED

### Design documents (7)
- [x] `ENSPLUS_OVERVIEW.md` — comprehensive plain-language TL;DR, mission/vision, 8 problems / 8 fixes, full feature catalog, honest guarantees table, glossary
- [x] `ENSPLUS_ENSV2_MIGRATION_SPEC.md` — v2 facts, custody classes (U-721/W-1155, Mode A/B), adapter architecture, phase mapping, MigrationAdapter envelope (M1–M5)
- [x] `ENSPLUS_AUTOPILOT_SPEC.md` — tier ladder T0–T3, Tier-0 autonomy table, Standing Orders SO-1..10 + SO-M1..3, Custodian Mode, Policy A/B consent
- [x] `ENSPLUS_THREAT_MODEL.md` — 14 adversaries, ~45 threats, strength classes, invariants I1–I10, claims register (§11)
- [x] `ENSPLUS_MODULE_MANIFEST_SPEC.md` — charter format, permission taxonomy, tier-gated ratification, machine checks
- [x] `ENSPLUS_SOCIAL_MODULE_CHARTER.md` — first charter instance (EFP/EIK, P-READ, two-key trust activation)
- [x] `README.md` — project index, decisions log D1–D11, reuse map, 3-wave roadmap
- [x] `efp_trustgraph.mjs` — trust-graph prototype verified against live EFP API (sybil ring & bought followers = 1.0x, cap ≤1.25x)

### Contracts — verified slices (88/88 tests, 10,494 fuzz checks, 0 mismatches)
- [x] **Slice 1 — pure libraries**: LibCategory (algorithmic club bits), LibAttestation (OZ-tree leaves, era/rank semantics), LibWeight (quadratic/cap/vesting/dormancy)
- [x] **Slice 2 — custody core**: ENSPLUSVault (1:1 wrap, checkpoints, vesting blend, holderCount) + RevenueSplitter; invariants I1–I4 as 800-op randomized tests
- [x] **Slice 3 — InternalGovernor**: commit-reveal ballots, capped tallies, outcomes, epochs, trailing-min tier ladder, Policy A/B registry
- [x] **Slice 4 — constitutional machinery**: GovernorExecuted (execute-by-proposal, zero admin keys), ConstitutionRegistry (Layer-0 immutable + amendments), ModuleRegistry (on-chain machine checks incl. ERC-165 gate), StandingOrders (classification, bonded challenges, conflict rule)
- [x] **Slice 5 — bloc voice**: AttestorRegistry (claim-based provenance, rebind-on-sale), GovernorAdapter (mirror/SO/abstain fractional casting), VaultSteward; genesis ceremony rehearsed with address precomputation
- [x] **Slice 6 — NameVault**: dual custody U-721/W-1155, D7 controller retention (reclaim-to-member atomically), D9 per-owner index, Article-X migration slot (born empty, one-shot, elected-only release, I8)
- [x] **Slice 7 — RenewalPool**: CR tier ladder Ember→Eternal (exact boundaries), 25% epoch budgets, matching, raffle, tithe, banked years; **first real module chartered through the ModuleRegistry machine checks**
- [x] **Slice 8 — Citizen + ParticipationCredits**: soulbound one-per-member identity, CREATE2 token-bound account, runtime charter-gated credit ledger; first P_CREDIT module (credits revealed ballots); ModuleRegistry extended with `hasActivePermission`; genesis ceremony ordering fixed and locked with two tests (correct order charters live bytecode; naive order reverts CodeHashMismatch); retire-stops-minting proven end-to-end

## 📐 REMAINING — build queue (designed, not yet coded)
- [ ] Sentinel Lock (transfer timelocks, guardians, panic freeze; interposes on NameVault, I10)
- [ ] Watchtower (expiry escalation, resolver-change alerts, homoglyph detection)
- [ ] Inheritance / dead-man's switch
- [ ] Marketplace / leasing / Subname Foundry
- [ ] Specimen Plate HTML testbed (koi-pond workflow: perfect in browser → port on-chain) + gallery tokenURI module + ERC-2981
- [ ] Curated categories TCR, guilds, hash-recovery bounties
- [ ] Citizen Resolver (opt-in, ensplus.* text records) · Protocol Watch desk
- [ ] Wave 3 v2 kit: MigrationAdapter (M1–M5), RegistrarAdapter v2, Covenant Registry

## 🚧 GATING GENESIS (non-code tasks)
- [ ] Prepunk derivation dry-run — 3-way diff (BigQuery × Grails 79,720-row corpus × ENS subgraph); freezes era/rank semantics; emits proof shards (~$10, ~4 days; Rocky's machine)
- [ ] Live ENS governor fractional-voting verification (Rocky's RPC) — adapter convention check
- [ ] Policy-accounting decision — per-holder Policy A/B silent-weight composition vs v1 whole-bloc semantics
- [ ] Constitutional text in ratifiable language (Layer 0 verbatim + Articles V–X)
- [ ] Parameter review — capBps vs community size (flattening finding), ladders, windows, fees
- [ ] Red-team: SO classification gaps (threat S1) + aged-name acquisition-cost study (G2)
- [ ] Legal review — utility-first entity/securities framing (threat B7)
- [ ] External audit scoped to invariants I1–I10
