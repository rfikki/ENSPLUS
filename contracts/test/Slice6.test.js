const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const DAY = 86400;
const VEST = 30 * DAY;
const DELAY = 100, COMMIT = 1000, REVEAL = 1000;
const EPOCH = 10 * DAY, QUORUM = 100, MINCOUNT = 10n ** 9n;
const LADDER_C = [2, 3, 5], LADDER_T = [500, 1000, 1500];
const NAME_FEE = ethers.parseEther("0.003");

const lh = (s) => BigInt(ethers.keccak256(ethers.toUtf8Bytes(s)));
const jump = async (s) => { await network.provider.send("evm_increaseTime", [s]); await network.provider.send("evm_mine"); };
const salt = (s) => ethers.id(s);

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
    await splitter.getAddress(), NAME_FEE
  );
  for (const v of voters) {
    await ens.mint(v.address, E(10_000));
    await ens.connect(v).approve(await tokenVault.getAddress(), ethers.MaxUint256);
    await tokenVault.connect(v).wrap(E(100));
  }
  await jump(VEST + 1);
  return { gov, registrar, wrapper, nameVault, splitter, voters };
}

describe("NameVault — dual custody", () => {
  it("U-721 wrap: takes registrar custody, restores Registry control to the member atomically (D7)", async () => {
    const { registrar, nameVault, splitter, voters } = await setup();
    const [a] = voters;
    const id = lh("rocky");
    await registrar.register(id, a.address);
    await registrar.connect(a).approve(await nameVault.getAddress(), id);
    await expect(nameVault.connect(a).wrapName(id, { value: NAME_FEE }))
      .to.emit(nameVault, "NameWrapped").withArgs(id, a.address, 1, NAME_FEE);
    expect(await registrar.ownerOf(id)).to.equal(await nameVault.getAddress()); // custody
    expect(await registrar.registryController(id)).to.equal(a.address); // resolution UNTOUCHED
    expect(await nameVault.ownerOf(id)).to.equal(a.address); // position NFT
    expect((await nameVault.position(id)).custodyClass).to.equal(1);
    expect((await nameVault.position(id)).v2Status).to.equal(0); // LEGACY
    expect(await ethers.provider.getBalance(await splitter.getAddress())).to.equal(NAME_FEE);
    await expect(nameVault.connect(a).wrapName(id, { value: 0 }))
      .to.be.revertedWithCustomError(nameVault, "WrongFee");
  });

  it("W-1155 wrap: snapshots fuses/expiry and grants the member record approval (D7/F7)", async () => {
    const { wrapper, nameVault, voters } = await setup();
    const [a] = voters;
    const node = lh("node:rocky.eth");
    await wrapper.mintWrapped(node, a.address, 0xdead, 1900000000n);
    await wrapper.connect(a).setApprovalForAll(await nameVault.getAddress(), true);
    await nameVault.connect(a).wrapWrappedName(node, { value: NAME_FEE });
    const p = await nameVault.position(node);
    expect(p.custodyClass).to.equal(2);
    expect(p.fuseSnapshot).to.equal(0xdead);
    expect(p.expirySnapshot).to.equal(1900000000n);
    expect(await wrapper.balanceOf(await nameVault.getAddress(), node)).to.equal(1n);
    expect(await wrapper.recordApproval(node)).to.equal(a.address); // records stay theirs
  });

  it("unwrap returns the underlying per class, feeless, burns position, clears election (C4/I1)", async () => {
    const { registrar, wrapper, nameVault, voters } = await setup();
    const [a] = voters;
    const id = lh("exit721");
    const node = lh("exit1155");
    await registrar.register(id, a.address);
    await registrar.connect(a).approve(await nameVault.getAddress(), id);
    await nameVault.connect(a).wrapName(id, { value: NAME_FEE });
    await wrapper.mintWrapped(node, a.address, 1, 2n ** 40n);
    await wrapper.connect(a).setApprovalForAll(await nameVault.getAddress(), true);
    await nameVault.connect(a).wrapWrappedName(node, { value: NAME_FEE });
    expect(await nameVault.positionCount()).to.equal(2);
    await nameVault.connect(a).electUpgrade(id);
    expect((await nameVault.position(id)).v2Status).to.equal(1);
    await nameVault.connect(a).unwrap(id); // exit supersedes election
    expect(await registrar.ownerOf(id)).to.equal(a.address);
    await expect(nameVault.position(id)).to.be.revertedWithCustomError(nameVault, "UnknownPosition");
    await nameVault.connect(a).unwrap(node);
    expect(await wrapper.balanceOf(a.address, node)).to.equal(1n);
    expect(await nameVault.positionCount()).to.equal(0);
    // only the position owner may unwrap
    const id2 = lh("held");
    await registrar.register(id2, a.address);
    await registrar.connect(a).approve(await nameVault.getAddress(), id2);
    await nameVault.connect(a).wrapName(id2, { value: NAME_FEE });
    await expect(nameVault.connect(voters[1]).unwrap(id2))
      .to.be.revertedWithCustomError(nameVault, "NotPositionOwner");
  });

  it("per-owner index stays exact across wraps, transfers, and unwraps (D9)", async () => {
    const { registrar, nameVault, voters } = await setup();
    const [a, b] = voters;
    const ids = ["n1", "n2", "n3"].map(lh);
    for (const id of ids) {
      await registrar.register(id, a.address);
      await registrar.connect(a).approve(await nameVault.getAddress(), id);
      await nameVault.connect(a).wrapName(id, { value: NAME_FEE });
    }
    expect((await nameVault.positionsOf(a.address)).map(String).sort())
      .to.deep.equal(ids.map(String).sort());
    // transfer the MIDDLE position (exercises swap-and-pop)
    await nameVault.connect(a).transferFrom(a.address, b.address, ids[1]);
    expect((await nameVault.positionsOf(a.address)).map(String).sort())
      .to.deep.equal([ids[0], ids[2]].map(String).sort());
    expect((await nameVault.positionsOf(b.address)).map(String)).to.deep.equal([String(ids[1])]);
    await nameVault.connect(b).unwrap(ids[1]);
    expect(await nameVault.positionsOf(b.address)).to.deep.equal([]);
    expect(await registrar.ownerOf(ids[1])).to.equal(b.address); // position transfer moved the claim
  });

  it("rejects unsolicited 1155 pushes (fake-deposit guard, V4/V6)", async () => {
    const { wrapper, nameVault, voters } = await setup();
    const [a] = voters;
    const node = lh("sneaky");
    await wrapper.mintWrapped(node, a.address, 0, 2n ** 40n);
    await expect(wrapper.attackTransfer(a.address, await nameVault.getAddress(), node))
      .to.be.revertedWithCustomError(nameVault, "UnsolicitedTransfer");
  });

  it("declares the complete ERC-165 set (the LNR line-382 lesson)", async () => {
    const { nameVault } = await setup();
    expect(await nameVault.supportsInterface("0x01ffc9a7")).to.equal(true); // ERC-165
    expect(await nameVault.supportsInterface("0x80ac58cd")).to.equal(true); // ERC-721
    expect(await nameVault.supportsInterface("0x5b5e139f")).to.equal(true); // ERC-721 Metadata
    expect(await nameVault.supportsInterface("0x4e2312e0")).to.equal(true); // ERC-1155 Receiver
    expect(await nameVault.supportsInterface("0xdeadbeef")).to.equal(false);
  });
});

