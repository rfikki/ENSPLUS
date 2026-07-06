# ENSPLUS Contracts — Slice 5: The Bloc's Voice (Wave 1 structurally complete)

Verified: 74/74 tests passing (slices 1–5) · compiled solc 0.8.26, optimizer 200, cancun, zero warnings.

## Contents
- `contracts/core/AttestorRegistry.sol` — Registry of Elders: append-only Merkle
  roots (genesis + T2-proposal additions), claim-based provenance requiring
  CURRENT registrar ownership, single-binding-per-name with rebind-on-sale
  (no multiplier duplication path), best-era provenanceWad (era 0 = Prepunk =
  strongest, real data never sentinel), era table validated [1x..4x] and
  non-increasing with era code. Implements IProvenanceSource.
- `contracts/core/GovernorAdapter.sol` — external casting composition:
  MIRROR (quorum met): full external power split to exact internal tally
  proportions, integer remainder to ABSTAIN (never amplifies a direction);
  STANDING ORDER (quorum failed + classified): full power at SO position;
  ABSTAIN DEFAULT (unclassified): the system never guesses. Fractional params
  per GovernorCountingFractional packing (uint128 against|for|abstain).
  Internal→external binding enforced via descriptionHash — an unrelated tally
  can never speak for an external proposal. First-cast-wins per external.
- `contracts/core/GovernorAdapter.sol::VaultSteward` — the vault's single
  governed knob governed properly: delegatee redirection via consumed Override
  proposals; genesis ceremony precomputes the steward address so the vault
  constructs first (REHEARSED IN TEST: getCreateAddress nonce math asserted for
  both steward and attestor).
- `contracts/test/Slice5Mocks.sol` — MockRegistrar, MockExternalGovernor
  (decodes and records fractional params for exact assertions).

## Full-stack integration proven
Prepunk claim -> provenanceWad 2.0x -> governor rawWeightAt doubles a citizen's
voting weight (OZ tree built in JS, proof verified on-chain, weight asserted to
the wei). Name "sale" rebind drops the seller to their next-best era. The
redirect test performs the actual genesis move: bloc's 300 ENS underlying power
lands on the adapter via ratified proposal.

## Flagged for genesis review (deliberate v1 divergences)
1. ADAPTER COMPOSITION casts the WHOLE bloc by tally proportions / SO position;
   per-holder Policy A/B silent-weight composition needs aggregate
   policy-balance accounting (vault/governor hooks). Nothing is deployed —
   decide before genesis whether to add the accounting or ship v1 semantics.
2. FRACTIONAL CONVENTION (support byte, params packing) targets
   GovernorCountingFractional; VERIFY against the live ENS governor's counting
   module before genesis (the standing slice-5 empirical task — requires RPC).
3. SO-vs-live-vote ordering is first-cast-wins on-chain; keepers must prefer
   pending live votes (off-chain policy, autopilot fail-to-policy note).
4. Vault-custodied names cannot yet claim provenance (registrar ownerOf =
   vault); the NameVault position-holder claim path lands with Wave 2.

## Wave 1 status: STRUCTURALLY COMPLETE
Vault + Splitter + InternalGovernor + Constitution + ModuleRegistry +
StandingOrders + Attestor + Adapter + Steward. Remaining before genesis:
policy-accounting decision (above), live-governor verification, constitutional
text finalization, parameter review (capBps vs community size, ladders,
windows), external audit against invariants I1–I10.

---

## REVISION (post-governor-verification): directional casting

Verified against the live ENS DAO governor (governor.ensdao.eth, OZ Governor
deployed Nov 2021, GovernorCountingSimple / Bravo): it casts a delegate's FULL
weight to ONE option and predates GovernorCountingFractional. The original
proportional/fractional GovernorAdapter CANNOT run on it. Reworked to DIRECTIONAL
casting:

- Interface swapped IFractionalExternalGovernor -> INominalExternalGovernor
  (castVoteWithReason(proposalId, support, reason); Bravo support 0/1/2).
- "Mirror mode" now mirrors the internal DECISION, not the internal SPLIT: the
  bloc casts its FULL power in the winning direction (For/Against), or ABSTAIN
  when the internal vote is a tie OR the winner's share of decisive (for+against)
  weight is below `confidenceThresholdBps` (immutable, [5000,10000], tuned at
  genesis; tests use 6000). A divided bloc does not ram a narrow majority onto
  the DAO.
- Standing-Order and unclassified->abstain paths unchanged (full power at the SO
  position; abstain when unclassified — never guesses).
- Rationale: directional casting is STRICTLY MORE effective as a counterweight
  than proportional (a bloc that splits its own vote is weaker at changing
  outcomes). Minorities protected by (a) internal vote, (b) abstain-on-division,
  (c) rage-quit exit. Future fractional stays a swappable-adapter upgrade if ENS
  migrates governors.
- Tests: added the divided-bloc abstain case; suite 112/112.
