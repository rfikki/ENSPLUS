# ENSPLUS Contracts — Slice 4: Constitutional Machinery

Verified: 67/67 tests passing (slices 1–4) · compiled solc 0.8.26, optimizer 200, cancun.

## Contents
- `contracts/core/GovernorExecuted.sol` — execute-by-proposal base. Governance
  actuates contracts with NO execution engine and NO admin keys: anyone may call
  an execution function, which verifies a Succeeded proposal of sufficient kind
  whose descriptionHash binds (targetContract, actionTag, exactPayload), then
  consumes it. No cross-contract replay, no payload substitution, single-use.
- `contracts/core/ConstitutionRegistry.sol` — Layer 0 inscribed verbatim at
  construction, IMMUTABLE (no code path can touch it — tested); amendments
  ratified via Constitutional-kind proposals binding the exact text; supersession
  for amendments only, append-only history.
- `contracts/core/ModuleRegistry.sol` — manifest spec §5 machine checks on-chain:
  citations in force, canonical forfeitures acknowledged byte-exactly (the
  FORFEITURES_V1 text is a contract constant), EXTCODEHASH pinned, BOTH ERC-165
  ids verified (the LNR/GRDO supportsInterface lesson is now a revert), module
  self-reports its chartered id, permission-derived kind floor
  (TREASURY/ROLE/EXT -> Treasury-kind proposal), append-only versions, retire
  never deletes. Genesis bundle registers through the SAME checks, flagged.
- `contracts/core/StandingOrders.sol` — pipeline skeleton: genesis orders with
  citation checks; keeper-posted classifications; bonded challenges that must
  bind an Override internal proposal to the classification id; finalize resolves
  window-elapsed or override-decided; conflict rule AGAINST > ABSTAIN > FOR;
  unclassified externals abstain (never guesses). Bonds: refunded on successful
  override, forfeited to the splitter on failure.
- `contracts/interfaces/IENSPLUSModule.sol`, `contracts/test/MockModule.sol`
  (+ BadInterfaceModule reproducing the historical bug class).
- `test/Slice4.test.js` — 9 tests including two full civic-arc integrations:
  five citizens climb to T3 over three epochs, then amend the constitution /
  charter modules / adjudicate a contested classification with real bonds.

## Notable mechanics
- The kind floor is enforced twice independently: proposal CREATION gates on
  tier (governor), and EXECUTION gates on kind (GovernorExecuted) — a Standard
  proposal with a perfect payload hash still cannot ratify an amendment (tested).
- ProposalKindTooLow, PayloadMismatch, ProposalAlreadyConsumed each tested.
- Stack-too-deep fixes this slice: ModuleRegistered event split (ModuleIdBound
  emitted once per key); StandingOrders constructor scalars grouped into Config.

## Deliberate scope notes
- StandingOrders is a SKELETON: order criteria live off-chain (criteriaHash);
  the external-vote composition (mirror + Policy-A SO + Policy-B abstain) is
  GovernorAdapter work (slice 5). Fail-to-policy near external deadlines is an
  adapter concern reading classification status.
- ModuleRegistry does not yet enforce runtime permission USE (modules calling
  splitter/credit surfaces check registry status) — that wiring lands with the
  first real module (Renewal Pool slice).

## Next: Slice 5 — GovernorAdapter + AttestorRegistry
Adapter: delegatee of the vault, composes external casts from tally + policies +
SO positions (pending live ENS governor counting-module check for fractional vs
sharded). Attestor: LibAttestation roots + claim flow, wiring provenanceSource.
