# ENSPLUS — Project README

**Status:** Core code-complete for audit scope — 146/146 tests, 22 contracts (slices 1–14 + hardening) · **Last updated:** 2026-07-09
**Entity:** CollectibleTrust DAO, LLC · **Working title:** ENSPLUS

---

## 1. What this is

ENSPLUS is a wrapper protocol for ENS tokens and .eth names, born from the 2026 ENS governance crisis (founder-dominated voting, treasury-to-foundation proposals, "the DAO is a failed experiment"). It has two inseparable halves:

1. **The Constitutional Delegate** — wrapped ENS tokens form a coordinated voting bloc whose external votes are computed by whale-resistant internal governance and an executable Standing Orders rulebook derived from the original ENS constitution. Nick's power is other people's absence; ENSPLUS's power is other people's presence.
2. **The Utility Layer** — wrapped .eth names gain renewal immortality (pool + banked years), theft resistance (Sentinel Lock), on-chain provenance certification (eras, ranks, categories), evolving Citizen identity (ERC-6551), social integration (EFP/EIK), marketplace/leasing/foundry services, and fully on-chain generative art.

Design DNA: immutable contracts, no admin keys, covenants enforced in bytecode, everything runs at zero participation (operations by formula, governance by exception), exit always open. *"Read the bytecode, it can't."*

## 2. Document index (this folder)

| Document | Covers |
|---|---|
| `ENSPLUS_OVERVIEW.md` | **START HERE for the plain-language version**: TL;DR, mission/vision, the problem and the fix, complete feature catalog, honest guarantees, build status |
| `ENSPLUS_ENSV2_MIGRATION_SPEC.md` | ENSv2 facts baseline, custody classes (U-721/W-1155, Mode A/B), adapter architecture, phase-by-phase rollout mapping, MigrationAdapter capability envelope, renewal impact (no-grace!), module impact matrix, watch list |
| `ENSPLUS_AUTOPILOT_SPEC.md` | Participation tier ladder (T0–T3), Tier-0 autonomy table for all launch modules, keeper registry, Custodian Mode, Standing Orders rulebook (SO-1..10, SO-M1..M3), classification pipeline, consent architecture (Policy A/B) |
| `ENSPLUS_THREAT_MODEL.md` | 14 adversaries, ~45 threats across 8 domains with strength classes (HARD/STRONG/ECONOMIC/POLITICAL/PROCEDURAL), invariants I1–I10 (audit scope), claims register (§11 — what marketing may say) |
| `ENSPLUS_MODULE_MANIFEST_SPEC.md` | The charter format: lifecycle, schema (§2.1–2.8), permission taxonomy (P-READ..P-EXT + forfeiture set), tier-gated ratification, registry machine checks, renewal-pool worked example, four-document concordance |
| `ENSPLUS_SOCIAL_MODULE_CHARTER.md` | First complete charter instance: social module v1 (EFP/EIK, P-READ only, pure Tier-0, two-key trust-score activation) |
| `app/ensplus_console.html` | The front-end console: a self-contained single-file dApp (16 panels) covering the full stack, incl. an in-app User Guide. No build, no CDN. See `app/README.md` |
| `ENSPLUS_AUDIT_SCOPE.md` | The external-audit boundary: 22 in-scope contracts (~3,045 SLOC), what's out and why, security model, invariants I1–I10, accepted findings, and the 8 questions we most want answered |
| `DECISIONS_RESOLVED.md` / `FROZEN_DERIVATION_SPEC.md` | The four resolved code-affecting decisions + the frozen era/rank derivation rules |
| `ADOPTED_IMPROVEMENTS.md` | gwei-names benchmark: verdict on ownerless/robustness/features + what was adopted (HumanAttestor, SDK, gas snapshots, deterministic deploy) and deliberately deferred |
| `PROJECT_CHECKLIST.md` | Finished (14 slices + tooling) vs deferred (post-audit) vs gating (genesis) — the live status board |
| `tools/` | On-chain EFP reader (`efp_onchain.mjs`, no hosted API), EIK profile resolver+SVG renderer (`eik_profile.mjs`), LibTrust JS mirror, `ensplus-utils/` SDK, gas snapshot, deterministic deploy, adoption model, cross-fuzz. (The old `efp_trustgraph.mjs` API prototype is superseded by the on-chain reader after the ethid.org wind-down.) |

## 3. Core architecture (one screen)  — ✅ = built & tested

