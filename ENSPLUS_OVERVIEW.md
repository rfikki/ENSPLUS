# ENSPLUS — The Complete Plain-Language Overview
### Mission, Vision, What's Broken, How We Fix It, and Everything We're Building

**Status:** Living document · **Date:** 2026-07-05 · **Companion to:** README.md (technical index), the five design specifications, and the contract slices.
**Wording discipline:** every guarantee stated here uses the approved language from the Threat Model's claims register (§11). Nothing below overclaims.

---

## 1. TL;DR

**ENSPLUS is a wrapper protocol for ENS tokens and .eth names that does two things at once: it reorganizes the scattered ENS community into a single, whale-resistant, constitution-enforcing voting bloc — and it makes holding a .eth name dramatically better, safer, and more fun than holding it raw.**

You deposit ("wrap") your ENS tokens and/or your .eth names into vaults with **no admin keys, no pause buttons, and no upgrade paths** — verify the bytecode, we can't touch them. In exchange:

- Your **governance voice finally counts**: inside ENSPLUS, voting power is square-rooted, capped at 2% per identity, weighted by how *early* your names are and how *often* you show up — so a founder-sized stack can never drown out a thousand citizens. Externally, all wrapped tokens vote as one bloc, computed by those fair internal rules and by an **executable constitution** that votes on autopilot when humans are busy.
- Your **name becomes practically immortal**: a revenue-funded Renewal Pool pays renewals, and every year it banks is written into the ENS registrar itself — irreversible, no matter what happens to ENSPLUS afterward.
- Your **name becomes hard to steal**: optional transfer timelocks, guardians, and a panic freeze mean a wallet drainer gets nothing.
- Your **history becomes provable and valuable**: 2017-era "prepunk" registrations, first-10,000 ranks, and category-club memberships (999 Club, 10k Club, and more) get certified on-chain with cryptographic proofs — and that provenance literally increases your voting power.
- Your **participation becomes a game worth playing**: an evolving Citizen identity, credits, seasons, guilds, raffles, leaderboards, and fully on-chain generative art that grows as your civic life does.
- Your **exit is always open**: unwrapping is feeless, queueless, pauseless, and cannot be blocked by anyone — including us, including our own majority.

One sentence: *ENS's founder holds power because everyone else went home; ENSPLUS is the place everyone comes back to — and it's built so that not even ENSPLUS can betray them.*

---

## 2. The Story So Far — What Actually Broke (in plain language)

### 2.1 What ENS is and why it matters
The Ethereum Name Service turns unreadable wallet addresses (0x63C6...) into human names (rocky.eth). It's arguably Ethereum's most important identity infrastructure: your .eth name is your username, your payment address, your website, and your reputation, all at once. Millions of names have been registered since 2017.

### 2.2 The promise: a constitution and a DAO
When ENS launched its token in 2021, it did something unusually principled: it published a **constitution** — four articles declaring that name ownership is an absolute right, that fees exist to prevent squatting rather than to maximize revenue, that income funds development and public goods, and that ENS integrates with the global namespace. Every airdrop claimer signed it. Governance went to a DAO: token holders would vote on everything, with the token explicitly framed as a *governance* instrument.

### 2.3 The decay: apathy compounds into capture
Then the familiar story: most airdrop recipients sold. Most holders never delegated or voted. Participation collapsed until a few million actively-delegated tokens out of a 100-million supply decided everything. In that vacuum, the founder's own allocation became decisive — by 2026, a single wallet could cast roughly 80% of the votes on a contested proposal and control roughly half of all delegated voting power.

### 2.4 The break: "a failed experiment"
In 2026 the founder declared DAO governance a failed experiment and advanced proposals to move the DAO-controlled treasury — hundreds of millions of dollars, exceeding the token's own market cap — to a centralized foundation with an appointed board. A Security Council designed to veto malicious proposals was voted down by that same single wallet. Long-time stewards resigned or protested; the constitution's own author fought the move from inside. Whatever one thinks of the intentions, the *mechanism* is undeniable: **low participation turned one person's holdings into control of everyone's protocol.**

### 2.5 The insult on top: your name got riskier, not safer
While the governance fight rages, ordinary holders' practical problems never got solved: names still expire and get sniped, wallets still get drained and names stolen, historic 2017 names have no official recognition, and the coming ENSv2 upgrade **removes the grace period entirely** — miss a renewal and your name (and everything under it) stops resolving instantly.

---

