const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const WAD = 10n ** 18n;
const DAY = 86400;
const VEST = 30 * DAY;
const DELAY = 100, COMMIT = 1000, REVEAL = 1000;
const EPOCH = 10 * DAY, QUORUM = 100; // 1% of capBase
const MINCOUNT = 10n ** 9n;
const LADDER_C = [2, 3, 5]; // tiny ladder so tests can climb it
const LADDER_T = [500, 1000, 1500];

const jump = async (s) => {
  await network.provider.send("evm_increaseTime", [s]);
  await network.provider.send("evm_mine");
};
const isqrt = (n) => { if (n < 2n) return n; let x = n, y = (x + 1n) >> 1n; while (y < x) { x = y; y = (x + n / x) >> 1n; } return x; };
const salt = (s) => ethers.id(s);

async function setup() {
  const [deployer, vaultGov, a, b, c, d, e, pool] = await ethers.getSigners();
  const voters = [a, b, c, d, e];
  const ens = await (await ethers.getContractFactory("MockENS")).deploy();
  const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy([pool.address], [10000]);
  const vault = await (await ethers.getContractFactory("ENSPLUSVault")).deploy(
    await ens.getAddress(), vaultGov.address, await splitter.getAddress(), 0n, vaultGov.address
  );
  const gov = await (await ethers.getContractFactory("InternalGovernor")).deploy([
    await vault.getAddress(), ethers.ZeroAddress,
    5000, QUORUM, VEST, MINCOUNT, // capBps 5000: 5 equal voters would all bind under 2% (see SLICE3 cap-base note)
    DELAY, COMMIT, REVEAL, EPOCH,
    LADDER_C, LADDER_T,
  ]);
  for (const v of voters) {
    await ens.mint(v.address, E(10_000));
    await ens.connect(v).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(v).wrap(E(100));
  }
  await jump(VEST + 1); // everyone fully vested
  return { ens, vault, gov, voters, vaultGov };
}

// close all fully elapsed epochs sequentially
async function closeAll(gov, keeper) {
  while ((await gov.lastClosedEpoch()) < (await gov.currentEpoch())) {
    await gov.connect(keeper).closeEpoch(await gov.lastClosedEpoch());
  }
}

// commit+reveal convenience
async function vote(gov, voter, id, support, tag) {
  const cmt = await gov.commitmentOf(id, voter.address, support, salt(tag));
  await gov.connect(voter).commit(id, cmt);
  return () => gov.connect(voter).reveal(id, support, salt(tag));
}

