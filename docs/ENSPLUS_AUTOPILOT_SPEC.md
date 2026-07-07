# ENSPLUS — Constitutional Autopilot Specification
## Tier-0 Autonomy Table & Standing Orders Rulebook (Draft 1)

**Status:** IMPLEMENTED — tier ladder T0–T3, commit-reveal, epochs (InternalGovernor); Standing Orders SO-1..10 + classification/challenges (StandingOrders); mirror/SO/abstain casting is now DIRECTIONAL (GovernorAdapter — the live ENS governor has no fractional counting). Per-holder Policy A/B accounting still a pre-audit decision. · **Date:** 2026-07-03 (status updated 2026-07-05)
**Principle:** Operations by formula, governance by exception. The protocol must be complete, safe, and useful at zero participation, forever. Votes change the system; they are never required to run it.

---

## 1. Definitions

- **Tier-0 behavior** — everything a module does with zero governance input: formulas, keeper calls, oracle reads, standing orders. Must be fully specified at deploy.
- **Keeper** — any address executing a permissionless maintenance call for a bounty (credits and/or ETH). Redundancy backstop: registered automation networks (e.g., Chainlink Automation / Gelato) funded from the ops budget line.
- **Standing Order (SO)** — a ratified, executable voting policy that determines the external vote of silent weight on classified ENS DAO proposals.
- **Live vote** — an internal citizen vote; always overrides standing orders for the voting weight, mirrored proportionally externally.
- **Participation Tier** — trailing-epoch measurement (distinct active citizens + turnout rate) that gates which governance powers exist at all.
- **Custodian Mode** — terminal low-participation state: full autonomy continues, all rule-change surfaces frozen, exit permanently open.

---

## 2. Participation tier ladder

Measured over a trailing window of E epochs (suggest E = 3). Thresholds are launch parameters (Article-amendable); illustrative values below assume an early community of a few thousand wrapped positions — recalibrate to actuals at genesis.

| Tier | Trigger (trailing) | Powers that exist | Powers that do NOT exist |
|---|---|---|---|
| **T0 — Autopilot** | Always (floor state) | Formulas, keepers, standing orders, optimistic actions w/ challenge, unwrap/exit, live-vote override of any SO | All discretionary votes: no parameter changes, no treasury discretion, no new charters, no amendments, no bloc mode |
| **T1 — Assembly** | ≥ 50 distinct active citizens AND ≥ 5% turnout | + category ratifications, module parameter votes within charter bounds, keeper bounty tuning | Treasury discretion, charters, amendments, bloc mode |
| **T2 — Congress** | ≥ 250 distinct active citizens AND ≥ 10% turnout | + discretionary treasury lines, new module charters, adapter ratifications (except Migration) | Amendments, bloc mode, MigrationAdapter |
| **T3 — Republic** | ≥ 1,000 distinct active citizens AND ≥ 15% turnout | + constitutional amendments, Article X migration ratification, bloc-mode eligibility | — |

Rules of the ladder:
- Tier is computed on-chain at epoch close; displayed permanently in the dApp with "citizens needed to reach next tier."
- Tier only gates *whether a vote class can be opened*; it never lowers the vote's own quorum/supermajority requirements.
- Demotion is graceful: an in-flight vote opened at a higher tier completes under its opening rules.
- **Anti-capture corollary:** below each tier, the corresponding powers are not merely hard to pass — the proposal type cannot be created. An empty room contains nothing to steal.

---

## 3. Tier-0 Autonomy Table — launch module set

Manifest rule: a module without a complete Tier-0 row does not ship.