- **Immutable core ✅:** ENSPLUSVault + NameVault (dual custody U-721/W-1155), InternalGovernor (quadratic + caps + provenance + commit-reveal + vesting/snapshot), GovernorExecuted (execute-by-proposal, zero admin keys), ConstitutionRegistry, ModuleRegistry (on-chain machine checks), RevenueSplitter (hard-routed slices).
- **Adapters (swappable, ratified):** GovernorAdapter ✅ (directional nominal casting — live ENS governor is GovernorCountingSimple, no fractional), VaultSteward ✅, Migration slot ✅ (born empty, Article X only). Core never knows an ENS address.
- **Name layer ✅:** RenewalPool (CR tiers Ember→Eternal, banked years, first real charter), SentinelLock (transfer+unwrap timelocks/guardians/panic, I10), Watchtower (expiry escalation, alarms, resurrection anchor).
- **Identity/trust ✅:** Citizen (soulbound + ERC-6551 account) + ParticipationCredits, AttestorRegistry (era/rank provenance), LibTrust + TrustOracle (L1-native sybil-resistant reputation), HumanAttestor (ownerless zkPassport proof-of-humanity), CitizenResolver (ENS resolver for `ensplus.*` civic records, recordVersion + ENSIP-10 + CCIP).
- **Deferred to later, separately-audited waves:** Marketplace, Foundry, leasing, inheritance, curated-category TCR/guilds/bounties, Specimen Plate gallery, Protocol Watch, Wave-3 v2 migration kit.
- **External voting composition:** mirror of live internal votes + Standing Orders for Policy-A silent weight + abstain for Policy-B; bloc mode only via Oracle flag + T3 supermajority. Below internal quorum: abstain.
- **Governance modes:** Mirror (default) / Abstain (safety) / Bloc (constitutional emergency).

## 4. Key decisions log

