# ENSPLUS — Pre-audit Hardening (Slice 15, ongoing)

Verified: 146/146 tests passing · solc 0.8.26, zero warnings.

## What this is
Pre-audit hardening: raising the newer custody-adjacent contracts to the same
invariant-test rigor the token vault already had (I1–I4 stateful randomized
tests). First target: SentinelLock — it guards the vault's asset-exit path, so
its safety is the highest-value thing to pin down before an auditor arrives.

## Contents
- `test/SentinelInvariants.test.js` — stateful randomized invariant suite over a
  REAL NameVault + SentinelLock (sentinel slot filled via the genuine
  Constitutional-proposal path).
  * INVARIANT (the money-shot): an ARMED owner's position never leaves — by
    transfer OR unwrap — unless a matching release matured AND the account is not
    frozen. A ~160-op randomized sequence (arm / requestRelease / approve /
    cancel / panicFreeze / unfreeze / requestDisarm / executeDisarm / attempt
    transfer / attempt unwrap) drives a JS model in lockstep; EVERY transfer and
    unwrap outcome is asserted to match the model exactly. Instrumented to
    require >12 armed-exit attempts per run (no trivial passes); stable across
    8+ seeds.
  * Explicit companion test: a fully-matured release stays blocked while frozen,
    a lone owner-key cannot unfreeze when guardians exist, and guardian-threshold
    unfreeze restores the release — the theft-response path, end to end.

## Why it matters for audit
SentinelLock is the one new contract that can DELAY a member's own exit (their
opt-in door lock). Proving — by fuzzed model equivalence — that it can never
trap an unarmed owner, never release an armed owner early, and never let a
frozen account be drained, converts the covenant-C4 reasoning ("owner's own
lock, never the protocol's") into an executable guarantee an auditor can re-run.

## Added: Watchtower + Trust property tests
- `test/WatchtowerInvariants.test.js`:
  * levelFor is a correct, MONOTONIC step function over 300 random (expiry, now)
    pairs (cross-checked vs a JS reference); later `now` never de-escalates.
  * Stateful (~160 ops): watchedCount ALWAYS equals the live active-watch count;
    recorded lastLevel always equals the true level; Escalated fires iff the
    level worsened; lapsedAt is set once at first Expired and never moves;
    auto-close on a vanished position is exact.
- `test/TrustPropertyInvariants.test.js`:
  * BOUNDED: reputation in [0,10000] and multiplier in [1e18, 1.25e18] for ALL
    random inputs; multiplier is exactly the affine map of reputation.
  * MONOTONIC: bumping any single positive signal (humanity, banked years,
    tenure, participation, credits, provenance, rank, category) NEVER lowers
    reputation — a member is never punished for participating.
  * Sub-scores each stay within [0,10000].

## Remaining pre-audit hardening
- Settle the four code-affecting decisions (Policy A/B accounting; capBps vs
  community size; raffle VRF-vs-blockhash; era/rank derivation freeze).
- Audit-scope document.