| Module | Runs forever at T0 (formula/keeper/oracle) | Frozen without governance | Participation unlocks |
|---|---|---|---|
| **Token Vault (ENS wrapper)** | Wrap, unwrap 1:1, position accounting, snapshotting. Covenants enforced structurally. | Nothing — fully autonomous by design | — |
| **Name Vault (dual custody)** | Wrap-in (U-721/W-1155 with fuse snapshot), unwrap-out, position records, `v2Status` tracking. Legacy state is a valid permanent home. | Custody-mode defaults, template registry | New custody modes (T2 charter) |
| **Internal Governor** | Vote intake, tallies, snapshot weights, quadratic/cap/provenance math, commit-reveal windows, delegation registry incl. Constitution Delegate, decay clocks | Parameter values (curves, caps, quorums) | Parameter votes (T1), amendments (T3) |
| **Constitution Registry & Oracle** | Immutable Layer-0 text + ratified amendments readable; proposal classification pipeline (§5.2) runs on every ENS DAO proposal; classifications publishable by any keeper | New amendments; classifier ruleset revisions | Amendments (T3); ruleset revisions (T2) |
| **Standing Orders Engine** | Full §5 pipeline: classify → challenge window → execute default vote for silent weight; live votes override; unclassifiable → abstain + flag | The SO rulebook itself (ratified set) | SO additions/edits (T2) |
| **GovernorAdapter (+ shards)** | Delegation upkeep, external vote casting per mirror math (live weight) + SO output (silent weight), shard rebalancing, deadline keepers | Adapter replacement | New adapter ratification (T2) |
| **Renewal Pool** | CR computation, tier state machine (Ember→Eternal), epoch budgeting (25% cap), raffle via verifiable randomness, matching, base-rate renewals via correct controller path w/ referrer set, stable-buffer rebalancing by formula, endowment overflow + tithe routing | Tier thresholds, cap values, funding-slice % (constitutional) | Threshold tuning (T1); slice change (T3 amendment) |
| **Renewal Sentinel / Watchtower** | Expiry ladder alerts (12-mo escalation), renewal execution ≥ horizon, resolver-change/transfer-attempt/homoglyph alerts, all keeper-bountied | Alert-policy parameters | T1 |
| **Sentinel Lock** | Member-elected timelocks/guardian co-signs/panic freeze execute exactly as configured at enrollment; per-position config changes are member self-service (their own signature, never a vote) | Default policy templates | New templates (T1) |
| **Citizen (ERC-6551) + Credits** | Minting on wrap, credit accrual per fixed schedule, streak tracking, soulbound enforcement, trait evolution rules, inverse-scaling epoch emission split, quorum-hero bonuses | Emission schedule constants | T1 |
| **Registry of Elders / Category Registry** | Algorithmic category bits (pure functions), attested bits (fixed Merkle roots), bitmap aggregator view, proof verification | New attestation roots; curated-category ratifications | Curated categories (T1, optimistic w/ challenge); new roots (T2) |
| **Hash-Recovery Bounties** | Preimage claims self-verify on-chain (`keccak256(label) == labelhash`), LABEL_UNKNOWN→RECOVERED flag flips, bounty payout by formula | Bounty funding top-ups | T1 |
| **Member Marketplace** | Listings, settlement, escrow, role-grant enumeration check (v2), fee routing to splitter | Fee % changes, new settlement types | T1 / T2 |
| **Protocol Watch** | Bounty board for pre-charted analysis classes (each ENS DAO proposal, each `contracts-v2` release) pays by formula on submission + attestation | New analysis classes, budget size | T1 |
| **Revenue Splitter** | Immutable hard-routed slices (pool %, tithe %, ops %) execute on every inflow | Slice percentages (constitutional) | T3 amendment only |
| **MigrationAdapter** | **Deliberately nothing.** Slot is empty; emptiness is the Tier-0 behavior. | Everything | Article X ratification (T3) |

**Keeper job registry (summary):** epoch close & tier computation · renewal batch execution · external vote casting before ENS deadlines (highest-priority job; double-bountied in final 24h) · SO classification publication · challenge-window settlements · raffle randomness requests · watchtower alert delivery · shard rebalancing · buffer rebalancing. Every job: fixed base bounty + urgency multiplier; automation-network backstop registered at genesis for the deadline-critical subset (vote casting, renewals).

---

## 4. Custodian Mode

**Entry:** trailing participation below T0 measurement floor (fewer than K distinct active citizens, suggest K = 10) for M consecutive epochs (suggest M = 6).
**During:** every Tier-0 row above continues verbatim. All challenge windows extend 3× (fewer watchers → longer tripwires). No vote class of any tier can be opened. Standing orders continue governing silent weight; anything unclassifiable abstains.
**Exit:** automatic, the first epoch the T0 floor is re-met.
**Guarantee (printable):** *if every citizen goes silent forever, nothing can be changed, nothing can be taken, every name keeps renewing, every token remains redeemable, and the bloc never votes outside its constitution.*

---

## 5. Standing Orders Rulebook — Draft 1

### 5.1 Consent architecture (who is governed by SOs)
At wrap time every holder makes an explicit, changeable election for their silent weight — no hidden default:

- **Policy A — Constitution Delegate:** silent weight follows standing orders. Earns base participation credits at a reduced rate (suggest 25% of live-vote rate).
- **Policy B — Abstain-when-silent:** silent weight always abstains externally. No SO ever speaks for it.
- **(Either way)** a live internal vote overrides the policy for that proposal, at full credit.

External cast per ENS DAO proposal = mirror of live internal tally (for weight that voted) + SO position (Policy-A silent weight) + abstain (Policy-B silent weight). Bloc mode, when lawfully invoked at T3, supersedes this composition for that proposal only.

