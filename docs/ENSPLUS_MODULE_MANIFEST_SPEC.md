# ENSPLUS — Module Manifest & Charter Specification (Draft 1)

**Status:** IMPLEMENTED — charter format + permission taxonomy + on-chain machine checks live in ModuleRegistry; RenewalPool and ParticipationCredits are real chartered modules (runtime P_CREDIT gate proven). · **Date:** 2026-07-03 (status updated 2026-07-05)
**Role in the document set:** This is the keystone. The Migration Spec defines how ENSPLUS survives the outside world changing; the Autopilot Spec defines how it runs without anyone; the Threat Model defines what every guarantee is worth. The Manifest is the mechanism that forces every module — present and future — to answer to all three *before it can exist.*

> Governing principle (Article VI/VII): a feature is not a deployment; a feature is a **ratified charter**. The ModuleRegistry refuses activation of any module whose manifest is incomplete, uncited, over-permissioned, or unchallenged. "Features cannot exist outside the constitution" is enforced here, structurally.

---

## 1. Lifecycle of a module

```
DRAFT → PUBLISHED → CHALLENGE WINDOW → RATIFICATION (tier-gated) → REGISTERED → ACTIVE
                                                                        ↓
                                                        AMENDED (new manifest version)
                                                                        ↓
                                                              SUNSET → RETIRED
```

