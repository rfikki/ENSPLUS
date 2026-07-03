# ENSPLUS × ENSv2 — Migration & Continuity Specification

**Status:** Design specification (pre-code) · **Date:** 2026-07-03
**Scope:** Maps the published ENSv2 architecture and rollout plan against the ENSPLUS vault's custody position, defines the MigrationAdapter capability envelope, and assesses per-module impact.

> Primary sources: ENS docs "ENSv2 Smart Contracts Overview" (docs.ens.domains/contracts/ensv2/overview, flagged work-in-progress), ENS Labs blog "A Deeper Dive into the ENSv2 Architecture" (Feb 20, 2026), ENS Labs Namechain cancellation announcement (Feb 2026), ENSv2 readiness guide (docs.ens.domains/web/ensv2-readiness), `ensdomains/contracts-v2` repo. Re-verify all facts against these sources at build time; ENSv2 docs are explicitly WIP pending final design and audits.

---

## 1. ENSv2 baseline facts (as of July 2026)

| # | Fact | ENSPLUS consequence |
|---|------|---------------------|
| F1 | ENSv2 deploys **exclusively on Ethereum L1**; Namechain L2 canceled Feb 2026 | No cross-chain vault, no bridge risk, no L2 satellite governance. Major simplification. |
| F2 | **Hierarchical registries**: every name may define its own subregistry and its own resolver; registries form a directed graph from a single root | ENSPLUS can ship its own registry & resolver implementations as first-class protocol citizens. |
| F3 | Registries are **typically ERC-1155**; each registry has an overall owner plus per-subname token owners | Vault custody interfaces must speak ERC-1155 in v2 (and already must speak both ERC-721 BaseRegistrar + ERC-1155 NameWrapper in v1). |
| F4 | **Roles model replaces NameWrapper fuses** — three scopes (resolver-level, name/node-level, record-level); each role has an admin role; roles grantable per-name or contract-wide; owner-held roles auto-transfer with the name, **third-party grants persist across transfer** | (a) Sentinel Lock semantics can be expressed natively as role configurations. (b) Member marketplace MUST enumerate and surface third-party role grants before any sale settles — a name can be sold with a hostile lingering grant. |
| F5 | **Launch state: all existing names pre-upgraded to a special legacy state.** They keep resolving via v1, reflect ongoing v1 record changes, no user action needed | Day one of ENSv2 is a non-event for the vault. Nothing breaks by default. |
| F6 | **Per-name opt-in upgrade**: owner calls the upgrade contract, specifies desired resolver + registry settings; the contract transfers ownership into v2 and applies configuration | Because the vault is the on-chain owner of custodied names, **only the vault can execute the upgrade for wrapped names**. This is the entire reason the MigrationAdapter exists. |
| F7 | Names **wrapped/locked in v1 NameWrapper** must upgrade into a special **wrapper-aware registry** that preserves fuse guarantees | Vault positions held as NameWrapper ERC-1155s have a distinct, constrained upgrade path. Custody accounting must tag each position v1-721 vs v1-1155. |
| F8 | Every legacy name gets an **ENSv1 Fallback Resolver** (wildcard-capable); v1 record changes keep appearing in v2 resolution until the name upgrades and sets a v2 resolver | Resolution continuity is protocol-guaranteed during the dual period. ENSPLUS record-writing modules keep writing v1 records until a name individually upgrades. |
| F9 | **Universal Resolver is the canonical resolution entry point**; the v1 UR was already deployed and client libraries migrated; the implementation swaps behind a stable interface | ResolutionAdapter should target the Universal Resolver interface from day one — then the v1→v2 cutover requires zero ENSPLUS changes for reads. |
| F10 | **No grace period in ENSv2.** Expiry is immediate: the name stops resolving and its entire subtree becomes inaccessible instantly. Expired names enter the temporary-premium window; the recent owner is exempt from the premium fee during that window | Expiry becomes drastically more punishing than v1 (v1 had a 90-day grace). The Renewal Sentinel/Pool graduates from "nice service" to near-mandatory infrastructure. Renewal margins must widen (see §6). |
| F11 | Rollout phases per the public project plan: **(A)** deploy v2 contracts; **(B)** sync existing registrations into v2 legacy state; **(C)** switch global resolution to v2 (UR cutover); **(D)** restart .eth registrations under v2; per-name upgrades available from launch onward | Phase mapping in §4 keys off these. Exact timelines unpublished — "over the coming months" as of Feb 2026. |
| F12 | Contract factories: every name gets its own resolver instance; every name with subnames gets its own registry; resolver **aliasing** lets multiple names share one record set | Profile Hub and multi-name identity features get native protocol support. Per-name contracts change gas/bookkeeping assumptions for bulk tooling. |
| F13 | v1 resolver *interface* is unchanged; existing v1 resolvers keep working in v2 | Custom ENSPLUS resolvers written today survive the migration. |

