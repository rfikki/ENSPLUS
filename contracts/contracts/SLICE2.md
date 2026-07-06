# ENSPLUS Contracts — Slice 2: Custody Core

Delivered compiled (solc 0.8.26, optimizer 200, cancun) and verified:
38/38 tests passing (slices 1+2) · invariant suite holds through 800-op randomized runs
(`INV_OPS=n` to go deeper) · slice-1 fuzz unchanged (10,494 checks, 0 mismatches).

## Contents
- `contracts/core/ENSPLUSVault.sol` — the wrapped ENS token ("ENS+"):
  1:1 wrap/unwrap, exact-fee forwarding to splitter (vault never holds ETH),
  timestamp checkpoints (ERC-6372, governor snapshot source), amount-weighted
  vesting starts (G3), underlying IVotes delegation with governor-only
  re-pointing. Covenants C1–C4 documented in natspec at the top.
- `contracts/core/RevenueSplitter.sol` — immutable payees+bps (sum=10,000),
  permissionless flush, remainder-to-last (zero dust), no mutators but flush.
- `contracts/test/MockENS.sol` — ERC20Votes stand-in for the canonical token.
- `test/Vault.test.js`, `test/Invariants.test.js` — unit + invariant suites.

## Invariants → tests mapping (threat model §10)
- I1 redeemability: terminal full-exit after random op storm; transferred ENS+
  unwrappable by receiver; unwrap feeless/pauseless by construction.
- I2 covenant outflow: unwrap pays exactly the burn to the burner (asserted
  per-op); global accounting closes to the wei (minted == actors + vault).
- I3 conservation: totalSupply == underlying.balanceOf(vault) asserted after
  EVERY op; vault ETH balance == 0 after every op.
- I4 no privileged mutation: mutator surface is exactly
  {approve, transfer, transferFrom, wrap, unwrap, setDelegatee};
  setDelegatee is governor-gated; no allowances ever granted on underlying;
  splitter mutator surface is exactly {flush}.

## Genesis wiring notes
- `governor` constructor param = InternalGovernor (slice 3). Tests use a signer.
- `initialDelegatee` = GovernorAdapter (or vault-external delegate of record).
- Splitter payees at genesis: RenewalPool, tithe escrow, ops budget — protocol
  contracts that accept ETH; a reverting payee stops the line by design.
- Underlying assumed canonical ENS ERC20Votes (exact transfers, no hooks).

## Known scope boundaries (deliberate)
- ERC20 splitting in RevenueSplitter: ETH-only v1.
- Overflow-to-commons cap redistribution: governor-level policy (slice 3),
  built on LibWeight.cappedWeight.
- Fractional/sharded external casting: GovernorAdapter slice, pending the
  empirical check of the live ENS governor's counting module.

## Next: Slice 3 — InternalGovernor
Consumes LibWeight + vault checkpoints: proposal lifecycle, commit-reveal,
snapshot weights, Policy A/B registry, tier computation, cap overflow-to-commons.
