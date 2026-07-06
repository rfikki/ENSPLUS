# ENSPLUS — Formal Threat Model (Draft 1)

**Status:** Design-stage threat model (pre-code) · **Date:** 2026-07-03
**Purpose:** Every guarantee ENSPLUS states publicly must have a written basis here, with a strength class attached. This document is also the seed of the audit scope: §10's invariants are the properties external auditors and fuzzing campaigns should target.

---

## 1. Methodology

**Strength classes** (used throughout; never claim a stronger class than the table assigns):

- **HARD** — enforced by immutable bytecode or by the Ethereum base layer; holds against 100% of citizens, keepers, and deployers acting maliciously.
- **STRONG** — enforced by contract logic plus a configuration the member controls; holds unless the member's own configuration is defeated.
- **ECONOMIC** — enforced by funded incentives and formulas; degrades gracefully if funding/participation degrades; never fails catastrophically.
- **POLITICAL** — enforced by the voting bloc, standing orders, and public pressure; probabilistic by nature.
- **PROCEDURAL** — enforced by challenge windows, timelocks, and elections; holds if at least one honest, funded watcher exists.

**Adversary catalog:**
A1 external attacker (no position) · A2 malicious wrapped whale · A3 sybil operator · A4 malicious/censoring keeper · A5 malicious guardian(s) · A6 hostile module proposer · A7 compromised member wallet (drainer) · A8 hostile marketplace/lease counterparty · A9 hostile ENS DAO majority / base-layer key holder · A10 ENSPLUS deployer/insiders (assume malicious for analysis) · A11 frontend/supply-chain attacker · A12 MEV searcher · A13 legal/coercive off-chain pressure · A14 griefing challenger (bond abuser).

**Asset inventory:** wrapped ENS tokens; custodied names (U-721, W-1155 + fuse state, v2 Mode A tokens); Mode-B role grants; Renewal Pool + endowment + stable buffer; ENSPLUS treasury/splitter flows; Citizen NFTs + soulbound credits + banked years; attestation roots + category registry; internal voting power + external bloc weight; standing-order integrity; the dApp and the project's name/reputation.

---

## 2. Vault layer (token vault + name vault)

| # | Threat | Adversary | Mitigation | Class | Residual |
|---|---|---|---|---|---|
| V1 | ENSPLUS seizes/moves underlying (rug) | A10 | No admin keys, no proxy/upgrade path, covenant: outflow only to holder-on-unwrap or ratified-migration; verified source | **HARD** | Implementation bugs → audits, invariants §10 |
| V2 | Governance votes to take names/tokens | A2 | Confiscation is not a vote type at any tier; covenants unvoteable; rage-quit precedes every rule change | **HARD** | — |
| V3 | Reentrancy on wrap/unwrap (721/1155 callbacks) | A1 | Checks-effects-interactions, reentrancy guards, pull-payment refunds; both token standards' receiver hooks treated as hostile | **HARD** (post-audit) | Classic bug class — top fuzz target |
| V4 | Fake-token deposit (spoofed 721/1155 claims to be ENS asset) | A1 | Vault accepts only hardcoded canonical contracts per custody class; receiver hooks reject all else | **HARD** | v2 contract set must be pinned at adapter ratification |
| V5 | Unwrap denial (DoS of exit) | A1/A4 | Unwrap is a direct holder call, no keeper, no queue, no pause switch anywhere in the system | **HARD** | Base-layer congestion only |
| V6 | Wrap-in of a name with hostile pre-existing state (v1 fuses, v2 third-party role grants) | A8 | Wrap-in inspection: fuse snapshot recorded; v2 role enumeration at intake with warnings surfaced; marketplace settlement re-checks | **STRONG** | Unknown future role types → adapter updates |
| V7 | Deployer key compromise pre-renunciation | A1→A10 | Deployment ceremony: constructor-configured, nothing ownable post-deploy; publish the ceremony transcript | **PROCEDURAL** | Window exists only during deployment itself |

