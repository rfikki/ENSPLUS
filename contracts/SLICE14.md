# ENSPLUS Contracts — Slice 14: CitizenResolver (civic identity as an ENS resolver)

Verified: 137/137 tests passing (slices 1–14) · solc 0.8.26, optimizer 200, cancun, zero warnings.

## Contents
- `contracts/core/CitizenResolver.sol` — a standards-conformant, READ-ONLY,
  OWNERLESS ENS resolver that surfaces ENSPLUS civic identity to any ENS app as
  ordinary records — without the app knowing ENSPLUS exists. ENSPLUS augments
  ENS resolution; it never replaces it (D7).
  * OWNERLESS: no owner/admin/pause/upgrade; immutable deps; the only writers
    are the five ENS-registry-owner-gated functions (asserted in test).
  * recordVersion PATTERN (from gwei-names): user records keyed by
    (node, recordVersion, key); link/unlink bump the version to clear all prior
    records with no gas-costly deletes (tested: unlink wipes, relink stays clean).
  * RESERVED CIVIC KEYS (ensplus.era / rank / banked-years / reputation /
    multiplier) are computed LIVE from the registries, not user-settable
    (setText rejects ensplus.*). They reflect on-chain truth and can't be
    spoofed.
  * PROVENANCE-SAFE ON TRANSFER: civic records only render when the current ENS
    owner also holds the ENSPLUS attestation for the linked label (the
    TrustOracle's own membership check gates it). Selling the ENS name shows
    empty civic records to the buyer (tested) — the seller's identity does not
    transfer with the name.
  * STANDARDS: EIP-137 addr, ENSIP-9 multicoin addr, EIP-634 text, EIP-1577
    contenthash, ERC-165, ENSIP-10 resolve() — all advertised via
    supportsInterface and dispatched on-chain by resolve().
  * CCIP-READ (EIP-3668): ensplus.offchain.* text keys raise OffchainLookup to
    the gateway (guild rosters, full graphs served off-chain); small civic
    records resolve on-chain. ccipCallback returns the gateway payload (response
    signing is the documented gateway-hardening step).
- `contracts/test/Slice14Mocks.sol` — MockENSRegistry (settable node owners).

## Notes
- addr(node) defaults to the node's current controller (registry.owner) unless a
  user record overrides it; multicoin addr returns "" for unset non-ETH coins.
- The resolver is the last read-only identity piece; it holds no assets and has
  no privileged surface, so it is low-risk audit scope. recordVersion + CCIP
  were the two gwei-names patterns earmarked for exactly this contract.

## Pre-audit status
Name layer + governance + identity/trust now code-complete for the intended
audit scope. Deferred to post-audit / separate reviews (asset-moving, higher
risk): marketplace/leasing/foundry, inheritance/dead-man's-switch, Wave 3 v2
migration kit, curated-category TCR/guilds/bounties, Specimen Plate art.
