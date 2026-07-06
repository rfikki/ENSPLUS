# ENSPLUS Contracts — Slice 8: Citizen (identity + chartered credits)

Verified: 95/95 tests passing (slices 1–8) · 10,494 fuzz checks unchanged · solc 0.8.26, optimizer 200, cancun, zero warnings.

## Contents
- `contracts/core/Citizen.sol` — the civic identity ("ENSPLUS Citizens"):
  * SOULBOUND, one per member (mint-only _update; transfers & approve-then-
    transfer both revert — civic standing has no market).
  * MEMBERSHIP-GATED mint: requires ENS+ balance or a NameVault position.
  * CREATE2 token-bound account (CitizenAccount) per Citizen, owner-gated
    execute, deterministic address (predictAccount view asserted == deployed).
    FLAGGED: evaluate canonical ERC-6551 registry binding at genesis; the
    interface shape (owner-via-NFT, gated execute) already matches.
  * Soulbound CREDIT ledger; mintCredits gated at RUNTIME by
    moduleRegistry.hasActivePermission(caller, P_CREDIT).
- `contracts/core/ParticipationCredits.sol` — the first P_CREDIT charter module:
  claim(proposalId, voter) credits a REVEALED ballot once (100 credits, flat v1),
  permissionless on the voter's behalf (keeper-batchable).
- `contracts/core/ModuleRegistry.sol` — extended with implRef reverse lookup +
  hasActivePermission runtime charter check (slice-4 machine-check tests intact).

## The load-bearing lesson this slice
The manifest's permission taxonomy is now enforced AT USE, not just at
registration: an EOA or any unchartered contract calling Citizen.mintCredits
reverts (NotCreditModule), and RETIRING the module through a governance proposal
stops its credit minting the SAME BLOCK — proven end-to-end (climb tiers →
retire via Standard proposal → old revealed votes become unclaimable).

## Genesis ceremony finding (fixed, and turned into a test)
The credit module must be chartered against LIVE bytecode — the registry's
EXTCODEHASH check (machine check 4) refuses empty code by design. That forces a
deploy ordering: Citizen → ParticipationCredits → Registry(last), with the
registry address PREDICTED so Citizen can reference it. Two tests lock this in:
one asserts the correct ceremony produces an active charter; one asserts the
naive ordering (charter a predicted, not-yet-deployed address) reverts with
CodeHashMismatch. The soundness property (no chartering vaporware) is now a
guarantee, not an accident.

## Deliberate scope notes
- Credit emission is flat v1; inverse-scaling epoch rewards + streak multipliers
  are the designed module v2 (autopilot §inverse-scaling), a future amendment.
- Citizen tokenURI is OZ default until the Specimen gallery module binds.
- Wallet-rotation recovery for the soulbound identity is a designed later
  mechanism (guardian / dead-man's-switch family), never transferability.

## Next candidates
Sentinel Lock (NameVault transfer timelocks/guardians/panic, I10) · Specimen
Plate HTML testbed · derivation dry-run scripts.
