# ENSPLUS — External Audit Scope

**Prepared:** 2026-07-05 · **Commit:** see ARCHIVE_MANIFEST.md checksums
**Toolchain:** solc 0.8.26, optimizer runs=200, evmVersion=cancun, **no viaIR** · OZ 5.1.0
**Tests:** 146/146 passing (Hardhat) · cross-fuzz EVM≡JS (0 mismatches) · stateful invariants I1–I10

This document defines exactly what is IN scope, what is OUT and why, the security
model, the invariants to verify, the known/accepted findings, and the questions
we most want answered. It is written so a firm can quote against it precisely.

---

## 1. One-paragraph system description
ENSPLUS is an **ownerless** wrapper over ENS. Holders wrap ENS governance tokens
(→ "ENS+") and .eth names into immutable vaults; a whale-resistant InternalGovernor
(quadratic + per-identity cap + provenance weighting + commit-reveal) decides how
the pooled tokens vote at the real ENS DAO, cast DIRECTIONALLY via an adapter. A
name-protection layer (renewal pool, opt-in theft timelocks, expiry watchtower)
and a read-only identity/trust layer (provenance attestation, L1-native reputation,
zkPassport humanity, an ENS resolver for civic records) sit on top. There is **no
owner, admin, pause, or upgrade** anywhere; all privileged actions are
execute-by-proposal, and holder exit is always feeless and ungateable.

## 2. IN SCOPE — 22 contracts, ~3,045 SLOC
**Custody & value (highest priority):**
- `ENSPLUSVault.sol` (116) — 1:1 ERC20 wrap, checkpoints, vesting, holderCount
- `NameVault.sol` (241) — dual custody U-721 / W-1155, controller retention, per-owner index, migration + sentinel slots
- `RevenueSplitter.sol` (57) — immutable payees, permissionless flush
- `RenewalPool.sol` (258) — CR tiers, epoch budgets, matching, raffle (prevrandao), tithe, banked years

**Governance & constitution:**
- `InternalGovernor.sol` (333) — commit-reveal, capped quadratic tallies, epochs, tier ladder, silentPolicy registry
- `GovernorExecuted.sol` (40) — execute-by-proposal, zero admin keys
- `ConstitutionRegistry.sol` (112), `ModuleRegistry.sol` (195), `StandingOrders.sol` (220)
- `GovernorAdapter.sol` (149) — directional external casting · `AttestorRegistry.sol` (94) · `VaultSteward` (in-tree)

**Name protection:**
- `SentinelLock.sol` (236) — opt-in transfer/unwrap timelocks, M-of-N guardians, panic freeze
- `Watchtower.sol` (156) — expiry escalation, keeper checkpoints, resurrection anchor (pure observation)

**Identity / trust (read-mostly):**
- `Citizen.sol` (108) + `ParticipationCredits.sol` (37) — soulbound identity + ERC-6551 account, charter-gated credits
- `TrustOracle.sol` (146) — read-only reputation aggregator
- `HumanAttestor.sol` (91) — ownerless zkPassport proof-of-humanity
- `CitizenResolver.sol` (~230) — ENS resolver for `ensplus.*` civic records: forward (addr/text/contenthash) + reverse (EIP-181 name); ENSIP-10 + CCIP; label↔node binding verified

**Libraries:** `LibWeight` (49), `LibAttestation` (60), `LibCategory` (44), `LibTrust` (100)

**External deps (trusted, NOT re-audited):** OpenZeppelin 5.1.0 (ERC20/721, Checkpoints,
MerkleProof, Math, ReentrancyGuard, Strings). The zkPassport verifier is an external
immutable dependency; its internals are out of scope (we verify our integration only).

## 3. OUT OF SCOPE (and why)
- **All `contracts/test/**` mocks/harnesses** — test-only, never deployed.
- **JS tooling & SDK** (`tools/`, `ensplus-utils`) — off-chain; the deterministic
  deploy script and gas snapshot are provided as artifacts, not audit targets.
- **Deferred, asset-moving features (later, separately-audited waves):**
  marketplace, leasing, Subname Foundry, inheritance / dead-man's-switch, curated-
  category TCR / guilds / bounties, the Specimen Plate art module. These MOVE assets
  and each warrants its own review; bundling them would bloat this audit's surface.
- **Wave-3 ENSv2 migration kit** (MigrationAdapter M1–M5, RegistrarAdapter v2) —
  cannot be finalized until ENSv2 contracts are live; the NameVault migration slot
  is in scope (born empty, one-shot, Article-X-gated) but its future occupant is not.
