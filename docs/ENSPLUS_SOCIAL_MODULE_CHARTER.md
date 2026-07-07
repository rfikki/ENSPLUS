# ENSPLUS Module Charter — `social` v1

**Status:** IMPLEMENTED (identity/trust core) — LibTrust + TrustOracle (L1-native, sybil-resistant, live), HumanAttestor (zkPassport), CitizenResolver (ensplus.* records). EFP/EIK/Grails reclassified optional-with-fallback (see resilience section); EFP read on-chain, trust no longer depends on it. · **Date:** 2026-07-04 (status updated 2026-07-05)
**Format:** Complete instance of `ENSPLUS_MODULE_MANIFEST_SPEC.md` §2. Intended as the reference example of a minimal charter: read-only, pure Tier-0, zero custody surface. If the manifest pipeline can't ratify this one cleanly, the pipeline is broken.

---

## 2.1 Identity

| Field | Value |
|---|---|
| `moduleId` | `social` |
| `version` | 1 |
| `codeHash` | `<runtime bytecode hash at deploy>` |
| `sourceUri` | `<verified source, Etherscan>` |
| `interfaces` | `0x01ffc9a7` (ERC-165), `<IModule>`, `<ITrustGraphReader>` |

Note: v1 is deliberately thin on-chain — a registry stub that (a) anchors the module's existence, charter hash, and parameter constants, and (b) exposes the ratified trust-graph parameter set (`seedRoot`, `hopWeights`, `bonusCap`) for anyone recomputing scores. The heavy lifting (EIK rendering, EFP API reads, score computation) is client/indexer-side by design.

## 2.2 Constitutional citation

| Field | Value |
|---|---|
| `authorizingArticles` | Art. VI (utility mandate); Art. V (fair governance) — *scoring parameters only* |
| `citationRationale` | VI: social context (profiles, follower counts, mutuals, guild visibility) is holder utility rendered from the wider identity stack — ENS resolves, EFP connects, EIK renders, ENSPLUS attests. V: the trust-graph score is an *input candidate* to sybil resistance; publishing its parameters on-chain places it under fair-governance review rather than indexer discretion. |
| `soInteractions` | `none` — this module never reads, feeds, or influences Standing Orders. Trust-graph scores are **not** consumed by the Internal Governor in v1 (see Frozen surfaces). |

## 2.3 Tier-0 autonomy declaration

| Field | Value |
|---|---|
| `tier0Behavior` | Everything, forever: EIK profile surfaces (cards, follower/following, mutuals) render on all social UI; EFP civic tags (`ensplus`, `guild:*`, `prepunk`, etc.) are *read and displayed* wherever present; trust-graph scores are computable by anyone from the on-chain parameter set + public EFP data (reference implementation: `efp_trustgraph.mjs`); marketplace/lease views show counterparty profile + mutual context. All of it is read-side decoration on the convenience tier. |
| `frozenSurfaces` | (a) Trust-graph parameter changes — T1. (b) **Activation of trust-score as a live governance multiplier — T2, and requires a separate Internal Governor parameter vote with its own rage-quit window** (two-key design: this module can publish scores at T0, but only Congress can make them *count*). (c) Adoption of an ENSPLUS standardized tag vocabulary — T1. (d) v2 upgrade adding protocol-owned EFP lists — new charter version, T2 (adds P-EXT via a new `EFPAdapter`; the vault or module contracts becoming EFP List Owners/Managers is a write capability and is explicitly **out of scope for v1**). |
| `keeperJobs` | `none` on-chain. (Indexer-side refresh of cached EFP data is convenience-tier ops, outside charter scope by definition.) |
| `custodianBehavior` | Identical to tier0Behavior — nothing to freeze; the module has no state that governance touches except parameters, which freeze like everything else. |

## 2.4 Permission set

| Field | Value |
|---|---|
| `permissionsRequested` | `P-READ` only |
| `permissionJustifications` | P-READ: membership roster + Citizen state + category bitmaps are joined with EFP data to render civic context (e.g., "this follower is a Prepunk-era Citizen") and to define the trust-graph **seed set** (provenance-weighted Citizens) from attested data. |
| `forfeitures` | `<canonical forfeiture block, byte-exact>` — restated: no principal access, no covenant/splitter/root mutation, no third-party role grants, no exit gating, no non-adapter external calls, no mid-migration interaction. (Trivially satisfied: the module has no write path at all.) |

## 2.5 Value flows

| Field | Value |
|---|---|
| `revenueRouting` | `none` |
| `creditEmissions` | `none` in v1. (Social-action credits — e.g., quorum-raid notifications that convert to turnout — are a candidate v2 amendment and would add P-CREDIT at T1.) |
| `treasuryDraws` | `none` |

## 2.6 Continuity posture

