const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const DAY = 86400;
const VEST = 30 * DAY;
const DELAY = 100, COMMIT = 1000, REVEAL = 1000;
const EPOCH = 10 * DAY, QUORUM = 100, MINCOUNT = 10n ** 9n;
const LADDER_C = [2, 3, 5], LADDER_T = [500, 1000, 1500];
const HOUR = 3600;
const TIMELOCK = 2 * DAY;

const lh = (s) => BigInt(ethers.keccak256(ethers.toUtf8Bytes(s)));
const jump = async (s) => { await network.provider.send("evm_increaseTime", [s]); await network.provider.send("evm_mine"); };
const salt = (s) => ethers.id(s);

const K = { None: 0, Transfer: 1, Unwrap: 2 };

async function vote(gov, voter, id, support, tag) {
  const c = await gov.commitmentOf(id, voter.address, support, salt(tag));
  await gov.connect(voter).commit(id, c);
  return () => gov.connect(voter).reveal(id, support, salt(tag));
}
async function runVotes(gov, id, plan, tag) {
  await jump(DELAY + 1);
  const rs = [];
  for (let i = 0; i < plan.length; i++) rs.push(await vote(gov, plan[i][0], id, plan[i][1], `${tag}${i}`));
  await jump(COMMIT);
  for (const r of rs) await r();
  await jump(REVEAL + 1);
}
async function climbToT3(gov, voters) {
  for (let ep = 0; ep < 3; ep++) {
    const id = Number(await gov.proposalCount()) + 1;
    await gov.connect(voters[0]).createProposal(0, ethers.id(`c${ep}`));
    await runVotes(gov, id, voters.map((v) => [v, 2]), `c${ep}`);
    await jump(EPOCH - (DELAY + COMMIT + REVEAL + 3));
  }
  while ((await gov.lastClosedEpoch()) < (await gov.currentEpoch())) {
    await gov.connect(voters[0]).closeEpoch(await gov.lastClosedEpoch());
  }
  expect(await gov.currentTier()).to.equal(3);
}

async function setup() {
  const [deployer, vaultGov, a, b, c, d, e, pool] = await ethers.getSigners();
  const voters = [a, b, c, d, e];
  const ens = await (await ethers.getContractFactory("MockENS")).deploy();
  const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy([pool.address], [10000]);
  const tokenVault = await (await ethers.getContractFactory("ENSPLUSVault")).deploy(
    await ens.getAddress(), vaultGov.address, await splitter.getAddress(), 0n, vaultGov.address
  );
  const gov = await (await ethers.getContractFactory("InternalGovernor")).deploy([
    await tokenVault.getAddress(), ethers.ZeroAddress,
    5000, QUORUM, VEST, MINCOUNT, DELAY, COMMIT, REVEAL, EPOCH, LADDER_C, LADDER_T,
  ]);
  const registrar = await (await ethers.getContractFactory("MockBaseRegistrar")).deploy();
  const wrapper = await (await ethers.getContractFactory("MockNameWrapper")).deploy();
  const nameVault = await (await ethers.getContractFactory("NameVault")).deploy(
    await gov.getAddress(), await registrar.getAddress(), await wrapper.getAddress(),
    await splitter.getAddress(), 0n
  );
  const constitution = await (await ethers.getContractFactory("ConstitutionRegistry")).deploy(
    await gov.getAddress(), ["Art I", "Art II", "Art III", "Art IV"]
  );
  const sentinel = await (await ethers.getContractFactory("SentinelLock")).deploy(await nameVault.getAddress());

  for (const v of voters) {
    await ens.mint(v.address, E(10_000));
    await ens.connect(v).approve(await tokenVault.getAddress(), ethers.MaxUint256);
    await tokenVault.connect(v).wrap(E(100));
  }
  await jump(VEST + 1);
  return { ens, tokenVault, nameVault, registrar, gov, constitution, sentinel, voters, deployer };
}