## 3. Mission & Vision

### Mission
**Reorganize the ENS community's dispersed voice into a coordinated, constitution-bound, whale-resistant force — and make wrapped participation so practically valuable that people join for the utility and stay for the governance.**

### Vision
A namespace where:
- **history is honored** — the 2017 pioneers' names carry provable, powerful, on-chain provenance;
- **names cannot quietly die or be quietly stolen** — expiry and theft become engineering problems with shipped solutions;
- **power flows to participants, not balances** — showing up, week after week, is the most rewarded act in the system;
- **the original ENS constitution is not a PDF but a program** — inscribed verbatim on-chain, enforced by code, voting on the community's behalf even when the community sleeps;
- and **no one — founder, whale, or ENSPLUS itself — can take what's yours**, because the taking paths simply do not exist in the bytecode.

### The core insight
Nick's power is other people's absence. **ENSPLUS's power is other people's presence** — and where presence is intermittent (as it always is), an executable constitution stands the watch. We do not fight a whale by becoming a whale; we fight capture by making capture structurally impossible in our own house first, and then bringing that house's full weight to the DAO.

---

## 4. What We Aim to Fix — and Exactly How ENSPLUS Fixes It

### Problem 1: One wallet outvotes everyone.
**Fix — aggregation plus fairness.** Individually, a holder with 500 ENS is statistically irrelevant, so they rationally stay home, which makes the whale stronger — a death spiral. ENSPLUS breaks it three ways: (a) **aggregation** — wrapped tokens delegate as one bloc, and with active delegation historically only in the single-digit millions, even a modest bloc becomes one of the most powerful delegates in the DAO; (b) **internal equality** — inside the bloc, weight = √(balance) × provenance × vesting × activity, hard-capped at 2% per identity, so a million-token whale counts as roughly 2–3× an ordinary citizen instead of 100×+ (this exact scenario is a passing test in our suite); (c) **visible payoff** — participation mints credits, badges, and status, so showing up stops feeling pointless.

### Problem 2: Governance tricks — the abstain-then-hammer.
**Fix — commit-reveal voting.** The observed playbook upstream: stay silent through the temperature check, then drop a decisive stack at the binding vote. Inside ENSPLUS, every ballot is a sealed cryptographic commitment; nothing is knowable until the reveal phase. Interim tallies are provably empty (tested), so there is nothing to snipe and no verifiable way to sell a vote mid-count. Commitments are bound to the chain, the contract, the proposal, and the voter — a copied commitment is worthless to the copier (tested).

### Problem 3: Sybils — one whale pretending to be a thousand citizens.
**Fix — provenance anchoring.** Splitting tokens across wallets is free; splitting *history* is not. Voting multipliers anchor to attested .eth name age: a May-2017 "prepunk" registration is among the most expensive credentials in crypto to fake. Whales can make wallets; they cannot make 2017.

### Problem 4: Empty-room capture — a quiet DAO votes itself the treasury.
**Fix — the tier ladder.** Dangerous powers *do not exist* below participation thresholds. At Tier 0, only formulas and standing orders operate; category votes unlock at T1; treasury discretion and new charters at T2; constitutional amendments and bloc-mode at T3 — each tier requiring real distinct citizens and real turnout, measured over a trailing window, demoting when a quiet epoch appears (tested both directions). You cannot vote yourself anything interesting in an empty room, because the proposal type cannot even be created there.

### Problem 5: Apathy makes the system stop working.
**Fix — the constitutional autopilot.** Operations run by formula; governance is needed only to *change* things, never to *run* them. Renewals fire, tithes route, epochs close, and — crucially — **the bloc still votes** via Standing Orders: a ratified rulebook (grounded article-by-article in the original ENS constitution) that classifies each ENS DAO proposal and casts the default position: AGAINST anything that seizes names, AGAINST moving treasury outside tokenholder control, AGAINST degrading tokenholder authority, ABSTAIN on budgets and personnel (the system never auto-votes on people), FOR namespace integration and veto protections. Any citizen can bond a challenge against a classification, escalating to a live vote; live votes always override; conflicts resolve to the most protective position; the unclassified defaults to abstain — **the system never guesses**. Worst case of total silence is **Custodian Mode**: everything keeps running, nothing can change, exits stay open. Printable guarantee: *if we all go quiet forever, nothing can be changed and nothing can be taken.*

