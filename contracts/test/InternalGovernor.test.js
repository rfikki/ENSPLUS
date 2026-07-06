const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const WAD = 10n ** 18n;
const DAY = 86400;
const VEST = 30 * DAY;
const DELAY = 100, COMMIT = 1000, REVEAL = 1000;
const EPOCH = 10 * DAY, QUORUM = 100; // quorum 1% of capBase
const MINCOUNT = 10n ** 9n; // participation floor = sqrt(1 ENS)
const LADDER_C = [50, 250, 1000];
const LADDER_T = [500, 1000, 1500]; // bps

const cfg = (vault, prov, over = {}) => [
  vault, prov,
  over.capBps ?? 200, over.quorumBps ?? QUORUM, over.vest ?? VEST, over.minCount ?? MINCOUNT,
  DELAY, COMMIT, REVEAL, EPOCH,
  over.ladderC ?? LADDER_C, over.ladderT ?? LADDER_T,
];

const jump = async (s) => {
  await network.provider.send("evm_increaseTime", [s]);
  await network.provider.send("evm_mine");
};

const isqrt = (n) => {
  if (n < 2n) return n;
  let x = n, y = (x + 1n) >> 1n;
  while (y < x) { x = y; y = (x + n / x) >> 1n; }
  return x;
};

async function setup(provenance = true) {
  const [deployer, vaultGov, alice, bob, whale, pool] = await ethers.getSigners();
  const ens = await (await ethers.getContractFactory("MockENS")).deploy();
  const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy([pool.address], [10000]);
  const vault = await (await ethers.getContractFactory("ENSPLUSVault")).deploy(
    await ens.getAddress(), vaultGov.address, await splitter.getAddress(), 0n, vaultGov.address
  );
  const prov = provenance
    ? await (await ethers.getContractFactory("MockProvenance")).deploy()
    : null;
  const gov = await (await ethers.getContractFactory("InternalGovernor")).deploy(
    cfg(await vault.getAddress(), prov ? await prov.getAddress() : ethers.ZeroAddress)
  );
  for (const a of [alice, bob, whale]) {
    await ens.mint(a.address, E(2_000_000));
    await ens.connect(a).approve(await vault.getAddress(), ethers.MaxUint256);
  }
  return { ens, vault, gov, prov, alice, bob, whale };
}