async function wrapName(registrar, nameVault, owner, label) {
  const id = lh(label);
  await registrar.register(id, owner.address);
  await registrar.connect(owner).approve(await nameVault.getAddress(), id);
  await nameVault.connect(owner).wrapName(id, { value: 0 });
  return id;
}

// fill the sentinel slot via a Constitutional proposal
async function installSentinel(gov, nameVault, sentinel, voters) {
  await climbToT3(gov, voters);
  const desc = await nameVault.expectedDescriptionHash(await nameVault.ACTION_SET_SENTINEL(),
    ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address"], [await sentinel.getAddress()])));
  const pid = Number(await gov.proposalCount()) + 1;
  await gov.connect(voters[0]).createProposal(3, desc);
  await runVotes(gov, pid, voters.map((v) => [v, 1]), "sent");
  await nameVault.setSentinel(pid, await sentinel.getAddress());
  expect(await nameVault.sentinel()).to.equal(await sentinel.getAddress());
}
describe("NameVault — sentinel slot", () => {
  it("born empty; unset means transfers/unwraps are ungated; fills once via Constitutional proposal", async () => {
    const { gov, nameVault, registrar, sentinel, voters } = await setup();
    const [a, b] = voters;
    expect(await nameVault.sentinel()).to.equal(ethers.ZeroAddress);
    // ungated while empty
    const id = await wrapName(registrar, nameVault, a, "free");
    await nameVault.connect(a).transferFrom(a.address, b.address, id);
    expect(await nameVault.ownerOf(id)).to.equal(b.address);
    // Treasury-kind cannot fill it
    await climbToT3(gov, voters);
    const desc = await nameVault.expectedDescriptionHash(await nameVault.ACTION_SET_SENTINEL(),
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address"], [await sentinel.getAddress()])));
    let pid = Number(await gov.proposalCount()) + 1;
    await gov.connect(a).createProposal(2, desc);
    await runVotes(gov, pid, voters.map((v) => [v, 1]), "low");
    await expect(nameVault.setSentinel(pid, await sentinel.getAddress()))
      .to.be.revertedWithCustomError(nameVault, "ProposalKindTooLow");
    // Constitutional fills it, once
    pid = Number(await gov.proposalCount()) + 1;
    await gov.connect(a).createProposal(3, desc);
    await runVotes(gov, pid, voters.map((v) => [v, 1]), "ok");
    await expect(nameVault.setSentinel(pid, await sentinel.getAddress()))
      .to.emit(nameVault, "SentinelSet");
    await expect(nameVault.setSentinel(pid, await sentinel.getAddress()))
      .to.be.revertedWithCustomError(nameVault, "SentinelAlreadySet");
  });
});

describe("SentinelLock — arming & timelocked releases", () => {
  it("arming validates timelock bounds, guardian count, and threshold", async () => {
    const { sentinel, voters } = await setup();
    const [a, g1, g2] = voters;
    await expect(sentinel.connect(a).arm(60, [], 0)).to.be.revertedWithCustomError(sentinel, "BadTimelock");
    await expect(sentinel.connect(a).arm(40 * DAY, [], 0)).to.be.revertedWithCustomError(sentinel, "BadTimelock");
    await expect(sentinel.connect(a).arm(TIMELOCK, [g1.address, g2.address], 3))
      .to.be.revertedWithCustomError(sentinel, "BadThreshold");
    await expect(sentinel.connect(a).arm(TIMELOCK, [a.address], 1))
      .to.be.revertedWithCustomError(sentinel, "ZeroArg"); // self as guardian
    await sentinel.connect(a).arm(TIMELOCK, [g1.address, g2.address], 2);
    const gd = await sentinel.guardOf(a.address);
    expect(gd.armed).to.equal(true);
    expect(gd.timelock).to.equal(TIMELOCK);
    expect(gd.threshold).to.equal(2);
    expect(gd.guardians).to.deep.equal([g1.address, g2.address]);
    await expect(sentinel.connect(a).arm(TIMELOCK, [], 0)).to.be.revertedWithCustomError(sentinel, "AlreadyArmed");
  });

  it("an armed transfer must be announced and clear the timelock; direct transfer reverts", async () => {
    const { gov, nameVault, registrar, sentinel, voters } = await setup();
    const [a, b, g1] = voters;
    await installSentinel(gov, nameVault, sentinel, voters);
    const id = await wrapName(registrar, nameVault, a, "armed");
    await sentinel.connect(a).arm(TIMELOCK, [g1.address], 1);
    // direct transfer with no request -> reverts inside the vault guard
    await expect(nameVault.connect(a).transferFrom(a.address, b.address, id))
      .to.be.revertedWithCustomError(sentinel, "WrongRelease");
    // announce, wait, then transfer
    await sentinel.connect(a).requestRelease(id, K.Transfer, b.address);
    await expect(nameVault.connect(a).transferFrom(a.address, b.address, id))
      .to.be.revertedWithCustomError(sentinel, "ReleaseNotReady");
    await jump(TIMELOCK + 1);
    // wrong destination still fails (request bound to b)
    await expect(nameVault.connect(a).transferFrom(a.address, g1.address, id))
      .to.be.revertedWithCustomError(sentinel, "WrongRelease");
    await nameVault.connect(a).transferFrom(a.address, b.address, id);
    expect(await nameVault.ownerOf(id)).to.equal(b.address);
    // request consumed: a second transfer can't reuse it (b is unarmed anyway)
    await nameVault.connect(b).transferFrom(b.address, a.address, id); // b unarmed -> free
    expect(await nameVault.ownerOf(id)).to.equal(a.address);
  });

  it("armed unwrap is likewise timelocked (closes the unwrap-and-flee bypass)", async () => {
    const { gov, nameVault, registrar, sentinel, voters } = await setup();
    const [a] = voters;
    await installSentinel(gov, nameVault, sentinel, voters);
    const id = await wrapName(registrar, nameVault, a, "noflee");
    await sentinel.connect(a).arm(TIMELOCK, [], 0);
    await expect(nameVault.connect(a).unwrap(id)).to.be.revertedWithCustomError(sentinel, "WrongRelease");
    await sentinel.connect(a).requestRelease(id, K.Unwrap, ethers.ZeroAddress);
    await expect(nameVault.connect(a).unwrap(id)).to.be.revertedWithCustomError(sentinel, "ReleaseNotReady");
    await jump(TIMELOCK + 1);
    await nameVault.connect(a).unwrap(id);
    expect(await registrar.ownerOf(id)).to.equal(a.address);
  });
});

describe("SentinelLock — guardians & panic (the theft scenario)", () => {
  it("guardians fast-track a legitimate release below the timelock", async () => {
    const { gov, nameVault, registrar, sentinel, voters } = await setup();
    const [a, b, g1, g2] = voters;
    await installSentinel(gov, nameVault, sentinel, voters);
    const id = await wrapName(registrar, nameVault, a, "fast");
    await sentinel.connect(a).arm(TIMELOCK, [g1.address, g2.address], 2);
    await sentinel.connect(a).requestRelease(id, K.Transfer, b.address);
    await sentinel.connect(g1).approveRelease(id);
    // not ready yet (1 of 2)
    await expect(nameVault.connect(a).transferFrom(a.address, b.address, id))
      .to.be.revertedWithCustomError(sentinel, "ReleaseNotReady");
    await sentinel.connect(g2).approveRelease(id); // threshold met -> matured now
    await nameVault.connect(a).transferFrom(a.address, b.address, id);
    expect(await nameVault.ownerOf(id)).to.equal(b.address);
    // non-guardian cannot approve
    const id2 = await wrapName(registrar, nameVault, a, "fast2");
    await sentinel.connect(a).requestRelease(id2, K.Transfer, b.address);
    await expect(sentinel.connect(voters[4]).approveRelease(id2))
      .to.be.revertedWithCustomError(sentinel, "NotGuardian");
  });

  it("THEFT: a key-holding thief is blocked — panic freeze halts the pending release, guardian unfreeze required", async () => {
    const { gov, nameVault, registrar, sentinel, voters } = await setup();
    const [a, thief, g1, g2] = voters;
    await installSentinel(gov, nameVault, sentinel, voters);
    const id = await wrapName(registrar, nameVault, a, "stolen");
    await sentinel.connect(a).arm(TIMELOCK, [g1.address, g2.address], 2);

    // thief has a's key: announces a transfer to themselves
    // (simulated by 'a' signer acting maliciously — same keys)
    await sentinel.connect(a).requestRelease(id, K.Transfer, thief.address);
    // a guardian spots it and FREEZES before the timelock elapses
    await sentinel.connect(g1).panicFreeze(a.address);
    await jump(TIMELOCK + 1);
    // frozen: the transfer cannot execute even though the timer elapsed
    await expect(nameVault.connect(a).transferFrom(a.address, thief.address, id))
      .to.be.revertedWithCustomError(sentinel, "Frozen");
    // thief (holding only the owner key) cannot unfreeze — needs guardian threshold
    await expect(sentinel.connect(a).ownerUnfreeze())
      .to.be.revertedWithCustomError(sentinel, "NotGuardian");
    // guardians can cancel the malicious request outright
    await sentinel.connect(g2).cancelRelease(id);
    // and lift the freeze by threshold
    await sentinel.connect(g1).approveUnfreeze(a.address);
    await sentinel.connect(g2).approveUnfreeze(a.address);
    const gd = await sentinel.guardOf(a.address);
    expect(gd.frozen).to.equal(false);
    // the name never moved
    expect(await nameVault.ownerOf(id)).to.equal(a.address);
    // with no pending request, a stray transfer still can't go through
    await expect(nameVault.connect(a).transferFrom(a.address, thief.address, id))
      .to.be.revertedWithCustomError(sentinel, "WrongRelease");
  });

  it("owner can self-unfreeze only with no guardians; disarm is timelocked and guardian-vetoable", async () => {
    const { gov, nameVault, registrar, sentinel, voters } = await setup();
    const [a, b, g1] = voters;
    await installSentinel(gov, nameVault, sentinel, voters);
    // no-guardian account: owner is their own recovery
    await sentinel.connect(b).arm(TIMELOCK, [], 0);
    await sentinel.connect(b).panicFreeze(b.address);
    await sentinel.connect(b).ownerUnfreeze();
    expect((await sentinel.guardOf(b.address)).frozen).to.equal(false);
    // disarm is timelocked
    await sentinel.connect(a).arm(TIMELOCK, [g1.address], 1);
    await expect(sentinel.connect(a).executeDisarm()).to.be.revertedWithCustomError(sentinel, "NoDisarmPending");
    await sentinel.connect(a).requestDisarm();
    await expect(sentinel.connect(a).executeDisarm()).to.be.revertedWithCustomError(sentinel, "DisarmNotReady");
    // guardian veto resets it
    await sentinel.connect(g1).vetoDisarm(a.address);
    await jump(TIMELOCK + 1);
    await expect(sentinel.connect(a).executeDisarm()).to.be.revertedWithCustomError(sentinel, "NoDisarmPending");
    // re-request, wait, disarm
    await sentinel.connect(a).requestDisarm();
    await jump(TIMELOCK + 1);
    await sentinel.connect(a).executeDisarm();
    expect((await sentinel.guardOf(a.address)).armed).to.equal(false);
    // once disarmed, transfers are free again
    const id = await wrapName(registrar, nameVault, a, "freed");
    await nameVault.connect(a).transferFrom(a.address, b.address, id);
    expect(await nameVault.ownerOf(id)).to.equal(b.address);
  });
});

