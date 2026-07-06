# ENSPLUS — Improvements Adopted from gwei-names (benchmark)

Benchmarked ENSPLUS against `lucadonnoh/gwei-names` (ownerless `.gwei` namespace).
The two are different species — gwei-names is a minimal, immutable namespace;
ENSPLUS is a governance + utility wrapper over ENS — but gwei-names had several
practices worth adopting. Verdict and actions:

## Verdict
- OWNERLESS: ENSPLUS core (vaults, splitter, name protection) already matches
  gwei-names' standard — immutable, no admin, no upgrade, feeless/pauseless exit.
  Governance exists by design (the bloc), gated by execute-by-proposal with
  rage-quit; no admin keys anywhere. HumanAttestor added at the same standard
  (only claim() writes; verifier/domain immutable; no ETH).
- ROBUSTNESS: comparable engineering; ENSPLUS thinks deeper (14-adversary threat
  model, invariants I1–I10, cross-fuzz JS mirrors) but gwei-names is more PROVEN
  (3 audits + live mainnet + gas snapshots). Closing that = audit + deploy.
- FEATURES: ENSPLUS is far broader; gwei-names had a few patterns to borrow.

## Adopted
1. **HumanAttestor** — zkPassport one-human-one-identity proof of humanity,
   ownerless, privacy-preserving; feeds the TrustOracle as a sybil-proof signal.
2. **ensplus-utils SDK** (`tools/ensplus-utils/`) — one client for EFP follows,
   ENS+EFP profile resolve/render, and live reputation; no hosted API.
3. **Gas snapshots** (`tools/gas_snapshot.js` -> `.gas-snapshot`) — regression
   visibility.
4. **Deterministic deploy** (`tools/deploy.js`) — same deployer+nonces => same
   CREATE addresses cross-chain; asserts the ModuleRegistry prediction.
5. **recordVersion pattern** — noted for the (future) Citizen Resolver: clear a
   name's records on rebind/unwrap via a version counter (no gas-costly deletes).
6. **Universal resolver + CCIP** — noted for the Citizen Resolver: surface
   ensplus.* civic records to any ENS client + an offchain gateway.

## Deliberately not adopted
- solady/soledge + solc 0.8.30: ENSPLUS pins OZ 5.1.0 + 0.8.26 for auditor
  familiarity; L1 gas is negligible now, so gas micro-optimization isn't worth
  the audit-surface change.
- Fee burning: ENSPLUS routes fees to public goods (Article III) via the
  immutable splitter — non-extractive by design, but not burned.

## Remaining gap (top genesis-gating item)
External audit(s) + mainnet deployment — what would make ENSPLUS as PROVEN as
gwei-names, not just as carefully reasoned.