---

## 3. Internal governance

| # | Threat | Adversary | Mitigation | Class | Residual |
|---|---|---|---|---|---|
| G1 | Whale wraps large stack to capture internal votes | A2 | Quadratic weighting + 2% per-identity cap + overflow-to-commons; capture ROI engineered negative | **HARD** (math) | Collusion of many capped identities → G2 |
| G2 | Sybil split across wallets | A3 | Provenance multipliers anchored to .eth name age/history (expensive to fake); credits per Citizen identity; caps per identity | **STRONG** | Aged-name acquisition market — monitor cost-to-attack; recalibrate multipliers at T2 |
| G3 | Flash-wrap before a contentious vote | A2 | Snapshot at proposal creation + 30-day voting-power vesting | **HARD** | — |
| G4 | Vote buying / bribery markets | A2 | Credits soulbound; commit-reveal hides interim tallies (nothing to verifiably sell mid-vote); mirror-mode caps the value of any single internal majority | **STRONG** | Post-reveal reputation bribes possible — accepted, low-value |
| G5 | Last-minute vote sniping | A2 | Commit-reveal on all internal votes (the exact counter to the abstain-then-hammer pattern observed upstream) | **HARD** | — |
| G6 | Tier gaming (fake participation to unlock powers) | A3 | Tier counts distinct Citizens (provenance-anchored), not raw addresses; tier gates existence of vote types, quorums still apply on top | **STRONG** | Cheap-participation bots inflate T1 — keep T1 powers low-stakes by charter |
| G7 | Delegation fossilization (silent permanent proxies) | A2 | Time-decaying delegations require periodic re-affirmation; dormancy decay of voting power | **HARD** (mechanism) | — |
| G8 | Governance spam / proposal flooding | A1 | Proposal bonds; per-tier proposal rights; keeper-settled expiry of dead proposals | **ECONOMIC** | — |

---

## 4. Standing orders, oracle, external bloc