### Problem 6: "But then ENSPLUS is just a new whale."
**Fix — we can't be, structurally.** The vaults have no owner, no admin, no pause, no upgrade, and no path by which any majority — including ours — can move your assets anywhere but back to you (or, for names you *affirmatively elect*, into a constitutionally-ratified migration). The forfeitures are a canonical text every module must acknowledge byte-for-byte at registration; a proposal to violate them isn't defeated at the ballot — the registry refuses to schedule it. Standing Order 8 makes the bloc structurally unable to vote value to itself, pre-empting the "raid vehicle" accusation with bytecode. Default external voting is **mirror mode** (proportional pass-through), not winner-take-all; below quorum the bloc abstains rather than letting a tiny clique speak for everyone; bloc mode exists only for constitutional emergencies at supermajority. And every rule change carries a **rage-quit window** — nobody is ever governed by rules they didn't have the chance to exit before.

### Problem 7: Names die, get stolen, and get no respect.
**Fix — the utility layer** (the full catalog is §6). Renewal Pool + banked years attack expiry; Sentinel Lock + Watchtower attack theft; the Registry of Elders attacks historical erasure; the Citizen system attacks the pointlessness of participation. People wrap for selfish, practical reasons — and the constitutional delegate grows stronger with every wrap. That's the strategic elegance: **utility recruits; governance compounds.**

### Problem 8: ENSv2 changes everything underneath us.
**Fix — adapter architecture + Article X** (details §8). The core knows no ENS addresses; every external touchpoint is a swappable, ratified adapter; migration is a per-name, affirmative, holder-elected act through a slot that is *born empty* and fillable exactly once by constitutional supermajority. Legacy is a valid permanent home. Exit supersedes migration, always.

---

## 5. How It Works — The Machine, in Plain Language

**Two vaults.** The **Token Vault** wraps ENS tokens 1:1 into ENS+ (transferable, checkpointed for voting snapshots, vesting-tracked to kill flash-wrap attacks). The **Name Vault** wraps .eth names — both unwrapped (registrar) and v1-wrapped (NameWrapper) forms — into position NFTs, **while resolution control stays with you**: the wrap transaction itself hands Registry control straight back, so your name resolves identically the block before and after wrapping. We take custody of the *asset*, never of your *records*.

**One internal government.** Proposals move through Pending → sealed Commit → Reveal → Ended. Weight is quadratic, capped, provenance-boosted, vesting-ramped, and decays with dormancy (regenerating the moment you vote). Epochs close permissionlessly; distinct citizens and turnout drive the tier ladder. Every holder explicitly elects how their *silent* weight behaves — follow the constitution (Policy A) or always abstain (Policy B) — and silence never empowers anyone by default.

**One external voice.** The vault's entire underlying ENS delegates to the **GovernorAdapter**, which composes each ENS DAO vote: quorum met → exact proportional mirror of the internal tally (remainders go to abstain, never amplifying a side); quorum failed → the Standing Order position at full weight if classified, full abstain if not. Every cast carries a public reason string and is fully reconstructible on-chain, forever. Even redirecting the delegation itself requires a ratified proposal executed permissionlessly — there is no hand on that lever, only a process.

**One constitution, executable.** The original four ENS articles sit inscribed verbatim, immutable, with provably no code path that can alter them. ENSPLUS amendments (fair governance, the utility mandate, module sandboxing, the public-goods tithe, exit sovereignty, continuity) ratify one at a time via supermajority + rage-quit window. Every feature module must cite its authorizing article, acknowledge the forfeitures byte-exactly, declare its Tier-0 behavior, and pass on-chain machine checks — **including ERC-165 interface verification, so a bug class we personally shipped twice in earlier projects is now a revert message.** No override path exists; a supermajority can amend the rules (with exits open first) but can never skip them.

**No admin, anywhere.** Governance actuates contracts through the execute-by-proposal pattern: anyone may call the execution function, which verifies that a passed proposal of sufficient kind bound *this contract, this action, this exact payload* — then consumes it, once. Wrong text fails. Wrong contract fails. Reused proposal fails. A lesser-kind proposal with a perfect payload fails. All tested.

---

## 6. The Complete Feature Catalog

