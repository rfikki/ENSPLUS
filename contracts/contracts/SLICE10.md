# ENSPLUS Contracts — Slice 10: Watchtower (name-layer observation)

Verified: 111/111 tests passing (slices 1–10) · solc 0.8.26, optimizer 200, cancun, zero warnings.

## Contents
- `contracts/core/Watchtower.sol` — the observation half of the name-layer
  defenses (Sentinel Lock is the intervention half). A pure observation layer:
  no custody, no admin, no governance hooks, no privileged surface — it only
  READS the NameVault and the live expiry sources.
  * Escalation ladder Calm > Notice > Warning > Critical > Expired as a pure
    function of live expiry (boundaries 90d / 30d / 7d / lapse), tested exactly.
  * watch/unwatch — holder-gated enrollment; custody snapshotted at enroll.
  * checkpoint — PERMISSIONLESS keeper/community watch duty: records the level
    on-chain (immutable, timestamped audit trail), emits Escalated only when
    risk WORSENS (the alert trigger), and Checkpointed always (the log). This is
    how a contract that cannot send email still drives off-chain alerting: it is
    the single source of truth alerting infra subscribes to.
  * Lapse anchor — first Expired observation stamps lapsedAt and emits Lapsed
    with the resurrection deadline (the v2 recent-owner premium-exemption
    recovery window, RESURRECTION_WINDOW placeholder).
  * Auto-close — if a watched position has left the vault (unwrapped/migrated),
    checkpoint detects it via try/catch on ownerOf and closes the watch cleanly
    (no false alarms on names that are simply gone).
  * raiseAlarm / reportConfusable — permissionless, attributed, event-only:
    resolver-change / owner-change / suspicious-transfer alarms, and a homoglyph
    impersonation watchlist. Off-chain indexers consume; dataHash commits to
    off-chain evidence.
  * Dual expiry source: U-721 reads registrar.nameExpires; W-1155 reads
    nameWrapper.getData — both live, custody-routed.
- `contracts/test/Slice10Mocks.sol` — MockExpiryRegistrar (adds ENS nameExpires
  to the IBaseRegistrar custody surface).

## Design position
Watchtower and SentinelLock are DECOUPLED in v1: Watchtower observes and records,
humans/keepers react via the Sentinel. A "Watchtower-as-guardian" auto-freeze
opt-in (an alarm tripping a Sentinel panic freeze automatically) is a flagged
future integration — powerful but couples two systems, so v1 keeps them separate
for auditability.

## Deliberate scope notes
- Alarms/confusables are event-only (no on-chain storage) — cheap, and the
  watchlist lives in the indexer; on-chain permanence is the immutable event log.
- Keeper incentives (crediting watch duty via ParticipationCredits P_CREDIT) are
  a flagged future: Watchtower would become a chartered credit module. v1 is a
  clean standalone reader.
- Resurrection is anchored (deadline computed) but the actual v2 re-registration
  is out of scope until ENSv2 is live (Wave 3).

## Name-layer status
Immortality (RenewalPool) + theft intervention (SentinelLock) + observation
(Watchtower) now all exist. Remaining name-layer designed features: inheritance/
dead-man's-switch, marketplace/leasing/foundry, the Specimen Plate gallery.

## Next candidates
Specimen Plate testbed (art) · marketplace · derivation dry-run scripts.