| # | Threat | Adversary | Mitigation | Class | Residual |
|---|---|---|---|---|---|
| S1 | Adversarially crafted ENS proposal slips past classification (e.g., treasury transfer disguised as budget housekeeping) | A9 | Mechanical classification criteria (asset destinations, authority changes) over intent; conflict rule: most-protective wins; SO-M1 distrusts urgency; Protocol Watch bounties adversarial review of every proposal | **PROCEDURAL** | The known-weakest point; red-team the ruleset before genesis and after every miss |
| S2 | Malicious classification posted by keeper | A4 | Classification is deterministic from the ratified ruleset (keeper publishes, doesn't decide); challenge window; bond forfeiture | **PROCEDURAL** | — |
| S3 | Challenge-bond griefing (contest everything to delay casts) | A14 | Bonds scale with repetition per challenger identity; deadlines force default-to-SO if challenge unresolved before external cutoff (fail-to-policy, never fail-to-silence for protective SOs) | **ECONOMIC** | Deep-pocketed griefer can tax the system — bounded by bond escalation |
| S4 | Nobody casts the external vote before the ENS deadline | A4 (absence) | Highest-priority keeper job, urgency-multiplied bounty, automation-network backstop registered at genesis | **ECONOMIC** | Backstop provider failure → multiple providers |
| S5 | External governor upgraded/replaced, breaking the adapter | A9 | GovernorAdapter swappable at T2; until swapped, failure mode is abstention (weight silent, principal untouched) | **PROCEDURAL** | Bloc power dormant during gap — political cost only |
| S6 | MEV/ordering games on vote casts | A12 | Votes are not price-sensitive; commit-reveal removes information value; casting near (not at) deadline is policy | **HARD** (nothing to extract) | — |
| S7 | ENSPLUS bloc accused of being an RFV raid vehicle | A9 (rhetorical) | SO-8 + covenant: structurally cannot vote value to itself; full on-chain voting record (SO-M3) | **HARD** + **POLITICAL** | — |

---

## 5. Renewal pool, sentinel, watchtower

| # | Threat | Adversary | Mitigation | Class | Residual |
|---|---|---|---|---|---|
| R1 | Enrollment farming (register junk names to harvest subsidy) | A3 | Per-Citizen cap (N names, base-rate only), enrollment bond, owner-signature + resolution requirement, credits gate priority | **ECONOMIC** | Calibrate N and bond against observed farming |
| R2 | Pool drain via premium short names | A2 | Base-rate-equivalent credit only; premium delta always member-paid | **HARD** (formula) | — |
| R3 | ETH/USD swing breaks coverage math | market | Stable buffer target ratio; CR computed with buffer margin; epoch spend cap (25%) prevents cliff drain | **ECONOMIC** | Extreme moves degrade tier, never insolvency-with-obligations (pool owes nothing it hasn't banked) |
| R4 | Renewal via wrong controller desyncs wrapped-name expiry | self-inflicted | RegistrarAdapter mandates the universal/wrapped-controller path (known v1 bug, documented) | **HARD** | Re-verify on every adapter swap |
| R5 | v2 no-grace expiry of an enrolled name | A4 (absence) | ≥6-month renewal horizon; 12-month Watchtower escalation; banked years are registrar-level and irreversible; resurrection lane (premium-exemption window) as last resort | **ECONOMIC**, converting continuously to **HARD** (banked years) | The honest formulation: already-banked years are HARD; future coverage is ECONOMIC |
| R6 | Sniper registers a member's just-expired name in premium window | A1 | Should never be reachable (R5 layers); resurrection lane races within the recent-owner exemption; Watchtower alarm at T-30d is a klaxon | **PROCEDURAL** | If all layers failed, market race — accepted residual |
| R7 | Keeper griefs by renewing wastefully | A4 | Renewals only extend member names (no harm vector); epoch budget caps spend; bounty paid per policy-conformant batch only | **HARD** (formula) | — |
| R8 | Referral-award clawback/rule change | A9 | Awards treated as bonus inflow, never budgeted (per spec §6) | **ECONOMIC** | — |

---

## 6. Sentinel lock, inheritance, guardians

| # | Threat | Adversary | Mitigation | Class | Residual |
|---|---|---|---|---|---|
| L1 | Wallet drainer moves a locked name | A7 | Transfer timelock + alert + panic freeze; drainer gets nothing during the delay | **STRONG** | Drainer who also waits out the timelock silently → Watchtower alert makes silence unavailable |
| L2 | Guardian collusion transfers the name | A5 | M-of-N + owner-veto window on guardian actions; guardians can accelerate recovery, never bypass the owner's veto while the owner key is live | **STRONG** | Collusion + owner key loss simultaneously — inherent to any recovery scheme; document plainly |
| L3 | Guardian loss bricks recovery | A5 (absence) | Guardian-set rotation is member self-service; dead-man's-switch as fallback path | **STRONG** | — |
| L4 | Premature inheritance claim | A5/A8 | Long inactivity threshold + escalating multi-channel pings + open challenge window on claims; owner activity anywhere resets | **PROCEDURAL** | Coerced "inactivity" undetectable on-chain — accepted, disclosed |
| L5 | Panic-freeze griefing | A1 | Panic callable only by owner/guardians per config | **HARD** | — |

---

## 7. Marketplace, leasing, foundry

| # | Threat | Adversary | Mitigation | Class | Residual |
|---|---|---|---|---|---|
| M1 | Name sold carrying hostile lingering v2 role grant | A8 | Mandatory role-grant enumeration pre-settlement; settlement blocks on unacknowledged grants (F4 rule from migration spec) | **HARD** (check) | Unknown/nonstandard registry implementations → warn-and-require-explicit-ack lane |
| M2 | Escrow bug releases funds and name asymmetrically | A1 | Atomic settlement (single tx), no custodial holding period; invariant §10-I6 | **HARD** (post-audit) | Audit target |
| M3 | Wash trading to fake category floors | A2 | Floors informational-only, never collateral inputs inside ENSPLUS; self-trade heuristics flagged in UI | **ECONOMIC** | External consumers of floor data warned |
| M4 | Homoglyph/lookalike listing phishing | A1 | Watchtower homoglyph detection integrated into listing UI; category bitmaps verified on-chain (unspoofable club tags) | **STRONG** | Novel confusables → detector updates |
| M5 | Lessee abuses resolution rights (scam site on leased name) | A8 | Leases are scoped, auto-expiring role/resolver grants; owner cancel-with-notice per lease terms; reputation attached to lessee Citizen | **STRONG** | Reputational harm within notice window — priced into lease terms |
| M6 | Fee bypass via off-platform settlement | A8 | Accepted; zero-fee member trades make bypass pointless by design | **ECONOMIC** | — |

---

## 8. Attestations, categories, credits, keepers

| # | Threat | Adversary | Mitigation | Class | Residual |
|---|---|---|---|---|---|
| T1 | Wrong Merkle root frozen (derivation error) | A10/error | Published derivation scripts; cross-check vs independent corpus (79,720-row prepunk set); public challenge period before freeze; leafVersion enables superseding roots via T2 without mutating old ones | **PROCEDURAL** → **HARD** after freeze | Errors after freeze → new versioned root, old one never lies about what it was |
| T2 | False hash-recovery claim | A1 | Claims self-verify (`keccak256(label) == labelhash`) — no trust surface exists | **HARD** | — |
| T3 | TCR bribery to ratify junk categories | A2 | Curated categories are cosmetic/filter-only (never weight-bearing for governance or pool math); juror adjudication; bonds | **ECONOMIC** | Junk category = embarrassment, not exploit — by construction |
| T4 | Credit farming via bot participation | A3 | Credits per Citizen (provenance-anchored); inverse-scaling emission caps total extractable; quality-independent participation accepted as residual (showing up is the point) | **ECONOMIC** | Monitor; tune emission floor |
| T5 | ERC-6551 Citizen account hijack | A7 | 6551 account controlled by NFT owner; NFT sits behind same Sentinel options as names; credits soulbound (theft of account ≠ liquid value) | **STRONG** | — |
| T6 | Keeper censorship/cartel | A4 | All jobs permissionless (cartel can't exclude), automation backstops for deadline-critical jobs; bounty formulas fixed (no rent to extract) | **ECONOMIC** | — |

---

## 9. Base layer, migration, off-chain

| # | Threat | Adversary | Mitigation | Class | Residual |
|---|---|---|---|---|---|
| B1 | ENS DAO/root authority alters name rights (registrar replacement, retroactive rules, v2 key abuse) | A9 | The only layer no wrapper can absorb. SO-1/SO-5/SO-9/SO-10 + bloc weight + public record; banked years already written are registrar-state | **POLITICAL** (+ banked years **HARD**) | This row is why the bloc exists; state it plainly in all materials |
| B2 | Fee regime weaponized (massive renewal price hikes) | A9 | SO-2 AGAINST; pool buffer absorbs shocks short-term; banked years immune | **POLITICAL** + **ECONOMIC** | Long-horizon exposure shared by every .eth holder on earth |
| B3 | Fake upgrade contract in migration | A6 | Article X: address matched to official artifacts, fork-run transcripts on-chain, post-condition assertions in adapter, per-position election | **PROCEDURAL** + **HARD** (covenant N-rules) | — |
| B4 | Partial/failed migration strands a position | error | M5 rollback path; atomic per-name execution with revert-on-postcondition-failure; legacy state valid indefinitely (no forced deadline) | **HARD** | — |
| B5 | Frontend compromise (malicious dApp build) | A11 | Self-contained single-file HTML builds (house pattern), content-hash pinned (IPFS/ENS contenthash), signed release manifest on-chain; all critical actions display raw calldata; contract-first docs so power users bypass UI entirely | **PROCEDURAL** | Users on unpinned mirrors — education + canonical-URL discipline |
| B6 | Impersonation of ENSPLUS (fake sites/tokens) | A1 | Canonical addresses attested on-chain + in ENS text records; Watchtower monitors lookalikes of the project's own names | **PROCEDURAL** | Perpetual whack-a-mole — staffed via bounties |
| B7 | Legal/coercive pressure on deployer or DAO LLC | A13 | Nothing to compel: no admin keys, no pause, no upgrade, no custody discretion post-deploy; entity-structure and securities-framing review by counsel pre-launch (utility-first positioning) | **HARD** (technical) / open (legal) | Not legal advice; engage counsel — this row is deliberately incomplete |
| B8 | Death spiral (participation collapse) | systemic | Custodian Mode: full autonomy continues, rule changes freeze, exit permanent | **HARD** | Worst case = reliable appliance, printed guarantee |

---

## 10. Invariants for audit and fuzzing (the properties that make HARD mean hard)

- **I1 Redeemability:** for every position, holder-initiated unwrap of the canonical current representation succeeds in all reachable states, including Custodian Mode and mid-migration (pre-execution).
- **I2 Covenant outflow:** no execution path transfers underlying assets to any address outside {position holder, ratified migration target during elected M1–M4}.
- **I3 Conservation:** sum of position records == vault holdings per custody class, at every block.
- **I4 No privileged mutation:** no function selector reachable post-deploy can alter covenant logic, splitter percentages, or attestation roots (versioned additions only).
- **I5 Vote-weight soundness:** external cast composition == live-mirror + PolicyA·SO + PolicyB·abstain, exactly; bloc mode reachable only via oracle-flag + T3 supermajority path.
- **I6 Settlement atomicity:** marketplace/lease settlement transfers value and rights in one transaction or reverts entirely.
- **I7 Cap enforcement:** no identity's effective internal weight exceeds cap under any wrap/split/delegate sequence (fuzz with sybil trees).
- **I8 Election supremacy:** no position with `v2Status ≠ UPGRADE_ELECTED` is touchable by the MigrationAdapter.
- **I9 Snapshot integrity:** no post-snapshot balance change affects a proposal's tally.
- **I10 Freeze soundness:** Sentinel timelock/panic states cannot be bypassed by any module, including migration (elected migrations queue behind active freezes).

---

## 11. Claims register (what ENSPLUS may say publicly, and the row that backs it)

| Public claim | Basis | Max strength wording |
|---|---|---|
| "ENSPLUS cannot take, move, or alter your name or tokens" | V1, V2, I1–I4 | "structurally impossible — verify the bytecode" |
| "Your exit can never be blocked" | V5, I1 | "always, including if we all disappear" |
| "Banked renewal years are irreversible" | R5 | "written into the ENS registrar itself" |
| "Your name can't be stolen" | L1–L2 | **Do not say this.** Say: "theft requires defeating your timelock, your guardians, and your alerts" |
| "Your name will never expire" | R5 | **Do not say this.** Say: "practically immune to expiry, and every banked year is absolute" |
| "The bloc can never vote itself your assets or ENS's treasury" | S7, SO-8, I2 | "structurally impossible" |
| "If everyone goes silent, nothing can be changed or taken" | B8, Custodian Mode | printable verbatim |
| "We protect you from ENS governance itself" | B1 | **Do not say this.** Say: "we are the community's organized vote on the one layer no contract can protect" |

Rule: marketing copy may only strengthen wording with sign-off against this register. Overclaiming is itself a threat (reputational A9 ammunition) and is treated as a vulnerability.

---

## 12. Standing review cadence

Re-run this model: before genesis (red-team pass on §4-S1 classification gaps, §3-G2 aged-name acquisition costs) · at every adapter ratification · at ENSv2 contract finalization (refresh §9-B3/B4 against real interfaces) · after any incident, upstream or internal · annually regardless. Protocol Watch owns the calendar; each review's diff is published on-chain.
