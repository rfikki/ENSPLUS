# ENSPLUS Contracts — Slice 7: RenewalPool (the Eternal Flame)

Verified: 88/88 tests passing (slices 1–7) · compiled solc 0.8.26, optimizer 200, cancun, zero warnings.

## Contents
- `contracts/core/RenewalPool.sol` — the flagship utility module, and the first
  REAL contract chartered through the ModuleRegistry (integration test registers
  it as a genesis module and the machine checks pass against live bytecode).
  * Coverage Ratio = balance / (enrolled x baseAnnualCost); tier ladder
    EMBER < 0.25 <= KINDLED < 0.5 <= STEADY < 1.0 <= ETERNAL, boundaries exact
    (the interactive CR simulator from the design session, now on-chain).
  * EMBER: once-per-epoch raffle, <= K winners, blockhash-derived randomness
    (FLAGGED v1 weakness; VRF is the chartered upgrade path); gracefully renews
    fewer than K when the budget is thin.
  * KINDLED: matchRenew — member pays a year at exact cost, pool adds a year
    (2 years banked per match).
  * STEADY/ETERNAL: permissionless keeper renewBatch, one renewal per name per
    epoch, always via the executor adapter (D8 path) at exact payment.
  * Epoch budget: 25% of balance snapshotted lazily at each epoch's first
    action; EpochBudgetExhausted stops spend cold (tested at the boundary).
  * ETERNAL tithe: surplus above full coverage skims titheBps to the sink at
    epoch open (Article VIII pattern, tested).
  * Enrollment: NameVault holders only, exact refundable bond, per-owner cap
    (R1 — and the cap CAUGHT MY OWN TEST PLAN mid-development, which is the
    nicest kind of verification), swap-and-pop enrolled list, permissionless
    evict() for positions that left the vault (bond joins the pool).
  * BANKED YEARS: yearsBanked per name — the on-chain scoreboard backing the
    threat model's one HARD renewal claim ("banked years are irreversible").
  * Governed surface: baseAnnualCostWei only, Standard-kind proposal binding
    the exact value (ETH/USD drift). No owner, no pause; unenroll works always.
- `contracts/test/Slice7Mocks.sol` — MockRenewalExecutor enforcing EXACT
  payment per year (any pool over/underpayment reverts the whole flow).

## Findings this slice
1. Small-community tier physics: with few enrolled names, KINDLED/EMBER budgets
   (25% of a low-CR balance) cannot cover even one renewal — mathematically
   correct (the ladder is designed for populations), surfaced by tests, and the
   raffle handles it by renewing zero gracefully. Genesis comms should set the
   expectation: the flame's lower tiers come alive with scale.
2. Enrollment bonds count toward CR (they are pool balance). Realistic and
   documented; zero-bond pools used in tests where exact CR control mattered.

## Next: Slice 8 — Citizen (ERC-6551 identity + credits) or the derivation
pipeline / Specimen Plate testbed, per priority.