| # | Decision | Where |
|---|---|---|
| D1 | Own immutable wrapper, no proxies/upgradeability; generational "Ark" deployments if ever needed | migration spec §4/threat V1 |
| D2 | Mirror-mode proportional voting default; consent (Policy A/B) elected at wrap; SO-6 never auto-votes on people | autopilot §5 |
| D3 | Launch without waiting for ENSv2; legacy state is a valid permanent home; v2 kit ships shelf-ready, ratified later (waves 1–3; audits gate go-live, not ENS's roadmap) | conversation, migration spec |
| D4 | Attestation is claim-based (roots on-chain, holders prove; no push ceremony); leaf = labelhash/ts/rank/era/flags/version | migration + scaling discussion |
| D5 | Eras: Prepunk (≤2017-06-23) / Auction / Permanent / Modern + airdrop-franchise flag (≤2021-10-31); ranks derive from ordinal at read time | category discussion |
| D6 | Normalization: ENSIP-15 client-side only (`@adraffy/ens-normalize`); chain keys on raw registered labels; labelhash-direct lane for non-normalizable legacy names | identity discussion |
| D7 | Resolution untouched by wrapping (member keeps Registry controller rights); optional opt-in Citizen Resolver (standards-conformant + ENSIP-10 wildcard + `ensplus.*` text records); **no ENSPLUS primary names / reverse registrar** (unlike GR/Linagee) | identity discussion |
| D8 | v1 renewals via the deployed UniversalRegistrarRenewalWithReferrer path (wrapped-controller, desync-safe), referrer=pool (self-funding bonus) | grails repo findings |
| D9 | Per-owner position index in vault (O(1) wallet-scoped reads); no global enumeration on-chain; two-tier UX (RPC core / indexer convenience); proof shards on IPFS; deterministic client-side art rendering | scaling/UI discussion |
| D10 | Art direction: Specimen Plate (names as typographic artifacts; banked-years stamps) for the Namehash Gallery; heraldry reserved as candidate for Citizen avatars; constellation as candidate animation layer | art discussion |
| D11 | Trust scores: seed-rooted, capped +25%, **inactive in governance until separate T2 activation** (two-key) | social charter |
| D12 | GovernorAdapter casts DIRECTIONALLY (full weight one way) not proportionally — verified the live ENS governor uses GovernorCountingSimple with no fractional counting; mirror = mirror the internal DECISION, abstain below a confidence threshold | slice 5-rev, governor verification |
| D13 | EFP/EIK/Grails are OPTIONAL-WITH-FALLBACK (ethid.org wind-down): EFP read on-chain from Base, and the trust signal rebuilt L1-native (LibTrust) from owned primitives, so no third-party liveness is load-bearing | ethid.org wind-down |
| D14 | Proof-of-humanity via ownerless zkPassport HumanAttestor (one human ↔ one identity) feeds LibTrust as a sybil-proof bonus | gwei-names benchmark |
| D15 | Audit scope is a TIGHT core (custody + governance + read-only identity); asset-moving features (marketplace, leasing, inheritance, v2 kit) ship in later separately-audited waves | pre-audit scoping |

## 5. External resources

**ENS current state (July 2026):** governance crisis live (EP 6.45 Security Council renewal defeated by founder's ~3.26M ENS ≈ 80% of votes cast; foundation-restructuring proposals in flight). ENSv2: L1-only (Namechain canceled Feb 2026), hierarchical registries, roles model, no grace period, legacy names pre-upgraded + opt-in per-name upgrade contract; timelines pending — watch `ensdomains/contracts-v2` and the readiness guide.

**Reuse (adopt):** `ensdomains/merkle-builder` (attestation trees) · `ensdomains/dao-proposal-monitor` (Protocol Watch intake) · `ensdomains/ens-test-env` (+ chai-matchers-viem, dappwright) · `ensdomains/ens-contracts` (all interfaces/artifacts) · deployed `UniversalRegistrarRenewalWithReferrer` `0xf55575Bd…` (verify current) · EIK `ethereum-identity-kit` npm.
**Reuse (reference):** `ens-metadata-service` (SVG sanitization for hostile names) · `migration-scripts` (2017→2019 semantics) · ENS subgraph (derivation cross-check #3, indexer schema) · ENSRainbow (label healing) · `multi-delegate` (fractional delegation prior art) · `grailsmarket/backend`.
**Data:** `grailsmarket/ens-categories` (MIT): category CSVs + prepunk rankings (79,720 rows, rank 1 = rilxxlir.eth) + club definitions.
**EFP (ethid.org winding down 2026-07):** protocol is ON-CHAIN and survives the API sunset — read directly from Base (List Registry `0x0E688f5DCa4a0a4729946ACbC44C792341714e08`, List Records `0x41Aa48Ef3c0446b46a5b1cc6337FF3d3716E2A33`, Account Metadata `0x5289fE5daBC021D02FDDf23d4a4DF96F4E0F17EF`) via `tools/efp_onchain.mjs`. Trust signal no longer depends on EFP at all — see LibTrust (L1-native). Grails corpus: archive before sunset.
**Anchors:** auction registrar `0x6090A6e47849629b7245Dfa1Ca21D94cd15878Ef` · BaseRegistrar `0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85` · old registry `0x314159265dD8dbb310642f98f50C066173C1259b` · registry `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` (re-verify all at build).

## 6. Roadmap

**Wave 1 (political layer) ✅ BUILT:** ENSPLUSVault, InternalGovernor, GovernorExecuted, ConstitutionRegistry, ModuleRegistry, StandingOrders, GovernorAdapter (directional), VaultSteward, AttestorRegistry. Gate: audit.
**Wave 2 (name + identity layer) ✅ BUILT (core):** NameVault, RenewalPool, SentinelLock, Watchtower, Citizen + ParticipationCredits, LibTrust + TrustOracle, HumanAttestor, CitizenResolver. Deferred to later waves: Marketplace, Foundry, leasing, inheritance, Gallery. Gate: audit.
**Wave 3 (v2 kit, shelf-ready):** MigrationAdapter, RegistrarAdapter v2, Covenant Registry. Gate: ENSv2 contracts final + audited + live; ratified via Article X as the first great constitutional act.

**Immediate next tasks (pre-audit hardening):**
1. Stateful invariant tests for custody-adjacent contracts (SentinelLock especially).
2. Settle code-affecting decisions: per-holder Policy A/B accounting; capBps vs community size; raffle VRF-vs-blockhash; era/rank derivation freeze.
3. **Prepunk derivation dry-run** — 3-way diff (BigQuery × Grails corpus × ENS subgraph); freezes era/rank; emits proof shards (~$10, ~4 days). ARCHIVE the Grails corpus before its sunset.
4. Constitutional text: Layer-0 verbatim + Articles V–X in ratifiable language.
5. Audit-scope document; then commission external audit(s) — the top gating item.

## 7. Standing cautions

- Never claim beyond the Threat Model §11 claims register (four "do not say this" entries).
- The bloc must never be positionable as an RFV raid vehicle: SO-8 + covenant self-dealing prohibition are the shield — keep them loud.
- ENS docs for v2 are WIP: every fact in the migration spec carries a re-verify-at-build obligation.
- Renewal executor must use the wrapped-controller path (v1 desync bug) — encoded in D8; do not regress.
- All labels are hostile input (SVG injection, homoglyphs); all names may be non-normalizable (legacy lane).
- L1 gas is negligible now (sub-1 gwei, 2026) — reinforces the all-mainnet design; no L2 for ENSPLUS logic; build identity from owned L1 primitives.
- Robustness gap vs benchmarks: ENSPLUS is thoroughly reasoned (threat model, invariants, cross-fuzz) but NOT YET audited or deployed. External audit + mainnet deploy is the top pre-launch item.