- **Off-chain derivation** of era/rank and the genesis Merkle root — verified by a
  separate reproducibility process (see FROZEN_DERIVATION_SPEC.md); the audit takes
  the root as a given input.

## 4. Security model & trust assumptions
- **Ownerlessness:** no owner/admin/pause/upgrade. The only state-changing privileged
  paths are (a) execute-by-proposal via GovernorExecuted, and (b) one-shot,
  election-gated slot fills: `setSentinel`, `setMigrationAdapter`, `addRoot`
  (born-empty, fill-once or ratified). Confirm no other privileged surface exists.
- **Exit is sacred (covenant C4):** unwrap/withdrawal is always feeless and can never
  be paused or gated by governance. SentinelLock is the holder's OWN opt-in lock and
  must never trap an unarmed owner.
- **Trust in externals:** OZ libraries; the zkPassport verifier (integration only);
  the ENS registry/registrar/wrapper addresses (immutable constructor args); and the
  attested Merkle root (correctness of derivation is out of scope).
- **ETH handling** (review for reentrancy/rounding/stuck funds): ENSPLUSVault,
  NameVault, RenewalPool, RevenueSplitter, StandingOrders, Citizen, CitizenResolver.

## 5. Invariants to verify (I1–I10 + trust/observation properties)
Executable in the suite; please confirm and attempt to break:
- **I1–I4 (vault):** wrap/unwrap is 1:1 and conserved; totalSupply == Σ balances;
  no mint/burn outside wrap/unwrap; checkpoints monotone. (800-op stateful test.)
- **I7 (governor cap):** no identity's counted weight exceeds capBps·capBase; quadratic
  applied on snapshot balances; commit-reveal prevents vote-buying/late reveal games.
- **I10 (sentinel):** an ARMED position never leaves (transfer OR unwrap) without a
  matured, kind-matching, unfrozen release; an UNARMED owner is never gated. (Stateful
  randomized model-equivalence test.)
- **Watchtower:** levelFor is a monotonic step function; watchedCount == live active
  watches; lapsedAt set-once; Escalated iff worsened. (Pure observation — no custody.)
- **Trust:** reputation ∈ [0,10000], multiplier ∈ [1e18,1.25e18] for all inputs;
  monotonic non-decreasing in every positive signal (no punishment for participating).
- **Constitution:** modules cannot exceed their chartered permissions; forfeitures
  byte-hash enforced; execute-by-proposal cannot be spoofed; adapter casts only the
  ratified direction (or abstains) — never fabricates a vote.

## 6. Known / accepted findings (documented, not defects)
See DECISIONS_RESOLVED.md for full rationale.
- **Silent weight = abstain (v1):** Policy A/B is recorded but not composed (the ENS
  governor has no fractional voting); the registry is a reserved forward hook.
- **Cap flattening:** a fixed capBps yields "≤2% per identity" only at one community
  size; smaller communities flatten. Intended; genesis sets capBps conservatively.
- **Raffle randomness:** block.prevrandao (RANDAO), not VRF — appropriate for the
  one-renewal stake; once-per-epoch guard prevents grinding.
- **Watchtower / TrustOracle / CitizenResolver are READ-ONLY:** they can revert or
  return stale-until-checkpoint data but cannot move assets or mis-cast votes.

## 7. Questions we most want answered
1. Any path to a privileged action outside execute-by-proposal or the one-shot slots?
2. Any way to gate, delay, or fee a holder's unwrap/exit (violate covenant C4)?
3. Can SentinelLock trap an unarmed owner, or release an armed one early / while frozen?
4. Can the GovernorAdapter cast a direction not ratified internally, or double-cast?
5. Reentrancy / rounding / stuck-ETH in the seven ETH-handling contracts, especially
   RenewalPool matching + tithe and RevenueSplitter flush.
6. Commit-reveal: any snapshot-timing, front-run, or late-reveal manipulation of tallies.
7. Genesis ceremony: can predicted-address wiring be front-run or mis-bound?
8. Can any module, once chartered, exceed its permissions or touch vaulted principal?

## 8. Deliverables provided to auditors
Full source + 144-test suite (runnable via `node tools/build.js && npx hardhat test
--no-compile`), the threat model (14 adversaries, ~45 threats, claims register),
DECISIONS_RESOLVED.md, FROZEN_DERIVATION_SPEC.md, `.gas-snapshot`, the deterministic
deploy blueprint, and this scope document. Reproducible build: pinned solc 0.8.26,
runs=200, cancun, no viaIR; checksums in ARCHIVE_MANIFEST.md.