1. **Draft/Publish:** proposer posts the complete manifest + code hash + artifacts on-chain (proposal bond applies).
2. **Challenge window:** any citizen bonds to contest any field — a wrong constitutional citation, a hollow Tier-0 row, an over-broad permission, a missing threat row. Contested fields route to live vote or juror panel.
3. **Ratification:** vote at the tier its permission set requires (§3). Rage-quit timelock follows, as with every rule change.
4. **Registration:** the ModuleRegistry performs its machine checks (§5) and, only if all pass, assigns the slot.
5. **Activation:** permissions become live; keeper jobs register; revenue routing (if any) connects to the splitter.
6. **Amendment:** any change = new manifest version through the same pipeline; old versions remain on-chain forever (the registry is append-only — a module's history can never be rewritten).
7. **Sunset/Retire:** every manifest declares its retirement behavior up front. Retirement can only *remove* permissions, never strand member assets or state (retirement post-conditions are machine-checked like activation).

---

## 2. The manifest schema

Language-neutral field specification; serialization format decided at build (deterministically hashable — canonical JSON or SSZ-style). Every field is mandatory. "MC" marks fields the registry verifies on-chain; "SC" marks fields verified socially via the challenge window.

### 2.1 Identity

| Field | Check | Content |
|---|---|---|
| `moduleId` | MC | Unique slug, append-only registry key (e.g., `renewal-pool`) |
| `version` | MC | Monotonic per moduleId |
| `codeHash` | MC | keccak256 of deployed runtime bytecode; registry verifies against the live contract at registration |
| `sourceUri` | SC | Verified-source location (Etherscan verification required pre-ratification) |
| `interfaces` | MC | Complete ERC-165 interface set the module answers `true` for — registry calls `supportsInterface` for each and rejects on any mismatch. *(All relevant IDs, declared and tested — the lesson learned twice at LNR and GRDO becomes a registration gate.)* |

### 2.2 Constitutional citation

| Field | Check | Content |
|---|---|---|
| `authorizingArticles` | MC | Article/clause IDs; registry verifies each exists and is in force in the ConstitutionRegistry |
| `citationRationale` | SC | One paragraph per citation: *why this article authorizes this module.* Hollow citations are the challenge window's primary target |
| `soInteractions` | SC | Which Standing Orders (if any) this module reads, feeds, or could influence; `none` must be stated explicitly |

### 2.3 Tier-0 autonomy declaration

| Field | Check | Content |
|---|---|---|
| `tier0Behavior` | SC | Complete description of what the module does with zero governance input, forever — formulas, oracles, member self-service surfaces. **A module whose Tier-0 row is empty or non-useful fails ratification by rule.** |
| `frozenSurfaces` | SC | Everything that halts without governance, and the tier that unlocks each |
| `keeperJobs` | MC/SC | Per job: trigger condition, bounty formula reference, urgency class, whether it's on the automation-backstop list |
| `custodianBehavior` | SC | Explicit statement of behavior in Custodian Mode (usually "= tier0Behavior with 3× challenge windows"); deviations must be justified |

### 2.4 Permission set (the sandbox — see §4 taxonomy)

| Field | Check | Content |
|---|---|---|
| `permissionsRequested` | MC | Exact list from the closed taxonomy; registry rejects any identifier outside it |
| `permissionJustifications` | SC | One line per permission tying it to a `tier0Behavior` or charter function; unjustified permissions are challengeable |
| `forfeitures` | MC | Affirmative declaration of the always-forbidden set (§4.2) — cosmetically redundant, deliberately so: every charter re-states, on-chain, what no module may ever do |

### 2.5 Value flows

| Field | Check | Content |
|---|---|---|
| `revenueRouting` | MC | Inbound fee types and the splitter path (immutable slices apply); `none` if non-revenue |
| `creditEmissions` | MC | Which credit schedules it mints against (must reference ratified schedules only) |
| `treasuryDraws` | MC | Budget lines drawn (ops/bounty budgets), each with a per-epoch cap |

### 2.6 Continuity posture (binds to the Migration Spec)

| Field | Check | Content |
|---|---|---|
| `adapterDependencies` | MC | Which adapter slots it calls through (never raw external addresses — registry rejects manifests importing external contract addresses outside adapter constructor params) |
| `v2Impact` | SC | Its row from the Migration Spec §7 matrix, restated: what changes at each rollout phase |
| `migrationTouch` | MC | Whether it can interact with positions mid-migration; default `blocked` (invariant I8/I10 interlock) |

### 2.7 Security posture (binds to the Threat Model)

| Field | Check | Content |
|---|---|---|
| `threatRows` | SC | The Threat Model row IDs this module owns (e.g., RenewalPool → R1–R8); a module introducing threats with no rows is challengeable on that basis alone |
| `invariantsTouched` | SC | Which of invariants I1–I10 its code paths can affect; each becomes mandatory audit/fuzz scope for this module |
| `auditArtifacts` | SC | Audit report hashes; fork-test transcripts (on-chain hash, IPFS body). T2+ permission sets require at least one independent audit before ratification |
| `claimsRegistered` | SC | Any public claims this module adds to Threat Model §11, with strength class — marketing for a module is bounded by its own manifest |

### 2.8 Retirement

| Field | Check | Content |
|---|---|---|
| `sunsetBehavior` | SC | What happens on retirement: state disposition, member off-ramp, successor hand-off |
| `retirePostconditions` | MC | Machine-checkable assertions (no member funds resident, no live role grants, keeper jobs deregistered) that must pass before the registry marks it RETIRED |

---

## 3. Ratification tiering by permission weight

The tier required to ratify a manifest is the **maximum** tier demanded by any single permission it requests:

| Permission class (see §4) | Minimum ratifying tier |
|---|---|
| P-READ only | T1 |
| + P-CREDIT, P-EXEC, P-REVENUE | T1 |
| + P-TREASURY (budget draws) | T2 |
| + P-ROLE (v2 role operations on opted-in names) | T2 + independent audit |
| + P-EXT via a *new* adapter | T2 (the adapter itself is a separate ratification) |
| MigrationAdapter population | T3, Article X procedure only |

This makes the tier ladder self-describing: what a module *asks for* determines who must show up to grant it — and below that tier, the ask cannot even be voted on.

---

## 4. Permission taxonomy (closed set)

### 4.1 Grantable
- **P-READ** — membership rosters, Citizen state, credit balances, category bitmaps, attestation proofs. Read-only, always safe.
- **P-CREDIT** — mint participation credits strictly per a referenced ratified schedule.
- **P-REVENUE** — receive fees *into the splitter* (never hold revenue internally past the transaction).
- **P-TREASURY** — draw from a named, per-epoch-capped budget line.
- **P-EXEC** — register keeper jobs with fixed bounty formulas.
- **P-ROLE** — request/hold specific v2 role classes on names whose holders explicitly opted in, enumerated by role ID; auto-revoked on member opt-out and on module retirement.
- **P-EXT** — call external contracts, exclusively through a named adapter slot.

### 4.2 Never grantable (the forfeiture set — restated in every manifest)
- Any access to vaulted principal (tokens or names) outside holder-initiated flows.
- Any mutation of covenants, splitter percentages, attestation roots, or the ConstitutionRegistry.
- Any role grant to third parties on member names.
- Any pause, freeze, or gating of unwrap/exit.
- Any external call not routed through an adapter.
- Any interaction with a position mid-migration absent `migrationTouch` ratification.

A request for anything on this list doesn't lose the vote — the registry refuses to schedule the vote. The forbidden set is pre-constitutional.

---

## 5. Registry machine checks (executed at registration, all-or-nothing)

1. `codeHash` matches live bytecode.
2. Every `authorizingArticle` exists and is in force.
3. Every `interfaces` entry returns `true` from `supportsInterface`; ERC-165 itself (`0x01ffc9a7`) mandatory.
4. `permissionsRequested` ⊆ grantable taxonomy; ratifying vote's tier ≥ required tier per §3.
5. `forfeitures` block present and byte-exact against the canonical text.
6. Revenue/credit/treasury references resolve to existing splitter paths, schedules, budget lines.
7. `adapterDependencies` resolve to registered adapter slots; bytecode scan confirms no external addresses outside declared adapters (best-effort static check; challenge window is the real backstop).
8. Challenge window elapsed or all challenges resolved in favor.
9. For P-ROLE / T2+ sets: `auditArtifacts` non-empty.

Fail any → no registration, bond partially consumed, full re-submission required. There is no override path; even a T3 supermajority cannot register a manifest that fails machine checks (they can amend the *rules*, with rage-quit, but never skip them).

---

## 6. Worked example — `renewal-pool` v1 (abridged)

```
moduleId: renewal-pool            version: 1
codeHash: <runtime hash>          interfaces: [0x01ffc9a7, <IModule>, <IRevenueSink>]

authorizingArticles: [VI (utility mandate), VIII (funding slice & tithe pattern)]
citationRationale: VI — renewal continuity is the flagship holder utility;
  VIII — pool inflow is a constitutionally hard-routed slice of module revenue.
soInteractions: none (pool never votes; reads no SO state)

tier0Behavior: CR computation; tier state machine Ember→Eternal; 25% epoch
  budget cap; VRF raffles; matching; base-rate renewals via wrapped-controller
  path with referrer=self; stable-buffer rebalance by formula; endowment
  overflow → tithe. Member self-service: enroll/unenroll names (bonded),
  view banked years.
frozenSurfaces: tier thresholds (T1); per-citizen cap N (T1); funding slice % (T3).
keeperJobs: [epoch renewal batch — urgency HIGH, backstopped],
  [raffle VRF request], [buffer rebalance], [CR/tier settle at epoch close].
custodianBehavior: identical; 3x challenge windows.

permissionsRequested: [P-READ, P-CREDIT(schedule: participation-v1),
  P-REVENUE(slice: pool), P-EXEC, P-EXT(adapter: RegistrarAdapter)]
permissionJustifications: (one line each)
forfeitures: <canonical block>

revenueRouting: wrap-fee & module-fee slice → pool (constitutional %)
treasuryDraws: keeper-bounty line, cap B/epoch

adapterDependencies: [RegistrarAdapter]
v2Impact: Migration Spec §6 verbatim (no-grace policy; horizon ≥6mo;
  resurrection lane; adapter swap at Phase D)
migrationTouch: blocked

threatRows: [R1–R8]        invariantsTouched: [I2, I3 (pool accounting)]
auditArtifacts: <required before ratification>
claimsRegistered: ["banked years are irreversible" — HARD (R5)]

sunsetBehavior: renewals halt after final epoch; unspent pool + endowment
  roll to successor module or, absent one, continue tithe schedule; banked
  years unaffected (registrar-level).
retirePostconditions: [zero unexecuted elected renewals, keeper jobs
  deregistered, splitter path detached]
```

---

## 7. Concordance — how the four documents interlock

| Question a critic, auditor, or citizen asks | Answered by | Enforced by |
|---|---|---|
| "What authorizes this feature to exist?" | Constitution (Layer 0 + amendments) | Manifest §2.2 + registry check 2 |
| "What does it do if we all disappear?" | Autopilot Spec (Tier-0 table) | Manifest §2.3 + ratification rule |
| "What can it never do?" | Covenants + forfeiture set | Registry check 5 + vault boundary |
| "What happens when ENS changes underneath it?" | Migration Spec (phases, adapters) | Manifest §2.6 + adapter-only rule |
| "What's this guarantee actually worth?" | Threat Model (strength classes, §11 register) | Manifest §2.7 + claims binding |
| "Who had to show up to approve this?" | Tier ladder | Manifest §3 + tier gating |
| "Can governance skip any of this?" | No | §5: machine checks have no override |

**Genesis checklist:** ratify constitution (Layer 0 verbatim + Articles V–X) → register adapter slots (Migration empty) → ratify genesis manifests as a bundle (token vault governance stack first, then the Wave-2 set, each with complete manifests even though they ship pre-community — the founding documents are held to the same standard as everything after) → publish deployment-ceremony transcript → open wrapping.

The pitch this architecture earns: *every feature ENSPLUS will ever have arrives with its authorization, its autonomy, its limits, its migration plan, and its threat analysis welded together in one on-chain document that no majority can skip — including ours.*