describe("InternalGovernor (pass 2): commit-reveal & tallies", () => {
  it("full happy path: commit sealed, reveal opens, tally counts capped weight", async () => {
    const { gov, voters } = await setup();
    const [a, b, c] = voters;
    await gov.connect(a).createProposal(0, ethers.id("p"));
    await jump(DELAY + 1);
    const rA = await vote(gov, a, 1, 1, "a"); // FOR
    const rB = await vote(gov, b, 1, 0, "b"); // AGAINST
    const rC = await vote(gov, c, 1, 2, "c"); // ABSTAIN
    // interim tally is zero — nothing knowable during commit (G5)
    let t = await gov.tally(1);
    expect(t.forWeight + t.againstWeight + t.abstainWeight).to.equal(0n);
    await jump(COMMIT);
    await expect(rA()).to.emit(gov, "VoteRevealed");
    await rB(); await rC();
    t = await gov.tally(1);
    const w = isqrt(E(100));
    expect(t.forWeight).to.equal(w);
    expect(t.againstWeight).to.equal(w);
    expect(t.abstainWeight).to.equal(w);
    expect(t.revealedVoters).to.equal(3);
  });

  it("phase discipline: no commit outside Commit, no reveal outside Reveal", async () => {
    const { gov, voters } = await setup();
    const [a] = voters;
    await gov.connect(a).createProposal(0, ethers.id("p"));
    const cmt = await gov.commitmentOf(1, a.address, 1, salt("x"));
    await expect(gov.connect(a).commit(1, cmt)).to.be.revertedWithCustomError(gov, "WrongPhase"); // Pending
    await jump(DELAY + 1);
    await gov.connect(a).commit(1, cmt);
    await expect(gov.connect(a).reveal(1, 1, salt("x"))).to.be.revertedWithCustomError(gov, "WrongPhase"); // still Commit
    await jump(COMMIT);
    await expect(gov.connect(a).commit(1, cmt)).to.be.revertedWithCustomError(gov, "WrongPhase"); // Reveal
    await gov.connect(a).reveal(1, 1, salt("x"));
    await jump(REVEAL);
    await expect(gov.connect(a).reveal(1, 1, salt("x"))).to.be.revertedWithCustomError(gov, "WrongPhase"); // Ended
  });

  it("reveal integrity: wrong salt/support rejected, no double reveal, no reveal without commit, voter-bound", async () => {
    const { gov, voters } = await setup();
    const [a, b] = voters;
    await gov.connect(a).createProposal(0, ethers.id("p"));
    await jump(DELAY + 1);
    const cmt = await gov.commitmentOf(1, a.address, 1, salt("secret"));
    await gov.connect(a).commit(1, cmt);
    // b copies a's commitment (front-run copy attack) — reveal must fail for b
    await gov.connect(b).commit(1, cmt);
    await jump(COMMIT);
    await expect(gov.connect(a).reveal(1, 1, salt("wrong"))).to.be.revertedWithCustomError(gov, "BadReveal");
    await expect(gov.connect(a).reveal(1, 0, salt("secret"))).to.be.revertedWithCustomError(gov, "BadReveal");
    await expect(gov.connect(a).reveal(1, 3, salt("secret"))).to.be.revertedWithCustomError(gov, "BadSupport");
    await gov.connect(a).reveal(1, 1, salt("secret"));
    await expect(gov.connect(a).reveal(1, 1, salt("secret"))).to.be.revertedWithCustomError(gov, "AlreadyRevealed");
    await expect(gov.connect(b).reveal(1, 1, salt("secret"))).to.be.revertedWithCustomError(gov, "BadReveal"); // commitment binds voter
    const [, , , , , cNoCommit] = await ethers.getSigners();
    await expect(gov.connect(cNoCommit).reveal(1, 1, salt("s"))).to.be.revertedWithCustomError(gov, "NoCommitment");
  });

  it("last commit wins: overwriting a commitment changes the revealable vote", async () => {
    const { gov, voters } = await setup();
    const [a] = voters;
    await gov.connect(a).createProposal(0, ethers.id("p"));
    await jump(DELAY + 1);
    await gov.connect(a).commit(1, await gov.commitmentOf(1, a.address, 0, salt("v1")));
    await gov.connect(a).commit(1, await gov.commitmentOf(1, a.address, 1, salt("v2"))); // overwrite
    await jump(COMMIT);
    await expect(gov.connect(a).reveal(1, 0, salt("v1"))).to.be.revertedWithCustomError(gov, "BadReveal");
    await gov.connect(a).reveal(1, 1, salt("v2"));
    expect((await gov.tally(1)).forWeight).to.be.greaterThan(0n);
  });

  it("outcomes: Succeeded / Defeated / QuorumFailed with abstain counting toward quorum only", async () => {
    const { gov, voters } = await setup();
    const [a, b, c] = voters;
    // P1: FOR wins
    await gov.connect(a).createProposal(0, ethers.id("p1"));
    await jump(DELAY + 1);
    const r1 = [await vote(gov, a, 1, 1, "a1"), await vote(gov, b, 1, 1, "b1"), await vote(gov, c, 1, 0, "c1")];
    await jump(COMMIT); for (const r of r1) await r();
    expect(await gov.outcome(1)).to.equal(0); // NotEnded during reveal
    await jump(REVEAL);
    expect(await gov.outcome(1)).to.equal(2); // Succeeded
    // P2: tie -> Defeated (for must strictly exceed against)
    await gov.connect(a).createProposal(0, ethers.id("p2"));
    await jump(DELAY + 1);
    const r2 = [await vote(gov, a, 2, 1, "a2"), await vote(gov, b, 2, 0, "b2")];
    await jump(COMMIT); for (const r of r2) await r();
    await jump(REVEAL);
    expect(await gov.outcome(2)).to.equal(3); // Defeated
    // P3: nobody reveals -> QuorumFailed (external mirror: ABSTAIN)
    await gov.connect(a).createProposal(0, ethers.id("p3"));
    await jump(DELAY + COMMIT + REVEAL + 2);
    expect(await gov.quorumReached(3)).to.equal(false);
    expect(await gov.outcome(3)).to.equal(1); // QuorumFailed
    // P4: only an abstain, but enough weight -> quorum reached, Defeated (0 for vs 0 against)
    await gov.connect(a).createProposal(0, ethers.id("p4"));
    await jump(DELAY + 1);
    const r4 = await vote(gov, a, 4, 2, "a4");
    await jump(COMMIT); await r4();
    await jump(REVEAL);
    expect(await gov.quorumReached(4)).to.equal(true); // abstain counts toward quorum
    expect(await gov.outcome(4)).to.equal(3);
  });
});