---

## 2. Custody model: what the vault holds, before and after

### 2.1 v1 custody (launch reality)
The vault must accept and account for **two** underlying representations:

- **Custody class U-721** — unwrapped .eth name: ERC-721 on BaseRegistrarImplementation (`0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85`), tokenId = labelhash. Registry `owner()` is set to the vault (or a per-position sub-controller).
- **Custody class W-1155** — v1-wrapped name: ERC-1155 on NameWrapper, with fuse state. Fuse state must be snapshotted at wrap-in, because F7 makes it determine the v2 upgrade path.

Position record additions required now: `custodyClass`, `fuseSnapshot` (W-1155 only), `v2Status` (enum: LEGACY, UPGRADE_ELECTED, UPGRADED, EXITED).

### 2.2 v2 custody target states
After a name upgrades (F6), the vault can hold it in one of two modes — this is a **feature**, not just a migration artifact:

- **Mode A — Ownership custody (v1-equivalent):** vault owns the v2 ERC-1155 subname token on the parent (.eth) registry. Maximal protection, identical trust model to v1 wrapping. Default for migrated positions.
- **Mode B — Role custody (v2-native, lighter):** the member keeps ownership; the vault (or the member's ENSPLUS-flavored registry/resolver) holds only the specific roles needed for the features the member enabled — e.g., transfer-admin roles for Sentinel Lock, registrar role for the Subname Foundry, record-scoped roles for Profile Hub. Enabled by F4's three-scope model.

Mode B is the strategic destination: less custody, same features, easier sell, smaller honeypot. Members choose per-position; governance weight can be conditioned on either mode (the name's enrollment, not its custody depth, is what the internal governor counts).

### 2.3 Covenant restatement for v2
The vault-boundary covenants translate as follows and must be enforced against **both** token standards and **both** custody modes:

1. Underlying may leave the vault only to (a) the position holder on unwrap/exit, or (b) the ratified v2 upgrade contract during an executed, elected migration (and the resulting v2 asset must land back under the same position).
2. No adapter may grant any role on a member's name/registry/resolver to any address other than: the member, vault-internal module contracts on the member's explicit opt-in, or the null/renounce path.
3. Unwrap returns the **canonical current representation**: v1 token pre-upgrade, v2 token (or full role restoration + ownership, for Mode B) post-upgrade.
4. The MigrationAdapter slot is empty by default and populated only via Article X procedure (§5).

---

## 3. Adapter interface freeze (build now, before any of this is live)

| Adapter | v1 binding | v2 binding | Swap trigger |
|---|---|---|---|
| **ResolutionAdapter** | Universal Resolver (v1 impl) | Universal Resolver (v2 impl) — same interface per F9 | Likely none needed; verify at cutover |
| **RegistrarAdapter** | Wrapped-controller renewal path (via `UniversalRegistrarRenewalWithReferrer` pattern to avoid the wrapped/unwrapped expiry desync); bulkRentPrice; referrer field set to pool address | v2 renewal interface (unpublished — watch `contracts-v2`); premium-window logic per F10 | Phase D, or as soon as v2 renewal contracts are final |
| **GovernorAdapter** | ENS DAO governor delegation + (fractional/sharded) vote casting | Unchanged by ENSv2 — the token/governor layer is a separate contract family | Only if the DAO replaces its governor (plausible given current governance events; treat as independent risk) |
| **RecordsAdapter** | v1 public resolver record writes | Per-name v2 resolver writes; aliasing ops (F12) | Per-name, at each name's upgrade |
| **MigrationAdapter** | — (slot empty) | Upgrade-contract calls per §5 | Article X ratification only |

Freeze rule: the immutable core references adapters by slot, never by address; adapters reference ENS contracts via their own immutable constructor params, so "swapping an adapter" is always "ratify a new immutable adapter," never "mutate an existing one."

---

## 4. Phase-by-phase mapping: ENSv2 rollout × ENSPLUS actions

### Phase 0 — Now (ENSPLUS pre-launch; ENSv2 pre-launch)
**ENS state:** v2 contracts in `contracts-v2`, docs WIP, App/Explorer alphas live, timelines pending.
**ENSPLUS obligations (launch blockers):**
- Dual-standard custody (U-721 + W-1155) with fuse snapshots.
- All five adapter slots defined; MigrationAdapter slot empty; Article X ratified in the launch constitution.
- ResolutionAdapter targets the Universal Resolver interface (F9) so the cutover is a no-op.
- Position schema carries `v2Status`; dApp displays it from day one ("Legacy — protected; upgrade coming").
- Protocol Watch module live: monitors `ensdomains/contracts-v2` releases, ENS DAO proposals touching v2 keys/root controls, and the readiness guide; bounties analysis; feeds the Constitution Oracle.

### Phase A — v2 contracts deployed; legacy names pre-upgraded to special state (F5)
**ENS state:** v2 live; every existing name in legacy state; v1 fully operational; fallback resolvers active (F8).
**ENSPLUS actions:**
- **Nothing custodial.** Vault names resolve via fallback resolution automatically. Do not rush.
- Renewal Pool continues renewing exclusively via the v1 path (RegistrarAdapter v1). Confirm on testnet that renewing a legacy-state name behaves identically.
- Begin ENSPLUS v2 template development: the **Covenant Registry** (ENSPLUS-flavored v2 registry implementation with Sentinel/lease/foundry semantics baked into its role layout) and the **Citizen Resolver** (profile-hub-aware resolver with aliasing support). These deploy permissionlessly; no migration dependency.
- Dry-run the upgrade contract against fork-mainnet with one sacrificial vault-held test name of each custody class (U-721, W-1155 unlocked, W-1155 locked → wrapper-aware registry path per F7).

### Phase B — Resolution cutover: Universal Resolver switches to v2 internals (F9, F11-C)
**ENS state:** global resolution now flows through v2 hierarchy; legacy names resolve via fallback resolvers; v1 record edits still honored (F8).
**ENSPLUS actions:**
- Verify every member name resolves identically pre/post cutover (automatable: snapshot record reads for all enrolled names before, diff after; keeper-bountied job).
- RecordsAdapter continues writing v1 records for non-upgraded names — F8 guarantees those writes remain visible. No forced module changes.
- Watch item: subname-dependent modules (Foundry leases, wildcard gateways) re-verify wildcard behavior under the fallback resolver's wildcard support.

### Phase C — Upgrade window: per-name opt-in migration (F6); registrations restart under v2 (F11-D)
**ENS state:** upgrade contract live; new registrations are v2-native; the ecosystem begins bifurcating.
**ENSPLUS actions — the main event:**
1. **Article X ratification round:** publish the MigrationAdapter (exact upgrade-contract address, call sequence, target Covenant Registry / Citizen Resolver templates, verification criteria), supermajority vote, maximal timelock, per-holder election window opens.
2. **Per-position election (never batch-forced):** each member elects, per name: (i) upgrade under vault custody Mode A, (ii) upgrade and shift to role-custody Mode B, (iii) remain legacy (fine indefinitely per F5/F8), or (iv) exit — unwrap raw v1 token and self-manage. Default on silence: **remain legacy**. Nothing moves without an affirmative election.
3. **Keeper-executed migration queue:** elected upgrades execute in batches through the MigrationAdapter; each execution atomically verifies post-conditions (v2 token minted to expected holder, resolver = expected template or member-specified, no unexpected third-party role grants) or reverts. Keepers earn credits per verified migration.
4. **W-1155 locked names** route through the wrapper-aware registry path (F7) with fuse-equivalence checks against the wrap-in snapshot.
5. Registry of Elders note: era/rank attestations are labelhash-keyed and **unaffected**; but record the migration itself as a new on-chain historical event (v2-migration block/ordinal — future era data. The archive grows).

### Phase D — v2-native steady state
**ENS state:** most active names upgraded; v1 becomes the archaeological layer.
**ENSPLUS actions:**
- RegistrarAdapter v2 activated: renewals against v2 interfaces. **Grace-period removal (F10) forces policy change:** the pool's renewal horizon moves from "before expiry" to "never closer than N months to expiry" (suggest N ≥ 6 for enrolled names), and Watchtower escalation begins a full year out. The premium-exemption window for recent owners is a last-resort recovery path, not a plan.
- Mode B becomes the promoted default for new wraps: "keep your name, install the constitution" — the vault's honeypot surface shrinks as adoption grows.
- Ship v2-native features unavailable in v1: shared-registry guild namespaces (multiple guild names pointing at one ENSPLUS guild registry — F2/F12), record-scoped roles for delegated profile management, custom text records with scoped writers for Citizen game-state (the ENS blog's own "gaming guild" example is precisely the ENSPLUS Citizen pattern — quest counts, ranks, allowances as role-scoped custom records).
- Subname Foundry v2: leases become time-boxed role grants + registry entries rather than resolver hacks — cleaner, natively enforceable expiry.

---

## 5. MigrationAdapter capability envelope

**May do (whitelist — everything else reverts at the vault boundary):**
- M1. Call the ratified upgrade contract for a position with `v2Status = UPGRADE_ELECTED`, passing only the ratified template addresses or the member's own explicitly-signed resolver/registry choices.
- M2. Approve the upgrade contract for the specific tokenId(s) being migrated, revoking approval in the same transaction batch.
- M3. Receive the resulting v2 asset into the vault (Mode A) or verify role-set installation on the member's registry (Mode B), and update the position record.
- M4. Route W-1155 locked positions through the wrapper-aware registry path with fuse-equivalence verification.
- M5. Abort/rollback: mark a failed migration reverted with the v1 position intact.

**Must never (enforced structurally, not by policy):**
- N1. Migrate a position without an affirmative per-position election (no vault-wide default migration).
- N2. Transfer any underlying to any address other than {upgrade contract during M1/M2, position holder on exit}.
- N3. Grant roles to any third party (covenant §2.3-2).
- N4. Set a resolver or registry not in {ratified templates, member-signed choice}.
- N5. Exist before Article X ratification (slot is structurally empty; populating it *is* the ratification).

**Verification criteria bundled into ratification:** upgrade contract address matched against ENS's official deployment artifacts; fork-simulation transcript of all three custody-class dry-runs published on-chain (IPFS hash in the proposal); post-condition assertions (owner, resolver, registry, role enumeration) encoded in the adapter itself.

---

## 6. Renewal Pool under ENSv2 — impact analysis

| v1 assumption | v2 reality | Pool response |
|---|---|---|
| 90-day grace period cushions missed renewals | **No grace period** — instant resolution death + subtree loss (F10) | Renewal horizon ≥ 6 months pre-expiry for enrolled names; Watchtower escalation ladder starts 12 months out; "expiry proximity" becomes a red-alert dApp state |
| Expired names recoverable in grace at base rate | Recent owner exempt from temporary premium only during the premium window | Treat as emergency recovery lane; pool may auto-fund a recovery re-registration for enrolled names (capped, credit-gated) — a new "resurrection" benefit line |
| Renewal via wrapped-controller path (desync bug avoidance) | v2 renewal interface TBD; per-name registries may change renewal mechanics | RegistrarAdapter v2 is a swap, not a rewrite; pool logic (CR math, tiers, credits) is interface-agnostic by design |
| Referral awards recyclable to pool | v2 referral mechanics unknown | Keep referrer field plumbing generic (bytes32 passthrough); treat awards as bonus inflow in both eras |
| Uniform renewal gas | Per-name resolver/registry factories (F12) may shift gas profile; L1 gas now ~99% cheaper than 2024 | Re-benchmark epoch batch sizes at Phase D; cheap gas likely means bigger batches, not smaller |

Net effect: **F10 is the single biggest value-add ENSv2 hands ENSPLUS.** In a no-grace world, "your name cannot die while you're a citizen" stops being a perk and becomes the headline.

---

## 7. Module impact matrix

| Module | v2 impact | Verdict |
|---|---|---|
| Attestations / Registry of Elders / Category Registry | labelhash/namehash invariant; zero changes; migration event becomes new archival data | **Immune (and enriched)** |
| Citizen (ERC-6551) + credits + eras | Vault-internal state; untouched | **Immune** |
| Internal governance / Constitution Oracle / Covenants | Untouched by name-layer rewrite | **Immune** |
| GovernorAdapter / voting bloc | Independent of ENSv2; exposed instead to ENS DAO governor politics (incl. v2 root/router key decisions — a bloc priority) | **Unaffected by v2; strategically central to it** |
| Renewal Pool / Sentinel | Interface swap + policy tightening (§6); value proposition dramatically increased by no-grace | **Winner (with homework)** |
| Sentinel Lock | v1: custody-based. v2: expressible as role config (Mode B) — same guarantees, less custody | **Winner** |
| Subname Foundry | Hierarchical registries + shared registries + role-scoped issuance = native support for everything it hacked around in v1 | **Biggest winner** |
| Profile Hub / Records | Per-name resolvers + aliasing (F12) = native multi-name identity; RecordsAdapter swap per-name at upgrade | **Winner** |
| Member Marketplace | Must enumerate persistent third-party role grants pre-settlement (F4) — new mandatory safety check; ERC-1155 settlement in v2 | **Needs work (safety-critical)** |
| Guild system | Shared registries + custom text records with scoped writers = protocol-native guild state | **Winner** |
| Hash-recovery bounties | v1 archaeology unaffected; v2 clean-slate re-registrations (F10 expiry wipes) create *new* recovery archaeology over time | **Immune, expanding** |

---

## 8. Open questions / Protocol Watch standing list

1. **Upgrade contract interface** — unpublished; the single most important artifact to capture the moment it lands in `contracts-v2`. Determines M1–M4 signatures.
2. **Reversibility** — can an upgraded name return to legacy state? Assume no; design elections as one-way with heavy confirmation UX.
3. **v2 renewal/pricing interfaces** — per-name registries may decentralize renewal mechanics; premium curve parameters for the no-grace world.
4. **Wrapper-aware registry details (F7)** — which fuse combinations map to which role restrictions; affects W-1155 dry-runs.
5. **Root/universal-router key governance** — who controls v2's root registry and upgrade authorities, and under what timelocks; an ENS DAO decision the ENSPLUS bloc should actively contest toward minimized/burned/constitutionally-constrained authority. (Community proposals to burn the ENSv2 Universal Router key have already been floated.)
6. **Cutover timing** — "coming months" as of Feb 2026; Protocol Watch tracks the readiness guide and official timelines.
7. **v2 referral program continuity** — whether renewal referral awards persist into v2 interfaces.
8. **ERC-1155 tooling assumptions (F3)** — "standardized tooling is likely to expect" 1155 registries; confirm final spec before freezing vault receiver logic.

---

## 9. Design commandments (summary)

1. The core never knows an ENS address; only adapters do.
2. Two token standards in, two custody modes out; every position tagged.
3. The MigrationAdapter slot is born empty and can only be filled by Article X.
4. No position migrates without its holder's affirmative election; silence = legacy; exit always available; unwrap always returns the canonical current asset.
5. Resolution goes through the Universal Resolver interface from day one, so the cutover costs nothing.
6. Renew early — v2 has no grace, and the pool's promise is that expiry is impossible, not merely unlikely.
7. Every marketplace settlement enumerates third-party role grants before funds move.
8. The migration itself is archived: block, ordinal, mode — future provenance, same as 2017.
9. Legacy state is a valid permanent home, not a deadline. ENSPLUS never pressures a migration ENS itself doesn't require.
10. The bloc's governance power is the migration risk strategy: the fight over v2's keys happens in ENS DAO votes, and ENSPLUS shows up to them.
