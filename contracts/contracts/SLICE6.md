# ENSPLUS Contracts — Slice 6: NameVault (Wave 2 begins)

Verified: 81/81 tests passing (slices 1–6) · compiled solc 0.8.26, optimizer 200, cancun, zero warnings.

## Contents
- `contracts/core/NameVault.sol` — dual-custody .eth name wrapper ("ENSPLUS Names", ENS+N):
  * U-721 (BaseRegistrar, tokenId = uint256(labelhash)): wrap takes registrar
    custody and calls reclaim() to the MEMBER in the same transaction —
    Registry control / resolver / records never leave them (decision D7,
    asserted in test: registryController == member while vault holds the token).
  * W-1155 (NameWrapper, tokenId = uint256(namehash)): fuses + expiry
    snapshotted at wrap-in (the F7 wrapper-aware upgrade path input); member
    granted NameWrapper record approval on wrap-in.
  * Position NFT id == underlying id; custodyClass disambiguates hash spaces.
  * Per-owner index (D9): O(1) swap-and-pop maintenance, positionsOf(owner)
    bounded by the holder's own count, NO global enumeration surface anywhere.
  * v2Status ladder LEGACY -> UPGRADE_ELECTED -> UPGRADED, holder-elected,
    rescindable; unwrap clears elections (exit supersedes migration, C4/Art IX).
  * Migration slot BORN EMPTY: fillable exactly once, Constitutional-kind
    proposal only (Treasury-kind with a perfect payload tested to fail);
    executeMigration releases ONLY elected positions, ONLY to the adapter (I8).
  * Unsolicited-transfer guards: 1155 receiver accepts only the vault's own
    pull (operator == vault, id == expected); batch pushes always revert (V4/V6).
  * Complete ERC-165 set declared and TESTED: 165, 721, 721Metadata,
    1155Receiver — the LNR line-382 / GRDO lesson closed with an assertion.
- `contracts/test/Slice6Mocks.sol` — MockBaseRegistrar (real ERC721 + reclaim
  semantics), MockNameWrapper (real ERC1155 + fuses + attackTransfer helper).

## Covenants C1–C4 (name edition) — enforcement map
C1 outflow: unwrap-to-owner + elected-migration-to-adapter are the only
release paths (both tested, including the NotElected and NotMigrationAdapter
rejections). C2 conservation: positionCount tracks live positions 1:1. C3: no
owner/pause/upgrade; the one-shot adapter slot is the single governed surface.
C4: unwrap feeless/queueless/pauseless, election-clearing.

## Deliberate scope notes
- tokenURI is the OZ default (empty) — the Namehash Gallery metadata module
  (Specimen Plates) binds here in a later slice; ERC-2981 royalties land with it.
- Sentinel Lock (transfer timelocks/guardians/panic) is the next name-layer
  module and will interpose on this vault's position transfers (I10 interlock).
- Renewal Pool enrollment references these positions; provenance claims for
  vault-custodied names (registrar ownerOf == vault) get their position-holder
  claim path when AttestorRegistry gains vault awareness (flagged in SLICE5 #4).

## Next: Slice 7 — Renewal Pool (CR tiers, epoch budgets, banked years)
The flagship utility module, first real charter through the ModuleRegistry.
