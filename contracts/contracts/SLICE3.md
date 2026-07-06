# ENSPLUS Contracts — Slice 3 (COMPLETE, pass 1+2): InternalGovernor

Verified: 58/58 tests passing (slices 1–3) · compiled solc 0.8.26, optimizer 200, cancun.

## Contents
- `contracts/core/InternalGovernor.sol` — complete internal governance:
  proposal lifecycle, COMMIT-REVEAL ballots, snapshot quadratic/capped weights,
  Policy A/B registry, epoch participation accounting, trailing-min tier ladder.
- `contracts/core/ENSPLUSVault.sol` — extended with `holderCount` (turnout
  denominator; self-transfer-safe 0<->nonzero tracking).
- `test/InternalGovernor.test.js` (+`InternalGovernor2.test.js`) — 20 tests.

## Pass-2 mechanics
- COMMIT-REVEAL (G5/G4): sealed keccak(chainid, governor, proposalId, voter,
  support, salt); last commit wins; reveals only in Reveal phase; commitment
  binds the voter (copy-commit attack tested and dead); interim tallies are
  provably empty during Commit — the abstain-then-hammer pattern is impossible.
- TALLY/OUTCOME: for/against/abstain in capped weight; quorum = quorumBps of
  capBase with ABSTAIN counting toward quorum but not direction; outcomes
  Succeeded / Defeated (ties defeat) / QuorumFailed (adapter → external ABSTAIN).
- EPOCHS: fixed-length from deployment; participation counts once per epoch,
  only when revealed weight >= minCountWeight (tier-gaming floor until
  Citizen-anchored counting); closeEpoch is permissionless, sequential, freezes
  turnout (denominator = vault.holderCount at close — v1 simplification),
  then tier = computeTier(min citizens, min turnout) over trailing 3 closed
  epochs. Integration test proves the T0→T2 gate opening: Standard/Treasury
  proposals become creatable, Constitutional still reverts.
- DORMANCY (G7): epoch-based — fully elapsed epochs since last counted vote,
  one grace epoch, never-active unpenalized; reveal computes weight BEFORE
  recording participation. Verified: 4 idle epochs → exactly halved weight;
  one vote resets.

## Findings & flagged decisions (review these)
1. CAP FLATTENING AT SMALL N: with the conservative sqrt(totalSupply) cap base,
   N equal holders ALL bind under a capBps cap whenever capBps·sqrt(N) < 1e4·1
   (e.g. 2% cap flattens any community under ~2,500 equal holders to uniform
   weight). Mathematically correct 2%-of-lower-bound behavior, but genesis
   capBps must be chosen against expected community size. A holderCount-scaled
   base (sqrt(N·T), exact for equal holders) was CONSIDERED AND REJECTED:
   dust-wallet splitting inflates N at proposal creation → attacker loosens the
   cap arbitrarily. Conservative base is manipulation-proof; tune capBps instead.
2. TIER TRAILING WINDOW includes empty epochs by design — a young deployment
   climbs the ladder only after 3 consecutive active epochs (tested), and one
   quiet epoch demotes (tested). Cold-start is intentional, not a bug.
3. Turnout denominator reads holderCount at CLOSE time, not epoch-end snapshot
   (v1 simplification, manipulable only against the closer's own interest by
   wrapping dust pre-close to LOWER turnout; flagged for pass-3 refinement if
   holder checkpointing is added to a future vault generation).
4. EpochAlreadyClosed is checked before ordering — re-closing reverts precisely.

## Next slices
4: ConstitutionRegistry + ModuleRegistry (manifest machine checks) + Standing
   Orders engine skeleton. 5: GovernorAdapter (pending live ENS governor
   counting-module check) + AttestorRegistry (Elders) wiring provenanceSource.
