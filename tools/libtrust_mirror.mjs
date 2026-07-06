// libtrust_mirror.mjs
// Independent BigInt reimplementation of LibTrust, written from the spec (not
// from the Solidity), for cross-fuzzing against the EVM harness. All division
// is integer (BigInt), matching Solidity's floor semantics exactly.

const SCALE = 10_000n;
const WAD = 1_000_000_000_000_000_000n;

const W_PROVENANCE = 4_000n, W_TENURE = 2_500n, W_PARTICIPATION = 3_000n, W_CATEGORY = 500n;
const MAX_BONUS_WAD = 250_000_000_000_000_000n; // 0.25e18

const ERA_MIN_WAD = 1_000_000_000_000_000_000n;
const ERA_MAX_WAD = 4_000_000_000_000_000_000n;
const ERA_PART_MAX = 7_000n, RANK_PART_MAX = 3_000n;

const TENURE_FULL_SECS = 730n * 86_400n;
const TENURE_PART_MAX = 6_000n, BANKED_PER_YEAR = 400n, BANKED_CAP_YEARS = 10n;

const CONSISTENCY_MAX = 5_000n, VOLUME_PER_EPOCH = 150n, VOLUME_CAP_EPOCHS = 20n;
const CREDITS_FULL_WAD = 1_000n * WAD, CREDITS_PART_MAX = 2_000n;

const CATEGORY_PER_CLUB = 2_500n;
const HUMANITY_BONUS = 2_000n;

const min = (a, b) => (a < b ? a : b);

export function provenanceScore(provenanceWad, rank) {
  let eraPart = 0n;
  if (provenanceWad > ERA_MIN_WAD) {
    const w = provenanceWad > ERA_MAX_WAD ? ERA_MAX_WAD : provenanceWad;
    eraPart = ((w - ERA_MIN_WAD) * ERA_PART_MAX) / (ERA_MAX_WAD - ERA_MIN_WAD);
  }
  let rankPart = 0n;
  if (rank !== 0n) {
    if (rank <= 999n) rankPart = RANK_PART_MAX;
    else if (rank <= 9_999n) rankPart = 2_000n;
    else if (rank <= 99_999n) rankPart = 1_000n;
    else rankPart = 500n;
  }
  return min(eraPart + rankPart, SCALE);
}

export function tenureScore(tenureSecs, bankedYears) {
  const tPart = tenureSecs >= TENURE_FULL_SECS
    ? TENURE_PART_MAX
    : (tenureSecs * TENURE_PART_MAX) / TENURE_FULL_SECS;
  const b = bankedYears > BANKED_CAP_YEARS ? BANKED_CAP_YEARS : bankedYears;
  return min(tPart + b * BANKED_PER_YEAR, SCALE);
}

export function participationScore(epochsActive, epochsSinceJoin, credits) {
  let consistency = 0n;
  if (epochsSinceJoin !== 0n) {
    const active = epochsActive > epochsSinceJoin ? epochsSinceJoin : epochsActive;
    consistency = (active * CONSISTENCY_MAX) / epochsSinceJoin;
  }
  const vEpochs = epochsActive > VOLUME_CAP_EPOCHS ? VOLUME_CAP_EPOCHS : epochsActive;
  const volume = vEpochs * VOLUME_PER_EPOCH;
  const cPart = credits >= CREDITS_FULL_WAD
    ? CREDITS_PART_MAX
    : (credits * CREDITS_PART_MAX) / CREDITS_FULL_WAD;
  return min(consistency + volume + cPart, SCALE);
}

export function categoryScore(categoryBits) {
  let count = 0n, bits = categoryBits;
  while (bits !== 0n) { count += bits & 1n; bits >>= 1n; }
  return min(count * CATEGORY_PER_CLUB, SCALE);
}

export function reputation(t) {
  const p = provenanceScore(t.provenanceWad, t.rank);
  const te = tenureScore(t.tenureSecs, t.bankedYears);
  const pa = participationScore(t.epochsActive, t.epochsSinceJoin, t.credits);
  const c = categoryScore(t.categoryBits);
  let base = (p * W_PROVENANCE + te * W_TENURE + pa * W_PARTICIPATION + c * W_CATEGORY) / SCALE;
  if (t.verifiedHuman) base += HUMANITY_BONUS;
  return base > SCALE ? SCALE : base;
}

export function trustMultiplierWad(t) {
  return WAD + (reputation(t) * MAX_BONUS_WAD) / SCALE;
}
