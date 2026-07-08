# ENSPLUS — Frozen Derivation Spec (era / rank / flags)

The exact, FROZEN rules the off-chain derivation dry-run implements to assign
era, ordinal rank, and flags to every .eth name and produce the genesis Merkle
root. On-chain constants (LibAttestation) already encode the boundaries; this
spec freezes the DERIVATION so the root is reproducible and audit-checkable.

## Data sources (three-way diff — no single source is load-bearing)
1. BigQuery: on-chain ENS registrar events (registrations, renewals, transfers).
2. The Grails 79,720-row historic corpus (curated; ARCHIVE before ethid.org sunset).
3. The ENS subgraph.
A name's fields are accepted only where sources agree; disagreements are logged
and resolved by the tie-break rules below, never silently.

## Era (LibAttestation ERA_*)  — by first-registration timestamp
- **Prepunk (0)**  — first registered ≤ 2017-06-23 23:59:59 UTC (CryptoPunks cutoff).
- **Auction (1)**  — 2017-06-24 .. the permanent-registrar migration block.
- **Permanent (2)** — migration .. 2021-10-31 23:59:59 UTC (airdrop snapshot).
- **Modern (3)**   — after 2021-10-31.
Era is by ORIGINAL registration, not current; a name continuously owned keeps its
era. era==0 is a REAL value (Prepunk), never an "unset" sentinel (LNR lesson).

## Ordinal rank — global registration order
- `ordinalRank` = 1-based index of the name in global first-registration order.
- Tiers (canonical, LibAttestation.rankTier): TOP_100 (≤100), TOP_1K (≤1000),
  TOP_10K (≤10000), else none. rank==0 = unranked.
- Tie-break for identical timestamps: lower transaction index, then lower log
  index, then lexicographic labelhash. Frozen and deterministic.

## Flags (LibAttestation FLAG_*)
- AIRDROP_FRANCHISE — registered before the 2021-10-31 airdrop snapshot.
- CONTINUOUS — continuous ownership by the current holder attested.
- LABEL_UNKNOWN — hash-only "blank" (preimage not recovered at derivation time).
- RECOVERED — preimage cracked after derivation (set via a later attested root).

## Output
Per-name leaf `[labelhash, registrationTimestamp, ordinalRank, era, flags,
leafVersion]` → OZ StandardMerkleTree (double-hashed leaves) → genesis root.
The dry-run publishes the full leaf set + proof shards + a reproducibility script
so anyone can re-derive and verify the root. Cost ~$10, ~4 days (Rocky's machine).

## Freeze status
Boundaries + tiers + tie-breaks above are FROZEN. The on-chain constants match.
Remaining action: run the dry-run against the three corpora and publish the root.
