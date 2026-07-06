# ENSPLUS Contracts — Slice 9: Sentinel Lock (theft protection, I10)

Verified: 102/102 tests passing (slices 1–9) · 7,494 fuzz checks unchanged · solc 0.8.26, optimizer 200, cancun, zero warnings.

## Contents
- `contracts/core/SentinelLock.sol` — opt-in, per-owner theft protection guarding
  BOTH ways a position can leave an owner: transfer of the ENS+N NFT and unwrap
  of the underlying (closes the unwrap-and-flee bypass).
  * arm(timelock, guardians[], threshold) — immediate (strengthening is safe);
    timelock bounded [1h, 30d], ≤10 guardians, threshold ≤ guardian count.
  * requestRelease(tokenId, kind, to) → clears the owner's self-chosen timelock;
    then the actual NameVault call consumes the matured, destination-matched
    request. Direct transfer/unwrap with no request reverts (WrongRelease);
    early execution reverts (ReleaseNotReady); wrong destination reverts.
  * Guardians: approveRelease fast-tracks a legitimate move at threshold;
    cancelRelease (owner or any guardian) kills a suspicious one.
  * panicFreeze(owner) — owner OR any single guardian; instantly halts every
    pending release. Unfreeze needs the guardian threshold (approveUnfreeze), so
    a lone key-holding thief cannot lift it; ownerUnfreeze only when threshold 0.
  * Disarm is timelocked (requestDisarm/executeDisarm) and guardian-vetoable —
    a thief cannot instantly strip protection.
- `contracts/core/NameVault.sol` — added a `sentinel` slot: born empty, filled
  exactly once via Constitutional proposal (same one-shot pattern as
  migrationAdapter). `_update` consults it on member-to-member transfers;
  `unwrap` consults it before releasing. When unset OR the owner is unarmed,
  every path is a no-op — slice 6 (7/7) unchanged, backward compatible.

## The theft scenario, proven
A key-compromise attacker (same signer, acting maliciously) announces a transfer
to themselves; a guardian spots it and panic-freezes BEFORE the timelock
elapses; the transfer then cannot execute even after the timer (Frozen); the
thief cannot unfreeze (needs guardian threshold); guardians cancel the malicious
request and lift the freeze; the name never moved. Full end-to-end test.

## Covenant position (C4 preserved — reviewed carefully)
The Sentinel is the OWNER's own opt-in door lock, never the protocol's:
- Unarmed accounts are NEVER gated (consume* returns immediately).
- An armed owner can ALWAYS release by waiting out the timelock THEY chose
  (bounded by MAX_TIMELOCK = 30 days).
- Neither ENSPLUS, governance, nor any majority can arm/freeze/delay anyone —
  only the account holder and their chosen guardians, only for that account.
"The protocol cannot block your exit" stays literally true; the only thing that
can delay you is a restraint you placed on yourself. Claim strength: STRONG
(not HARD) — "theft requires defeating your timelock, your guardians, and your
alerts," never "cannot be stolen."

## Deliberate scope notes
- Guard is at the NameVault _update chokepoint, so operator approvals
  (setApprovalForAll) cannot bypass it — every transfer path funnels through.
- Per-owner protection (not per-position) in v1; per-position granularity and
  inheritance/dead-man's-switch (the Watchtower/recovery family) are the
  designed follow-ons.
- Guardian set changes beyond disarm (rotate a compromised guardian) are a v2
  refinement; v1 covers arm → disarm → re-arm.

## Next candidates
Watchtower (expiry escalation + alerts) · Specimen Plate testbed · marketplace ·
derivation dry-run scripts.