### 6.1 Governance & protection of the bloc (built ✅ / designed 📐)
- ✅ **Whale-resistant internal voting** — quadratic + 2% cap + provenance + vesting + dormancy decay.
- ✅ **Commit-reveal ballots** — sniping and mid-vote bribery structurally dead.
- ✅ **Participation tier ladder + Custodian Mode shape** — powers exist only where citizens do.
- ✅ **Standing Orders engine** — classification, bonded challenges, override votes, most-protective conflict rule, never-guess default.
- ✅ **Mirror/SO/abstain external casting** with on-chain reasons (SO-M3 transparency).
- ✅ **Execute-by-proposal everywhere** — zero admin keys across nine core contracts.
- 📐 **Bloc mode** (constitutional-emergency winner-take-all at 75%+, Oracle-flagged only), **delegated-abstention opt-out lanes**, **permissionless circuit breaker** (bonded revote at elevated quorum), **futarchy-lite prediction markets**, **delegate intelligence bounties**, **Protocol Watch desk** (fork of ENS's own dao-proposal-monitor).

### 6.2 Name immortality (built ✅)
- ✅ **Renewal Pool — the Eternal Flame**: Coverage Ratio drives four tiers — Ember (raffles), Kindled (pool matches your year), Steady (every enrolled name renewed each epoch), Eternal (full coverage + surplus tithed to public goods). 25% epoch spend caps make bad quarters degrade gracefully, never catastrophically. Renewals route through the desync-safe wrapped-controller path with the pool as referrer — the pool **earns ENS referral awards on its own spending**.
- ✅ **Banked years** — every executed renewal writes tenure into the ENS registrar itself. *This is the strongest guarantee in the entire system:* a name renewed ten years forward is untouchable by expiry for ten years even if ENSPLUS vanishes. The Decade Club leaderboard makes immortality a status game.
- 📐 **Watchtower** — 12-month escalation alerts, resolver-change and transfer-attempt alarms, homoglyph/impersonation detection; **resurrection lane** using ENSv2's recent-owner premium exemption as the last-resort recovery.

### 6.3 Name security & continuity (📐 next slices)
- **Sentinel Lock** — opt-in transfer timelocks, M-of-N guardian co-signs, instant panic freeze: a wallet drainer gets *nothing* during the delay. Honest wording (per our claims register): "theft requires defeating your timelock, your guardians, and your alerts."
- **Inheritance / dead-man's switch** — beneficiaries, escalating warning pings, contested-claim windows; social recovery for the Citizen identity. Nobody has solved succession for decade-scale name assets; we intend to.

### 6.4 History, provenance & the clubs (built ✅ / data pipeline 📐)
- ✅ **Registry of Elders (AttestorRegistry)** — Merkle-attested eras (Prepunk ≤ 2017-06-23, Auction, Permanent, Modern) and ordinal ranks (rank 1 = rilxxlir.eth), claim-based with proofs, bound to current name ownership: **sell the name, the provenance goes with it** — no duplication path. Prepunk provenance = 2.0× voting weight, proven end-to-end in tests.
- ✅ **Algorithmic category bits** — 999/10k/100k Clubs, 3-letter, palindromes, repeated-char — computed from the label in pure Solidity, unspoofable, free.
- 📐 **Curated categories (TCR)** — citizens propose and ratify the long tail (Common English, Crypto Words...) with bonded challenges; the taxonomy becomes a public good every marketplace can read. **Guilds** per category with quests and standings; **set-collection** bonuses; **hash-recovery bounties** — self-verifying preimage claims (`keccak(label) == hash`) turn recovering the lost 2017 "blank" names into a permanent, paid dig site.
- 📐 **Derivation pipeline** — three-way diff (BigQuery chain events × the 79,720-row Grails corpus × ENS subgraph), reproducible scripts published so anyone can re-derive every root.

### 6.5 Identity, social & the game (📐)
- **Citizen NFTs (ERC-6551)** — your governance identity as a token-bound account: badges, streaks, credits, and attestations live *in* it; other protocols can read it; following the Citizen account on EFP means **following the name itself**, an edge that survives wallet rotations and sales — new to the entire identity stack.
- **Credits & seasons** — soulbound participation credits (unbuyable priority), inverse-scaling emissions (quiet epochs pay more per voter), quorum-hero honors for the marginal voter the system actually needed, raids around contested ENS proposals.
- **Social module (charter drafted ✅, prototype built ✅)** — Ethereum Identity Kit profiles across every surface; EFP civic tags; and a **trust-graph score** where only follows *from provenance-anchored citizens* count (our runnable prototype proves a 30-wallet sybil ring and 500 bought followers score exactly 1.0×), hard-capped at +25% and — by two-key design — **unable to touch governance until a separate ratified activation**.
- **The Airdrop Magnet** — sybil-resistant, participation-scored citizenship is the distribution filter every new protocol wants; citizens receive quality drops for simply being real.

### 6.6 Markets & services (📐)
- **Member marketplace** — zero protocol fee between citizens, settled inside the vault (Sentinel rules travel with the position), with the mandatory v2 role-grant enumeration check so nobody buys a name carrying a hostile lingering permission.
- **Name leasing** — time-boxed, auto-expiring resolution grants: idle portfolio names earn; ownership never moves.
- **Subname Foundry** — issuance, rentals, royalty routing; ENSIP-10 wildcard resolution; goes fully native under v2's hierarchical registries.
- **Bulk operations desk**, **notary module** (sign documents *as* your name), **named messaging & payment requests** with stealth-address privacy, **on-chain profile hub** rendered from chain state.
- **Citizen Resolver (opt-in)** — a standards-conformant resolver exposing `ensplus.era`, `ensplus.rank`, `ensplus.guild`, `ensplus.banked-years` as ordinary text records, so every ENS app on earth displays your civic identity without knowing we exist. **We never replace ENS resolution — no ENSPLUS primary names, no reverse registrar; ENS resolves, ENSPLUS attests.**

### 6.7 Art (direction chosen 📐)
- **The Specimen Plate** — every name rendered as a fully on-chain typographic artifact: parametric glyphs seeded by the namehash, era-graded paper and ink (Prepunk on foxed vellum), engraved rank ("PLATE №341 OF THE FIRST THOUSAND"), category-driven ornamental borders, and **banked years accumulating as date stamps in the margin** — the art literally grows as your name becomes more immortal. Heraldic achievements reserved as the candidate Citizen-avatar system; the resolution constellation as the candidate animation layer. Every label treated as hostile input (sanitization per the ENS metadata-service lessons); non-normalizable 2017 legacy names get a first-class display lane, never a rejection.

### 6.8 Revenue & public goods (built ✅)
- ✅ **RevenueSplitter** — payees and percentages fixed at construction, permissionless flush, remainder-handling to zero dust, no mutators but flush. Changing the slices requires a constitutional amendment and a successor deployment — the funding can never be quietly redirected. The tithe line honors original Article III: a fixed cut of eternal surplus flows to Ethereum public goods, forever.

---

## 7. The Guarantees — Stated Honestly

We classify every promise by what actually enforces it, and our marketing is contractually bounded by this table (overclaiming is treated as a vulnerability):

| We say | Strength | What enforces it |
|---|---|---|
| "ENSPLUS cannot take, move, or alter your names or tokens" | **HARD** | Immutable bytecode; no admin surface; covenant outflow rules; invariants I1–I4 as executable tests |
| "Your exit can never be blocked — including if we all disappear" | **HARD** | Unwrap is feeless, queueless, pauseless, dependency-free |
| "Banked renewal years are irreversible" | **HARD** | Written into the ENS registrar itself; survives ENSPLUS |
| "The bloc can never vote itself your assets or ENS's treasury" | **HARD** | SO-8 + covenant + registry refusal |
| "If everyone goes silent, nothing can be changed or taken" | **HARD** | Custodian Mode + tier ladder |
| "Theft requires defeating your timelock, your guardians, and your alerts" | **STRONG** | Sentinel configuration (never say "can't be stolen") |
| "Practically immune to expiry" | **ECONOMIC → HARD** | Pool funding converts continuously into registrar-hard banked years (never say "will never expire") |
| "We are the community's organized vote on the one layer no contract can protect" | **POLITICAL** | The bloc, the Standing Orders, the public record (never say "we protect you from ENS governance itself") |

Residual honesty: the ENS base layer itself — fees, registrar rules, v2's root keys — is the one threat no wrapper can absorb. That is *precisely why the governance half exists*: SO-1 (name ownership inviolable) and SO-9 (v2 key minimization) are the immutability policy for the only layer we can't code around.

---

## 8. ENSv2 — Ready Before It Arrives

ENSv2 (now L1-only after the Namechain cancellation) launches with every existing name pre-upgraded into a legacy state that keeps resolving untouched; upgrading is per-name and opt-in. Our posture, already built into the shipped contracts: the core knows **zero** ENS addresses (adapters only); every position carries a v2Status; **elections are affirmative and rescindable, silence means legacy forever, and legacy is a valid permanent home**; the migration slot is born empty, fillable exactly once by constitutional supermajority, and releases *only* elected positions *only* to the ratified adapter — all of this passing tests today. v2's no-grace-period expiry makes the Renewal Pool near-mandatory infrastructure (our ≥6-month renewal horizon exists for exactly this), and v2's per-name registries are an open invitation for the endgame product: **Mode B custody**, where you keep ownership and ENSPLUS becomes the constitutional operating system your name *runs* rather than the vault that holds it.

---

## 9. Where We Are — Built, Designed, Planned

**Built and verified (88/88 tests, 10,494 cross-fuzz checks, zero mismatches, solc 0.8.26):** the three pure libraries (categories, attestation, weight math); TokenVault + RevenueSplitter with invariants I1–I4 as executable tests; the complete InternalGovernor (commit-reveal, tallies, epochs, tiers); ConstitutionRegistry, ModuleRegistry with on-chain machine checks, StandingOrders pipeline; AttestorRegistry, GovernorAdapter, VaultSteward (genesis ceremony rehearsed with address precomputation); NameVault (dual custody, D7 controller retention, per-owner index, Article-X slot); RenewalPool, chartered through the ModuleRegistry as its first real module. Plus the Social module charter and the runnable trust-graph prototype against the live EFP API.

**Designed in the five specifications:** Sentinel/Watchtower/inheritance, Citizen/credits/seasons, marketplace/leasing/foundry, curated categories/guilds/bounties, the Specimen Plate system, Protocol Watch, the v2 migration kit (M1–M5).

**Gating genesis (deliberately):** the derivation dry-run (freezes era/rank semantics against three independent corpora); the constitutional text in ratifiable language; the live-ENS-governor fractional-voting verification; the policy-accounting decision for per-holder silent-weight composition; parameter review (cap vs community size — a real finding from our own tests); legal review of entity and securities framing (utility-first, not profit-promise); and an external audit scoped to invariants I1–I10. We ship when the audits say so — not when a roadmap does, and not when ENS Labs' schedule does.

---

## 10. Why You Can Trust This (the short course in our paranoia)

1. **Read the bytecode — it can't.** Not "we promise not to." The taking paths do not exist.
2. **Every feature arrives chartered.** Constitutional citation, forfeitures acknowledgment, Tier-0 declaration, threat rows, and machine checks no majority can skip — welded into one on-chain document per module.
3. **We wrote our attack surface down first.** Fourteen adversaries, ~45 threats, ten formal invariants, and a claims register that forbids our own marketing four specific sentences.
4. **Exit is sacred.** Feeless, always-on unwrap; rage-quit windows before every rule change; elections rescindable; exit supersedes migration.
5. **We rehearse the scary parts.** The genesis deployment ceremony's address mathematics is a passing test. The anti-farming cap caught its own author's test plan. The interface bug we shipped twice in past projects is now a named revert with a regression test.
6. **We tell you what's weak.** The v1 raffle randomness is blockhash-based (flagged, VRF is the upgrade path). The v1 adapter casts whole-bloc rather than per-holder policy (flagged, decision pending). Small communities flatten under the 2% cap (found by our own tests, documented with the genesis-parameter answer). Honest systems age better than perfect-sounding ones.

---

## 11. Glossary (thirty seconds each)

**Wrapping** — depositing an asset into a vault and receiving a claim token; here, always 1:1 and always reversible. **Quadratic voting** — weight grows with the square root of holdings: 100× the tokens buys 10× the voice. **Commit-reveal** — vote sealed as a hash first, opened later; nobody sees interim results. **Standing Order** — a pre-ratified rule for how silent weight votes on a class of proposals. **Tier ladder** — governance powers that only exist above participation thresholds. **Custodian Mode** — the frozen-but-fully-functional state under prolonged silence. **Banked years** — renewal time already written into the ENS registrar; irreversible. **Coverage Ratio** — pool balance divided by the annual cost of renewing every enrolled name. **Prepunk** — registered before CryptoPunks launched (May 9 – June 23, 2017); the apex provenance era. **Rage-quit window** — the exit period before any rule change binds you. **Mode B** — the ENSv2-era goal: you keep ownership, your name runs the constitution.

---

*The DAO's failure was never the idea of shared governance — it was shipping shared governance with no floor under it. ENSPLUS is the floor: a constitution that executes, vaults that cannot betray, history that counts, names that cannot quietly die, and a game worth showing up for. The experiment isn't failed. It was never properly run. We intend to run it.*