### 5.2 Classification pipeline
1. **Intake:** keeper registers each new ENS DAO proposal (on-chain + Snapshot) with the Oracle.
2. **Classification:** Oracle ruleset maps the proposal to zero or more SO classes via declared article-relevance criteria; the classification (class IDs + cited article clauses + proposal hash) is posted on-chain by any keeper for a bounty.
3. **Challenge window:** 48h (72h if the ENS voting deadline allows; 3× in Custodian Mode). Any citizen bonds to contest a classification → escalates to a live internal vote on the classification itself (T0-legal: it is an override, not a discretionary power) or, below quorum, to a drawn juror panel. Frivolous challenges forfeit the bond to the pool.
4. **Execution:** unchallenged or upheld classification → the matching SO determines Policy-A weight; keeper casts before the external deadline.
5. **Conflict rule:** if multiple SOs match with different positions, the more protective position wins (AGAINST > ABSTAIN > FOR); ties → ABSTAIN + flag.
6. **Unclassifiable:** ABSTAIN + prominent flag soliciting live votes. The system never guesses.

### 5.3 The Standing Orders

**Grounded in Layer-0 (the original ENS constitution, preserved verbatim):**

- **SO-1 · Name ownership is inviolable (Art. I).** AGAINST any proposal enabling confiscation, seizure, expiry manipulation, or involuntary alteration of any name's ownership or records, regardless of stated justification.
- **SO-2 · Fees are incentives, not revenue (Art. II).** AGAINST fee changes whose stated or evident purpose is revenue maximization. ABSTAIN on routine price-oracle maintenance and inflation-tracking adjustments.
- **SO-3 · Income funds development and public goods (Art. III).** AGAINST any transfer of treasury assets, endowment control, or income streams to an entity not directly controlled by tokenholder governance. FOR continuation of established public-goods funding at established levels. ABSTAIN on individual grant awards (discretionary merit → live vote or silence).
- **SO-4 · Global namespace integration (Art. IV).** FOR proposals maintaining or extending DNS compatibility. ABSTAIN on routine namespace technical operations.

**Grounded in ENSPLUS amendments (Layer-1):**

- **SO-5 · Tokenholder authority is non-degradable (Art. V).** AGAINST any proposal that reduces tokenholder authority over root keys, protocol upgrade rights, or director/steward removal; that removes a veto-capable safeguard (e.g., a Security Council) without a simultaneously-seated successor of equal or stronger tokenholder accountability; or that shortens or eliminates timelock/challenge periods. FOR proposals adding veto protection against malicious executable proposals or raising thresholds on treasury movement.
- **SO-6 · No auto-voting on people (Art. V).** ABSTAIN on all personnel elections, appointments, and removals. Human judgments require live votes, always.
- **SO-7 · Operational silence (Art. V).** ABSTAIN by default on budgets, working-group funding, service-provider selections, and administrative housekeeping — unless another SO matches (e.g., a "budget" that transfers endowment control trips SO-3).
- **SO-8 · Self-dealing prohibition (Art. VII covenant, restated as policy).** AGAINST any proposal that directs value, authority, or preferential treatment to ENSPLUS, its treasury, its modules, or affiliated addresses. (Also structurally unvoteable at the vault boundary; the SO exists so the *policy layer* refuses even lawful-looking variants.)
- **SO-9 · v2 key minimization (Art. X).** FOR proposals that burn, minimize, timelock, or constitutionally constrain ENSv2 root-registry and router/upgrade authority under tokenholder control. AGAINST proposals concentrating such authority in any board or multisig lacking tokenholder removal and veto rights.
- **SO-10 · Constitutional-process integrity (Art. V/IX).** AGAINST proposals that retroactively reinterpret, suspend, or "temporarily waive" any article of the ENS constitution; amendments must be amendments.

**Meta-orders:**

- **SO-M1 · Emergency humility.** Proposals flagged emergency/expedited with compressed timelines: ABSTAIN + maximum-visibility flag, unless SO-1/SO-3/SO-5 match (protective AGAINST still fires). Urgency is not a classification.
- **SO-M2 · Sunset & review.** Every SO auto-flags for reaffirmation review every 12 epochs at T2+; absent review it remains in force unchanged (reaffirmation is an opportunity, not an expiry — SOs must not decay into silence).
- **SO-M3 · Transparency.** Every SO execution emits the proposal hash, matched class, cited clauses, weight composition (live/SO/abstain), and final cast — the bloc's voting record is fully reconstructible on-chain by anyone, forever.

### 5.4 Rulebook change control
The SO set ships ratified in the genesis constitution. Additions/edits: T2 vote + rage-quit timelock. Removals of protective SOs (SO-1, SO-3, SO-5, SO-8): T3 supermajority. No SO can ever be added that contradicts a covenant; the Oracle refuses to register it.

---

## 6. Open parameters to tune at genesis
Tier thresholds and trailing window E · Custodian floor K and duration M · challenge bond sizes and windows · Policy-A credit ratio · inverse-scaling emission floor/ceiling · keeper bounty base rates and urgency multipliers · SO-2's revenue-maximization test criteria (the one classification most likely to be contested — draft its ruleset criteria with extra precision and expect early challenges to calibrate it).

---

## 7. The one-line summary
ENS Labs' answer to governance fatigue was a foundation board; ENSPLUS's answer is an executable constitution — same efficiency, opposite trust model, and any quorum of citizens can override it at any time.
