const { expect } = require("chai");
const { ethers } = require("hardhat");
const mirror = require("../tools/libtrust_mirror.mjs");

const WAD = 10n ** 18n;
const SCALE = 10_000n;

// a fresh-wallet sybil: nothing earned, nothing aged
const SYBIL = {
  provenanceWad: 0n, rank: 0n, tenureSecs: 0n, bankedYears: 0n,
  epochsActive: 0n, epochsSinceJoin: 0n, credits: 0n, categoryBits: 0n, verifiedHuman: false,
};

// a prepunk veteran: 2017 name, low rank, long tenure, consistent voting
const VETERAN = {
  provenanceWad: 4n * WAD, rank: 42n, tenureSecs: 3n * 365n * 86400n, bankedYears: 5n,
  epochsActive: 18n, epochsSinceJoin: 20n, credits: 1500n * WAD, categoryBits: 0b101n, verifiedHuman: false,
};

function toStruct(t) {
  return {
    provenanceWad: t.provenanceWad, rank: t.rank, tenureSecs: t.tenureSecs,
    bankedYears: t.bankedYears, epochsActive: t.epochsActive,
    epochsSinceJoin: t.epochsSinceJoin, credits: t.credits, categoryBits: t.categoryBits,
    verifiedHuman: t.verifiedHuman ?? false,
  };
}

describe("LibTrust — L1-native reputation", () => {
  let H;
  before(async () => {
    H = await (await ethers.getContractFactory("LibTrustHarness")).deploy();
  });

  it("a fresh-wallet sybil scores 0 -> multiplier exactly 1.0x (no external graph needed)", async () => {
    expect(await H.reputation(toStruct(SYBIL))).to.equal(0n);
    expect(await H.trustMultiplierWad(toStruct(SYBIL))).to.equal(WAD);
  });

  it("a prepunk veteran earns a high, but CAPPED, multiplier (<= 1.25x, D11)", async () => {
    const rep = await H.reputation(toStruct(VETERAN));
    const mult = await H.trustMultiplierWad(toStruct(VETERAN));
    expect(rep).to.be.greaterThan(6000n); // strong standing
    expect(mult).to.be.greaterThan(WAD);
    expect(mult).to.be.lessThanOrEqual(WAD + WAD / 4n); // never exceeds +25%
  });

  it("verified humanity adds a sybil-proof bonus toward the cap", async () => {
    const base = { ...SYBIL, provenanceWad: 2n * WAD, epochsActive: 5n, epochsSinceJoin: 10n };
    const human = { ...base, verifiedHuman: true };
    const rBase = await H.reputation(toStruct(base));
    const rHuman = await H.reputation(toStruct(human));
    expect(rHuman).to.equal(rBase + 2000n > 10000n ? 10000n : rBase + 2000n);
    expect(rHuman).to.be.greaterThan(rBase);
    // a lone verified human with nothing else still only reaches the bonus, capped
    const onlyHuman = { ...SYBIL, verifiedHuman: true };
    expect(await H.reputation(toStruct(onlyHuman))).to.equal(2000n);
  });

  it("provenance costs history: era band + rank tier are the apex anti-sybil signal", async () => {
    expect(await H.provenanceScore(0n, 0n)).to.equal(0n); // no attestation
    expect(await H.provenanceScore(WAD, 0n)).to.equal(0n); // Modern era, unranked
    expect(await H.provenanceScore(4n * WAD, 1n)).to.equal(SCALE); // Prepunk + rank 1 = max
    expect(await H.provenanceScore(4n * WAD, 0n)).to.equal(7000n); // era only
    expect(await H.provenanceScore(WAD, 500n)).to.equal(2000n); // rank 500 = TOP_1K (canonical)
    // half-band era
    expect(await H.provenanceScore((5n * WAD) / 2n, 0n)).to.equal(3500n); // 2.5e18 -> half of 7000
  });

  it("tenure costs time; participation costs sustained effort", async () => {
    expect(await H.tenureScore(730n * 86400n, 0n)).to.equal(6000n); // 2y = full time part
    expect(await H.tenureScore(0n, 10n)).to.equal(4000n); // 10 banked years
    expect(await H.tenureScore(730n * 86400n, 20n)).to.equal(SCALE); // capped
    // full consistency (voted every epoch) + volume + credits
    expect(await H.participationScore(20n, 20n, 1000n * WAD)).to.equal(SCALE);
    // showed up half the epochs
    expect(await H.participationScore(10n, 20n, 0n)).to.equal(2500n + 1500n); // consistency 2500 + volume 1500
  });

  it("category bits are unspoofable algorithmic bonuses (popcount x 2500, capped)", async () => {
    expect(await H.categoryScore(0n)).to.equal(0n);
    expect(await H.categoryScore(0b1n)).to.equal(2500n);
    expect(await H.categoryScore(0b111n)).to.equal(7500n);
    expect(await H.categoryScore(0b11111n)).to.equal(SCALE); // 5 clubs -> capped at 10000
  });

  it("cross-fuzz: EVM output matches the independent JS mirror over random inputs", async function () {
    this.timeout(120000);
    const rand = (bits) => {
      let v = 0n;
      for (let i = 0; i < bits; i += 30) v = (v << 30n) | BigInt(Math.floor(Math.random() * (1 << 30)));
      return v & ((1n << BigInt(bits)) - 1n);
    };
    const N = 400;
    for (let i = 0; i < N; i++) {
      const t = {
        provenanceWad: [0n, WAD, (5n * WAD) / 2n, 4n * WAD, rand(63)][i % 5],
        rank: rand(20),
        tenureSecs: rand(34),
        bankedYears: rand(16),
        epochsActive: rand(16),
        epochsSinceJoin: rand(16),
        credits: rand(70),
        categoryBits: rand(16),
        verifiedHuman: (Number(rand(2)) & 1) === 1,
      };
      const s = toStruct(t);
      const evmRep = await H.reputation(s);
      const evmMul = await H.trustMultiplierWad(s);
      expect(evmRep).to.equal(mirror.reputation(t), `reputation mismatch @${i}: ${JSON.stringify(t, (k, v) => typeof v === "bigint" ? v.toString() : v)}`);
      expect(evmMul).to.equal(mirror.trustMultiplierWad(t), `multiplier mismatch @${i}`);
    }
  });
});
