const { expect } = require("chai");
const { ethers } = require("hardhat");

const WAD = 10n ** 18n;
const E = (n) => ethers.parseEther(String(n)); // ENS wei

describe("LibWeight", () => {
  let h;
  before(async () => {
    h = await (await ethers.getContractFactory("WeightHarness")).deploy();
  });

  it("quadratic: 100x tokens = 10x voice", async () => {
    const w1 = await h.quadraticWeight(E(1));
    const w100 = await h.quadraticWeight(E(100));
    expect(w100).to.equal(w1 * 10n);
    expect(w1).to.equal(10n ** 9n); // sqrt(1e18)
    expect(await h.quadraticWeight(0)).to.equal(0n);
  });

  it("quadratic is floor-exact at perfect squares and monotone across them", async () => {
    expect(await h.quadraticWeight(4n * WAD)).to.equal(2n * 10n ** 9n);
    expect(await h.quadraticWeight(4n * WAD - 1n)).to.equal(2n * 10n ** 9n - 1n);
  });

  it("cap: 2% ceiling binds whales, spares citizens (G1/I7)", async () => {
    const total = 1_000_000n;
    expect(await h.cappedWeight(50_000n, total, 200)).to.equal(20_000n); // capped
    expect(await h.cappedWeight(19_999n, total, 200)).to.equal(19_999n); // untouched
    expect(await h.cappedWeight(20_000n, total, 200)).to.equal(20_000n); // boundary
    expect(await h.cappedWeight(123n, 0n, 200)).to.equal(0n);            // empty snapshot
  });

  it("cap: rejects zero and >100% capBps", async () => {
    await expect(h.cappedWeight(1n, 1n, 0)).to.be.reverted;
    await expect(h.cappedWeight(1n, 1n, 10001)).to.be.reverted;
    expect(await h.cappedWeight(5n, 10n, 10000)).to.equal(5n); // 100% = no cap
  });

  it("vesting: linear ramp with exact endpoints (G3)", async () => {
    const period = 30n * 24n * 3600n;
    expect(await h.vestingWad(0, period)).to.equal(0n);
    expect(await h.vestingWad(period / 2n, period)).to.equal(WAD / 2n);
    expect(await h.vestingWad(period, period)).to.equal(WAD);
    expect(await h.vestingWad(period * 10n, period)).to.equal(WAD); // never exceeds 1x
    expect(await h.vestingWad(123, 0)).to.equal(WAD); // disabled
  });

  it("dormancy: halves per 3 misses, floors at 1/32 (G7)", async () => {
    expect(await h.dormancyWad(0)).to.equal(WAD);
    expect(await h.dormancyWad(2)).to.equal(WAD);
    expect(await h.dormancyWad(3)).to.equal(WAD / 2n);
    expect(await h.dormancyWad(6)).to.equal(WAD / 4n);
    expect(await h.dormancyWad(15)).to.equal(WAD / 32n);
    expect(await h.dormancyWad(300)).to.equal(WAD / 32n); // floor holds forever
  });

  it("compose: multiplies sqrt by each WAD factor in sequence", async () => {
    // 100 ENS, prepunk 2.0x, half-vested, fully active
    const w = await h.composeWeight(E(100), 2n * WAD, WAD / 2n, WAD);
    expect(w).to.equal(10n ** 10n); // sqrt(100e18)=1e10, *2 *0.5 *1
    // neutral multipliers = raw sqrt
    expect(await h.composeWeight(E(100), WAD, WAD, WAD)).to.equal(10n ** 10n);
    // zero dormancy floor never reached via dormancyWad, but compose accepts small factors
    expect(await h.composeWeight(E(100), WAD, WAD, WAD / 32n)).to.equal(10n ** 10n / 32n);
  });

  it("compose: rejects fat-fingered multipliers above the 4x ceiling", async () => {
    await expect(h.composeWeight(E(1), 5n * WAD, WAD, WAD)).to.be.reverted;
    await expect(h.composeWeight(E(1), WAD, WAD, 4n * WAD + 1n)).to.be.reverted;
    expect(await h.composeWeight(E(1), 4n * WAD, WAD, WAD)).to.equal(4n * 10n ** 9n);
  });

  it("compose: no overflow at maximal inputs", async () => {
    const maxBal = 2n ** 256n - 1n;
    const w = await h.composeWeight(maxBal, 4n * WAD, WAD, WAD);
    expect(w).to.be.greaterThan(0n); // completes without revert
  });
});
