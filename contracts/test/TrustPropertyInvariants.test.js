const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const WAD = 10n ** 18n;
const SCALE = 10000n;
const rnd = (n) => Math.floor(Math.random() * n);
const randBig = (bits) => {
  let v = 0n;
  for (let i = 0; i < bits; i += 30) v = (v << 30n) | BigInt(rnd(1 << 30));
  return v & ((1n << BigInt(bits)) - 1n);
};

function randInputs() {
  return {
    provenanceWad: [0n, WAD, (5n * WAD) / 2n, 4n * WAD, randBig(63)][rnd(5)],
    rank: randBig(20),
    tenureSecs: randBig(34),
    bankedYears: randBig(16),
    epochsActive: randBig(16),
    epochsSinceJoin: randBig(16),
    credits: randBig(70),
    categoryBits: randBig(16),
    verifiedHuman: rnd(2) === 1,
  };
}
const toStruct = (t) => ({ ...t });

describe("LibTrust / TrustOracle — property tests (hardening)", function () {
  this.timeout(300000);
  let H;
  before(async () => { H = await (await ethers.getContractFactory("LibTrustHarness")).deploy(); });

  it("BOUNDED: reputation in [0,10000] and multiplier in [1e18, 1.25e18] for all inputs", async () => {
    for (let i = 0; i < 400; i++) {
      const t = toStruct(randInputs());
      const rep = await H.reputation(t);
      const mul = await H.trustMultiplierWad(t);
      expect(rep).to.be.greaterThanOrEqual(0n);
      expect(rep).to.be.lessThanOrEqual(SCALE);
      expect(mul).to.be.greaterThanOrEqual(WAD);
      expect(mul).to.be.lessThanOrEqual(WAD + WAD / 4n);
      // multiplier is an exact affine function of reputation
      expect(mul).to.equal(WAD + (rep * (WAD / 4n)) / SCALE);
    }
  });

  it("MONOTONIC: doing more good never lowers reputation (no punishment for participating)", async () => {
    for (let i = 0; i < 250; i++) {
      const base = randInputs();
      const rep0 = await H.reputation(toStruct(base));
      // bump exactly one positive signal and assert non-decrease
      const bumps = [
        { ...base, verifiedHuman: true },
        { ...base, bankedYears: base.bankedYears + 1n },
        { ...base, tenureSecs: base.tenureSecs + BigInt(rnd(100) * 86400) },
        { ...base, epochsActive: base.epochsActive + 1n, epochsSinceJoin: base.epochsSinceJoin + 1n },
        { ...base, credits: base.credits + BigInt(rnd(500)) * WAD },
        { ...base, provenanceWad: base.provenanceWad < 4n * WAD ? 4n * WAD : base.provenanceWad },
        { ...base, rank: base.rank === 0n ? 1n : base.rank },
        { ...base, categoryBits: base.categoryBits | 1n },
      ];
      for (const b of bumps) {
        const rep1 = await H.reputation(toStruct(b));
        expect(rep1).to.be.greaterThanOrEqual(rep0);
      }
    }
  });

  it("SUB-SCORES BOUNDED: each component score stays within [0,10000]", async () => {
    for (let i = 0; i < 150; i++) {
      const t = randInputs();
      expect(await H.provenanceScore(t.provenanceWad, t.rank)).to.be.lessThanOrEqual(SCALE);
      expect(await H.tenureScore(t.tenureSecs, t.bankedYears)).to.be.lessThanOrEqual(SCALE);
      expect(await H.participationScore(t.epochsActive, t.epochsSinceJoin, t.credits)).to.be.lessThanOrEqual(SCALE);
      expect(await H.categoryScore(t.categoryBits)).to.be.lessThanOrEqual(SCALE);
    }
  });
});