describe("NameVault — migration slot (Article X shape)", () => {
  it("slot is born empty; fills exactly once via Constitutional proposal; releases only ELECTED positions to the adapter (I8)", async function () {
    this.timeout(240000);
    const { gov, registrar, nameVault, voters } = await setup();
    const [a, adapterSigner] = [voters[0], voters[4]];
    const elected = lh("goes-to-v2");
    const legacy = lh("stays-legacy");
    for (const id of [elected, legacy]) {
      await registrar.register(id, a.address);
      await registrar.connect(a).approve(await nameVault.getAddress(), id);
      await nameVault.connect(a).wrapName(id, { value: NAME_FEE });
    }
    // nothing works while the slot is empty
    await expect(nameVault.executeMigration(elected))
      .to.be.revertedWithCustomError(nameVault, "AdapterNotSet");
    // Treasury-kind is not enough to fill it — Constitutional only
    await climbToT3(gov, voters);
    const payload = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address"], [adapterSigner.address]));
    const desc = await nameVault.expectedDescriptionHash(await nameVault.ACTION_SET_MIGRATION_ADAPTER(), payload);
    let pid = Number(await gov.proposalCount()) + 1;
    await gov.connect(a).createProposal(2, desc); // Treasury kind
    await runVotes(gov, pid, voters.map((v) => [v, 1]), "low");
    await expect(nameVault.setMigrationAdapter(pid, adapterSigner.address))
      .to.be.revertedWithCustomError(nameVault, "ProposalKindTooLow");
    pid = Number(await gov.proposalCount()) + 1;
    await gov.connect(a).createProposal(3, desc); // Constitutional
    await runVotes(gov, pid, voters.map((v) => [v, 1]), "ok");
    await expect(nameVault.setMigrationAdapter(pid, adapterSigner.address))
      .to.emit(nameVault, "MigrationAdapterSet");
    // exactly once
    await expect(nameVault.setMigrationAdapter(pid, adapterSigner.address))
      .to.be.revertedWithCustomError(nameVault, "AdapterAlreadySet");

    // I8: only elected positions, only the adapter
    await nameVault.connect(a).electUpgrade(elected);
    await expect(nameVault.connect(a).executeMigration(elected))
      .to.be.revertedWithCustomError(nameVault, "NotMigrationAdapter");
    await expect(nameVault.connect(adapterSigner).executeMigration(legacy))
      .to.be.revertedWithCustomError(nameVault, "NotElected");
    await expect(nameVault.connect(adapterSigner).executeMigration(elected))
      .to.emit(nameVault, "PositionMigrated");
    expect(await registrar.ownerOf(elected)).to.equal(adapterSigner.address);
    expect((await nameVault.position(elected)).v2Status).to.equal(2); // UPGRADED
    expect(await registrar.ownerOf(legacy)).to.equal(await nameVault.getAddress()); // untouched
    // a rescinded election cannot migrate
    await nameVault.connect(a).electUpgrade(legacy);
    await nameVault.connect(a).rescindUpgrade(legacy);
    await expect(nameVault.connect(adapterSigner).executeMigration(legacy))
      .to.be.revertedWithCustomError(nameVault, "NotElected");
  });
});