| Field | Value |
|---|---|
| `adapterDependencies` | `none` (no external calls exist). EFP mainnet/Base/Optimism contract addresses appear **only** in off-chain tooling and docs, never in module bytecode — consistent with the no-raw-external-address rule even though no calls are made. |
| `v2Impact` | None. EFP follows addresses; Citizen 6551 accounts and member wallets are ENSv2-invariant. The follow-the-name property (following Citizen token-bound accounts) survives every migration phase untouched. |
| `migrationTouch` | `blocked` (default) |

## 2.7 Security posture

| Field | Value |
|---|---|
| `threatRows` | Owns three new Threat Model rows, to be appended as §8-T7..T9: **T7 Follow-farming against the trust score** (A3) — mitigated: only seed-rooted edges score, seeds are provenance-anchored Citizens, out-degree normalization prevents trust spraying, bonus hard-capped (≤ +25%) and *inactive by default* per the two-key rule; residual: seed-citizen collusion — monitored, seeds are public. **T8 Hosted-API dependency** (A11) — mitigated: convenience tier only; parameters on-chain; anyone can recompute from a self-hosted EFP indexer (Railway template) or raw chain; core protocol has zero dependency. **T9 Social-surface phishing** (A1) — profile cards render attacker-controlled ENS records/avatars; mitigated by EIK's own handling + metadata-service sanitization lessons + homoglyph Watchtower on displayed names. |
| `invariantsTouched` | None of I1–I10 (no write paths). Adds one module-local invariant for audit: **IS-1** — no code path exists by which trust-graph output modifies Internal Governor weight while the T2 activation flag is unset. |
| `auditArtifacts` | Light review sufficient for P-READ tier; the reference scorer ships with its fixture tests (`efp_trustgraph.mjs --demo`). |
| `claimsRegistered` | "Your civic identity is visible across every EFP-integrated app" — ECONOMIC (depends on third-party integrations reading public tags). "Trust-graph scores cannot affect governance unless Congress activates them" — HARD (IS-1). |

## 2.8 Retirement

| Field | Value |
|---|---|
| `sunsetBehavior` | UI surfaces removed; on-chain parameter stub remains (append-only registry) marked RETIRED; no member state exists to strand. Tag vocabulary remains meaningful historically (tags live in EFP, not here). |
| `retirePostconditions` | Trust-score activation flag unset; no keeper jobs (vacuously true); charter marked superseded-or-retired. |

---

## Ratification path
P-READ only → **T1 (Assembly)** per manifest spec §3 — the lowest bar in the system, as intended. Challenge-window focus areas for reviewers: the two-key activation design (2.3-b), the seed-set definition (2.4), and threat row T7's collusion residual.

---

## Dependency resilience (added 2026-07, ethid.org wind-down)

ethid.org is winding down its hosted services (EFP's api.ethfollow.xyz, the
Ethereum Identity Kit frontend, Grails). ENSPLUS treats EFP/EIK/Grails as
OPTIONAL-WITH-FALLBACK, never as hard dependencies:

- **EFP (trust graph).** EFP is an ONCHAIN protocol (List Registry + List
  Records on Base, chain 8453); the follow data survives the API sunset. The
  hosted indexer is replaced by `tools/efp_onchain.mjs`, which resolves follows
  directly from the Base contracts (address -> primary list -> storage location
  -> reduce list-ops -> following set). The trust graph needs only follows AMONG
  the bounded, known anchored-member set, so O(members) cheap OUTBOUND reads
  suffice — no global follower index, no hosted API. Decoders are unit-tested
  against the EFP docs' own vectors (`efp_onchain.test.mjs`, 7/7). The social
  module remains opt-in, two-key-activated, capped +25%, inactive until T2, and
  never wired to governance without separate ratification — so even total loss
  of EFP degrades only an optional enhancement, never the core.
- **Ethereum Identity Kit.** Pure frontend display; no contract dependency.
  Swappable for any ENS/EFP profile renderer or rolled from on-chain records.
  DELIVERED: `tools/eik_profile.mjs` — an on-chain resolver (ENS primary name
  via reverse + forward-verify, ENS text records, EFP following from
  efp_onchain.mjs) and a PURE self-contained SVG card renderer (deterministic
  address identicon; real avatar embeddable). All rendered fields are
  XML-escaped — hostile ENS records cannot inject into the SVG (tested with an
  injection payload; 8/8). No ethid.org library, no network fetch to render.
- **Grails corpus.** One of three independent cross-check sources in the
  derivation dry-run (BigQuery x Grails x ENS subgraph). The two on-chain-derived
  sources stand alone; the curated Grails corpus is the human-vetted third check.
  ACTION (time-sensitive): archive the Grails corpus + open-source repo before
  sunset so the derivation retains its third source.

Principle reaffirmed: ENSPLUS's core knows no external addresses; every external
touchpoint is a swappable adapter or a sandboxed, ratified module. Third-party
service sunsets cannot reach the covenant, the vaults, the governor, or the
name-protection triad.