describe("InternalGovernor (pass 1)", () => {
  it("constructor rejects malformed tier ladders and cap range", async () => {
    const { vault } = await setup(false);
    const F = await ethers.getContractFactory("InternalGovernor");
    const v = await vault.getAddress();
    await expect(F.deploy(cfg(v, ethers.ZeroAddress, { ladderC: [250, 250, 1000] })))
      .to.be.revertedWithCustomError(F, "BadTierLadder");
    await expect(F.deploy(cfg(v, ethers.ZeroAddress, { ladderT: [1000, 500, 1500] })))
      .to.be.revertedWithCustomError(F, "BadTierLadder");
    await expect(F.deploy(cfg(v, ethers.ZeroAddress, { ladderT: [500, 1000, 10001] })))
      .to.be.revertedWithCustomError(F, "BadTierLadder");
    await expect(F.deploy(cfg(v, ethers.ZeroAddress, { capBps: 0 }))).to.be.reverted;
    await expect(F.deploy(cfg(v, ethers.ZeroAddress, { capBps: 10001 }))).to.be.reverted;
    await expect(F.deploy(cfg(v, ethers.ZeroAddress, { quorumBps: 0 }))).to.be.reverted;
    await expect(F.deploy(cfg(v, ethers.ZeroAddress, { quorumBps: 10001 }))).to.be.reverted;
  });

  it("Override proposals open at T0; higher kinds gate on tier (existence, not thresholds)", async () => {
    const { gov, alice } = await setup(false);
    expect(await gov.currentTier()).to.equal(0);
    await expect(gov.connect(alice).createProposal(1, ethers.id("standard")))
      .to.be.revertedWithCustomError(gov, "TierTooLow");
    await expect(gov.connect(alice).createProposal(2, ethers.id("treasury")))
      .to.be.revertedWithCustomError(gov, "TierTooLow");
    await expect(gov.connect(alice).createProposal(3, ethers.id("amendment")))
      .to.be.revertedWithCustomError(gov, "TierTooLow");
    await expect(gov.connect(alice).createProposal(0, ethers.id("override")))
      .to.emit(gov, "ProposalCreated");
    expect(await gov.minTierFor(0)).to.equal(0);
    expect(await gov.minTierFor(1)).to.equal(1);
    expect(await gov.minTierFor(2)).to.equal(2);
    expect(await gov.minTierFor(3)).to.equal(3);
  });

  it("walks the lifecycle: Pending -> Commit -> Reveal -> Ended on schedule", async () => {
    const { gov, alice } = await setup(false);
    await gov.connect(alice).createProposal(0, ethers.id("p"));
    const p = await gov.proposal(1);
    expect(await gov.state(1)).to.equal(0); // Pending
    await jump(DELAY + 1);
    expect(await gov.state(1)).to.equal(1); // Commit
    await jump(COMMIT);
    expect(await gov.state(1)).to.equal(2); // Reveal
    await jump(REVEAL);
    expect(await gov.state(1)).to.equal(3); // Ended
    expect(p.revealStart - p.commitStart).to.equal(COMMIT);
    expect(p.end - p.revealStart).to.equal(REVEAL);
    await expect(gov.state(999)).to.be.revertedWithCustomError(gov, "UnknownProposal");
    await expect(gov.proposal(999)).to.be.revertedWithCustomError(gov, "UnknownProposal");
  });

  it("snapshot: balances after proposal creation carry zero weight (G3/I9)", async () => {
    const { gov, vault, alice, bob } = await setup(false);
    await vault.connect(alice).wrap(E(100));
    await jump(VEST + 1); // alice fully vested
    await gov.connect(alice).createProposal(0, ethers.id("p"));
    await vault.connect(bob).wrap(E(100)); // AFTER snapshot
    expect(await gov.rawWeightAt(bob.address, 1)).to.equal(0n);
    const w = await gov.rawWeightAt(alice.address, 1);
    expect(w).to.equal(isqrt(E(100))); // fully vested, neutral prov, no dormancy
  });

  it("vesting is snapshot-relative and conservative (fresh wrap ~ zero weight)", async () => {
    const { gov, vault, alice } = await setup(false);
    await vault.connect(alice).wrap(E(100));
    await gov.connect(alice).createProposal(0, ethers.id("immediate"));
    const w0 = await gov.rawWeightAt(alice.address, 1);
    expect(w0).to.be.lessThan(isqrt(E(100)) / 1000n); // ~0: just wrapped
    await jump(VEST / 2);
    await gov.connect(alice).createProposal(0, ethers.id("halfway"));
    const p2 = await gov.proposal(2);
    const start = await vault.vestingStart(alice.address);
    const expected = (isqrt(E(100)) * ((p2.snapshot - start) * WAD / BigInt(VEST))) / WAD;
    expect(await gov.rawWeightAt(alice.address, 2)).to.equal(expected);
    await jump(VEST);
    await gov.connect(alice).createProposal(0, ethers.id("vested"));
    expect(await gov.rawWeightAt(alice.address, 3)).to.equal(isqrt(E(100)));
  });

  it("provenance multiplies weight; unknown accounts and zero-source stay neutral", async () => {
    const { gov, vault, prov, alice, bob } = await setup(true);
    await vault.connect(alice).wrap(E(100));
    await vault.connect(bob).wrap(E(100));
    await prov.set(alice.address, 2n * WAD); // prepunk-tier
    await jump(VEST + 1);
    await gov.connect(alice).createProposal(0, ethers.id("p"));
    expect(await gov.rawWeightAt(alice.address, 1)).to.equal(2n * isqrt(E(100)));
    expect(await gov.rawWeightAt(bob.address, 1)).to.equal(isqrt(E(100))); // source returns 0 -> neutral
  });

  it("cap: whale weight is capped at capBps of sqrt(snapshot total supply); citizens untouched (G1/I7)", async () => {
    const { gov, vault, alice, whale } = await setup(false);
    await vault.connect(alice).wrap(E(100));
    await vault.connect(whale).wrap(E(1_000_000));
    await jump(VEST + 1);
    await gov.connect(alice).createProposal(0, ethers.id("p"));
    const p = await gov.proposal(1);
    const capBase = isqrt(E(1_000_100));
    expect(p.capBase).to.equal(capBase);
    const cap = (capBase * 200n) / 10000n;
    expect(await gov.weightAt(whale.address, 1)).to.equal(cap); // raw sqrt(1e24)=1e12 >> cap
    expect(await gov.rawWeightAt(whale.address, 1)).to.equal(isqrt(E(1_000_000)));
    const aliceW = await gov.weightAt(alice.address, 1);
    expect(aliceW).to.equal(isqrt(E(100))); // below cap: untouched
    // the whale's counted power vs a 100-ENS citizen: capped to ~2x, not ~100x
    expect(cap / aliceW).to.be.lessThan(3n);
  });

  it("dormancy factor applies from missedConsecutive (storage plumbed for pass 2)", async () => {
    const { gov, vault, alice } = await setup(false);
    await vault.connect(alice).wrap(E(100));
    await jump(VEST + 1);
    await gov.connect(alice).createProposal(0, ethers.id("p"));
    expect(await gov.missedConsecutive(alice.address)).to.equal(0);
    expect(await gov.rawWeightAt(alice.address, 1)).to.equal(isqrt(E(100))); // dormancy 1.0x
  });

  it("silent policy: explicit election, changeable, Unset resolves to abstain (no hidden default)", async () => {
    const { gov, alice } = await setup(false);
    expect(await gov.silentPolicy(alice.address)).to.equal(0); // Unset
    expect(await gov.effectiveSilentPolicy(alice.address)).to.equal(2); // -> AbstainWhenSilent
    await expect(gov.connect(alice).setSilentPolicy(1))
      .to.emit(gov, "SilentPolicySet").withArgs(alice.address, 1);
    expect(await gov.effectiveSilentPolicy(alice.address)).to.equal(1); // ConstitutionDelegate
    await gov.connect(alice).setSilentPolicy(2);
    expect(await gov.effectiveSilentPolicy(alice.address)).to.equal(2);
  });

  it("tier ladder math: exact boundaries at every rung", async () => {
    const { gov } = await setup(false);
    expect(await gov.computeTier(49, 10000)).to.equal(0);
    expect(await gov.computeTier(50, 499)).to.equal(0);
    expect(await gov.computeTier(50, 500)).to.equal(1);
    expect(await gov.computeTier(249, 10000)).to.equal(1);
    expect(await gov.computeTier(250, 999)).to.equal(1);
    expect(await gov.computeTier(250, 1000)).to.equal(2);
    expect(await gov.computeTier(999, 10000)).to.equal(2);
    expect(await gov.computeTier(1000, 1499)).to.equal(2);
    expect(await gov.computeTier(1000, 1500)).to.equal(3);
    expect(await gov.computeTier(4000000, 10000)).to.equal(3);
    expect(await gov.computeTier(0, 0)).to.equal(0);
  });
});