describe("InternalGovernor (pass 2): epochs, dormancy, tier", () => {
  it("participation counts once per epoch; dust weight below floor never counts", async () => {
    const { gov, vault, voters } = await setup();
    const [a, b] = voters;
    // b unwraps to dust (weight < MINCOUNT): sqrt(1 gwei ENS) < 1e9
    await vault.connect(b).unwrap(E(100) - 1000000000n); // leaves 1 gwei
    await jump(VEST + 1);
    await gov.connect(a).createProposal(0, ethers.id("p"));
    await jump(DELAY + 1);
    const rA = await vote(gov, a, 1, 1, "a");
    const rB = await vote(gov, b, 1, 1, "b");
    await jump(COMMIT);
    await rA(); await rB();
    const ep = await gov.currentEpoch();
    const st = await gov.epochStats(ep);
    expect(st.distinctActive).to.equal(1); // only a counted; b under floor
    expect(await gov.activeInEpoch(ep, a.address)).to.equal(true);
    expect(await gov.activeInEpoch(ep, b.address)).to.equal(false);
    // a votes again same epoch: still counted once
    await gov.connect(a).createProposal(0, ethers.id("p2"));
    await jump(DELAY + 1);
    const rA2 = await vote(gov, a, 2, 0, "a2");
    await jump(COMMIT); await rA2();
    expect((await gov.epochStats(await gov.currentEpoch())).distinctActive).to.equal(1);
  });

  it("dormancy: missed epochs (with one grace epoch) halve weight per 3, and reset on activity", async () => {
    const { gov, voters } = await setup();
    const [a] = voters;
    // activity in current epoch
    await gov.connect(a).createProposal(0, ethers.id("p"));
    await jump(DELAY + 1);
    const r = await vote(gov, a, 1, 1, "a");
    await jump(COMMIT); await r();
    expect(await gov.missedConsecutive(a.address)).to.equal(0);
    await jump(EPOCH); // next epoch: grace, still 0
    expect(await gov.missedConsecutive(a.address)).to.equal(0);
    await jump(4 * EPOCH); // 4 more epochs idle -> missed 4
    expect(await gov.missedConsecutive(a.address)).to.equal(4);
    // weight on a fresh proposal is halved (4/3 = 1 halving)
    await gov.connect(a).createProposal(0, ethers.id("p2"));
    expect(await gov.rawWeightAt(a.address, 2)).to.equal(isqrt(E(100)) / 2n);
    // voting again resets the clock
    await jump(DELAY + 1);
    const r2 = await vote(gov, a, 2, 1, "a2");
    await jump(COMMIT); await r2();
    expect(await gov.missedConsecutive(a.address)).to.equal(0);
  });

  it("closeEpoch: sequential, permissionless, freezes turnout, advances tier by trailing min — and the tier gate opens (integration)", async () => {
    const { gov, voters } = await setup();
    const [a, b, c, keeper] = voters;
    // Standard proposals are impossible at T0
    await expect(gov.connect(a).createProposal(1, ethers.id("std"))).to.be.revertedWithCustomError(gov, "TierTooLow");

    // three epochs of 3 active citizens each (5 holders -> turnout 6000 bps)
    for (let e = 0; e < 3; e++) {
      const id = Number(await gov.proposalCount()) + 1;
      await gov.connect(a).createProposal(0, ethers.id(`e${e}`));
      await jump(DELAY + 1);
      const rs = [await vote(gov, a, id, 1, `a${e}`), await vote(gov, b, id, 1, `b${e}`), await vote(gov, c, id, 0, `c${e}`)];
      await jump(COMMIT);
      for (const r of rs) await r();
      await jump(EPOCH); // move into next epoch
    }
    // out-of-order and premature closes revert
    await expect(gov.connect(keeper).closeEpoch(1)).to.be.revertedWithCustomError(gov, "EpochOutOfOrder");
    await expect(gov.connect(keeper).closeEpoch(await gov.currentEpoch())).to.be.revertedWithCustomError(gov, "EpochNotOver");
    // close every elapsed epoch permissionlessly (setup vest-jump means activity sits in epochs 3..5)
    await expect(gov.connect(keeper).closeEpoch(0)).to.emit(gov, "EpochClosed");
    await expect(gov.connect(keeper).closeEpoch(0)).to.be.revertedWithCustomError(gov, "EpochAlreadyClosed");
    await closeAll(gov, keeper);
    // ladder: T1 needs >=2 citizens & >=5%; T2 >=3 & >=10% — 3 citizens/60% clears T2, not T3 (needs 5)
    expect(await gov.currentTier()).to.equal(2);
    // the gate is now open: Standard and Treasury proposals exist, Constitutional still doesn't
    await gov.connect(a).createProposal(1, ethers.id("std-now-ok"));
    await gov.connect(a).createProposal(2, ethers.id("treasury-now-ok"));
    await expect(gov.connect(a).createProposal(3, ethers.id("amendment"))).to.be.revertedWithCustomError(gov, "TierTooLow");
  });

  it("trailing-min smoothing: one quiet epoch demotes the tier", async () => {
    const { gov, voters } = await setup();
    const [a, b, c, keeper] = voters;
    for (let e = 0; e < 3; e++) {
      const id = Number(await gov.proposalCount()) + 1;
      await gov.connect(a).createProposal(0, ethers.id(`q${e}`));
      await jump(DELAY + 1);
      const rs = [await vote(gov, a, id, 1, `qa${e}`), await vote(gov, b, id, 1, `qb${e}`), await vote(gov, c, id, 1, `qc${e}`)];
      await jump(COMMIT);
      for (const r of rs) await r();
      await jump(EPOCH);
    }
    await closeAll(gov, keeper);
    expect(await gov.currentTier()).to.equal(2); // trailing window = 3 active epochs
    await jump(2 * EPOCH); // one full quiet epoch elapses
    await closeAll(gov, keeper);
    expect(await gov.currentTier()).to.equal(0); // trailing min now includes the quiet epoch
  });

  it("vault holderCount tracks 0<->nonzero transitions incl. self-transfer edge", async () => {
    const { vault, voters, ens } = await setup();
    const [a, b] = voters;
    const base = await vault.holderCount();
    expect(base).to.equal(5n);
    await vault.connect(a).transfer(a.address, E(100)); // full self-transfer: no change
    expect(await vault.holderCount()).to.equal(base);
    await vault.connect(a).transfer(b.address, E(100)); // a -> 0, b stays holder
    expect(await vault.holderCount()).to.equal(base - 1n);
    await vault.connect(b).unwrap(E(200)); // b -> 0
    expect(await vault.holderCount()).to.equal(base - 2n);
    await vault.connect(b).wrap(E(1)); // back
    expect(await vault.holderCount()).to.equal(base - 1n);
  });
});
