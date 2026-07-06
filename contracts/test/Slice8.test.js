const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const DAY = 86400;
const VEST = 30 * DAY;
const DELAY = 100, COMMIT = 1000, REVEAL = 1000;
const EPOCH = 10 * DAY, QUORUM = 100, MINCOUNT = 10n ** 9n;
const LADDER_C = [2, 3, 5], LADDER_T = [500, 1000, 1500];
const CREDIT = 100n * 10n ** 18n;

const lh = (s) => BigInt(ethers.keccak256(ethers.toUtf8Bytes(s)));
const jump = async (s) => { await network.provider.send("evm_increaseTime", [s]); await network.provider.send("evm_mine"); };
const salt = (s) => ethers.id(s);

const FORFEIT = ethers.keccak256(ethers.toUtf8Bytes(
  "ENSPLUS-FORFEITURES-V1: no access to vaulted principal outside holder-initiated flows; " +
  "no mutation of covenants, splitter percentages, attestation roots, or the constitution; " +
  "no role grants to third parties on member names; no pause, freeze, or gating of unwrap/exit; " +
  "no external calls outside a named adapter; no interaction with positions mid-migration."));

async function vote(gov, voter, id, support, tag) {
  const c = await gov.commitmentOf(id, voter.address, support, salt(tag));
  await gov.connect(voter).commit(id, c);
  return () => gov.connect(voter).reveal(id, support, salt(tag));
}

async function setup() {
  const [deployer, vaultGov, a, b, c, outsider, pool] = await ethers.getSigners();
  const voters = [a, b, c];
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

  // Genesis ceremony (correct ordering): module machine checks run against LIVE
  // bytecode, so ParticipationCredits must EXIST before the registry charters
  // it. Citizen needs the registry address, pcredits needs Citizen — a cycle.
  // Break it by predicting the REGISTRY address (deployed last):
  //   citizen(nonce) -> pcredits(+1) -> registry(+2, genesis manifest -> pcredits)
  const deployerNonce = await ethers.provider.getTransactionCount(deployer.address);
  const predictedRegistry = ethers.getCreateAddress({ from: deployer.address, nonce: deployerNonce + 2 });

  const citizen = await (await ethers.getContractFactory("Citizen")).deploy(
    await tokenVault.getAddress(), await nameVault.getAddress(), predictedRegistry
  );
  const pcredits = await (await ethers.getContractFactory("ParticipationCredits")).deploy(
    await gov.getAddress(), await citizen.getAddress()
  );
  const registry = await (await ethers.getContractFactory("ModuleRegistry")).deploy(
    await gov.getAddress(), await constitution.getAddress(), [{
      moduleId: "participation-credits",
      implementation: await pcredits.getAddress(), // LIVE bytecode — checks pass
      permissions: 1 | 2, // P_READ | P_CREDIT
      articleIds: [1],
      forfeituresHash: FORFEIT,
      fullManifestHash: ethers.id("manifest:participation-credits:v1"),
    }]
  );
  expect(await registry.getAddress()).to.equal(predictedRegistry); // ceremony math holds
  expect(await citizen.moduleRegistry()).to.equal(await registry.getAddress());

  for (const v of [a, b]) {
    await ens.mint(v.address, E(1000));
    await ens.connect(v).approve(await tokenVault.getAddress(), ethers.MaxUint256);
    await tokenVault.connect(v).wrap(E(100));
  }
  await jump(VEST + 1);
  return { ens, tokenVault, nameVault, registrar, gov, registry, citizen, pcredits, voters, outsider, deployer };
}

describe("Citizen — identity", () => {
  it("genesis charters the credit module against LIVE bytecode (ceremony ordering is load-bearing)", async () => {
    // Soundness property: the ModuleRegistry machine checks (EXTCODEHASH != 0,
    // ERC-165, moduleId self-report) can only pass against a DEPLOYED contract.
    // That forces the genesis ceremony to deploy ParticipationCredits BEFORE
    // the registry that charters it — which is exactly why setup() predicts the
    // registry address (last deploy) rather than the module's. A manifest
    // pointing at a not-yet-deployed address reverts with CodeHashMismatch;
    // the check below confirms the correct ordering produced an active charter.
    const { registry, pcredits } = await setup();
    expect(await registry.isActive("participation-credits", 1)).to.equal(true);
    expect(await registry.hasActivePermission(await pcredits.getAddress(), 2)).to.equal(true); // P_CREDIT live
  });

  it("proves the failure mode directly: chartering a predicted (empty-code) address reverts", async () => {
    // The bug the ceremony ordering avoids, asserted as a guarantee.
    const [deployer, vaultGov, , , , , pool] = await ethers.getSigners();
    const ens = await (await ethers.getContractFactory("MockENS")).deploy();
    const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy([pool.address], [10000]);
    const tokenVault = await (await ethers.getContractFactory("ENSPLUSVault")).deploy(
      await ens.getAddress(), vaultGov.address, await splitter.getAddress(), 0n, vaultGov.address
    );
    const gov = await (await ethers.getContractFactory("InternalGovernor")).deploy([
      await tokenVault.getAddress(), ethers.ZeroAddress,
      5000, QUORUM, VEST, MINCOUNT, DELAY, COMMIT, REVEAL, EPOCH, LADDER_C, LADDER_T,
    ]);
    const constitution = await (await ethers.getContractFactory("ConstitutionRegistry")).deploy(
      await gov.getAddress(), ["Art I", "Art II", "Art III", "Art IV"]
    );
    const F = await ethers.getContractFactory("ModuleRegistry");
    const notDeployed = ethers.getCreateAddress({ from: deployer.address, nonce: 9999 });
    await expect(F.deploy(await gov.getAddress(), await constitution.getAddress(), [{
      moduleId: "participation-credits",
      implementation: notDeployed, // empty code
      permissions: 1 | 2,
      articleIds: [1],
      forfeituresHash: FORFEIT,
      fullManifestHash: ethers.id("m"),
    }])).to.be.revertedWithCustomError(F, "CodeHashMismatch");
  });

  it("minting requires membership; one per address; account deployed at the predicted address", async () => {
    const { citizen, nameVault, registrar, voters, outsider } = await setup();
    const [a] = voters;
    await expect(citizen.connect(outsider).mintCitizen())
      .to.be.revertedWithCustomError(citizen, "NotAMember");
    await citizen.connect(a).mintCitizen();
    const id = await citizen.citizenOf(a.address);
    expect(id).to.equal(1n);
    expect(await citizen.ownerOf(1)).to.equal(a.address);
    expect(await citizen.accountOf(1)).to.equal(await citizen.predictAccount(1));
    await expect(citizen.connect(a).mintCitizen())
      .to.be.revertedWithCustomError(citizen, "AlreadyCitizen");
    // name-only members qualify too
    const nid = lh("memb");
    await registrar.register(nid, outsider.address);
    await registrar.connect(outsider).approve(await nameVault.getAddress(), nid);
    await nameVault.connect(outsider).wrapName(nid, { value: 0 });
    await citizen.connect(outsider).mintCitizen();
    expect(await citizen.citizenOf(outsider.address)).to.equal(2n);
  });

  it("is soulbound: transfers and approvals-then-transfers revert", async () => {
    const { citizen, voters } = await setup();
    const [a, b] = voters;
    await citizen.connect(a).mintCitizen();
    await expect(citizen.connect(a).transferFrom(a.address, b.address, 1))
      .to.be.revertedWithCustomError(citizen, "Soulbound");
    await citizen.connect(a).approve(b.address, 1);
    await expect(citizen.connect(b).transferFrom(a.address, b.address, 1))
      .to.be.revertedWithCustomError(citizen, "Soulbound");
  });

  it("token-bound account: owner-gated execute, holds and moves ETH", async () => {
    const { citizen, voters } = await setup();
    const [a, b] = voters;
    await citizen.connect(a).mintCitizen();
    const account = await ethers.getContractAt("CitizenAccount", await citizen.accountOf(1));
    expect(await account.owner()).to.equal(a.address);
    await a.sendTransaction({ to: await account.getAddress(), value: E(1) });
    await expect(account.connect(b).execute(b.address, E(1), "0x"))
      .to.be.revertedWithCustomError(account, "NotCitizenOwner");
    const before = await ethers.provider.getBalance(b.address);
    await account.connect(a).execute(b.address, E(1), "0x");
    expect((await ethers.provider.getBalance(b.address)) - before).to.equal(E(1));
  });
});

describe("Citizen — charter-gated credits (full stack)", () => {
  it("a revealed vote earns credits via the chartered module; unrevealed and double claims revert", async () => {
    const { gov, citizen, pcredits, voters } = await setup();
    const [a, b] = voters;
    await citizen.connect(a).mintCitizen();
    await citizen.connect(b).mintCitizen();
    await gov.connect(a).createProposal(0, ethers.id("p"));
    await jump(DELAY + 1);
    const rA = await vote(gov, a, 1, 1, "a");
    await vote(gov, b, 1, 0, "b"); // b commits but never reveals
    await jump(COMMIT);
    await rA();
    // keeper claims on a's behalf — credit lands on a
    await expect(pcredits.connect(b).claim(1, a.address))
      .to.emit(citizen, "CreditsMinted").withArgs(a.address, CREDIT, await pcredits.getAddress());
    expect(await citizen.creditsOf(a.address)).to.equal(CREDIT);
    expect(await citizen.totalCredits()).to.equal(CREDIT);
    await expect(pcredits.claim(1, a.address))
      .to.be.revertedWithCustomError(pcredits, "AlreadyClaimed");
    await expect(pcredits.claim(1, b.address))
      .to.be.revertedWithCustomError(pcredits, "NotRevealed"); // commit without reveal earns nothing
  });

  it("credits are charter-gated at RUNTIME: unchartered callers revert; retiring the module stops minting", async function () {
    this.timeout(240000);
    const { gov, registry, citizen, pcredits, voters } = await setup();
    const [a, b, c] = voters;
    await citizen.connect(a).mintCitizen();
    // unchartered caller (an EOA, or any contract not in the registry) cannot mint
    await expect(citizen.connect(b).mintCredits(a.address, 1n))
      .to.be.revertedWithCustomError(citizen, "NotCreditModule");
    // credits require an existing Citizen
    await gov.connect(a).createProposal(0, ethers.id("p"));
    await jump(DELAY + 1);
    const rA = await vote(gov, a, 1, 1, "a");
    const rC = await vote(gov, c, 1, 1, "c"); // c never minted a Citizen... c isn't even a member
    await jump(COMMIT);
    await rA(); await rC();
    await expect(pcredits.claim(1, c.address)).to.be.revertedWithCustomError(citizen, "NoCitizen");
    await pcredits.claim(1, a.address);

    // climb tiers and RETIRE the module via proposal -> minting stops same block
    const ens = await ethers.getContractAt("MockENS", await (await ethers.getContractAt("ENSPLUSVault", await gov.vault())).underlying());
    for (const v of [c]) {
      await ens.mint(v.address, E(1000));
      await ens.connect(v).approve(await gov.vault(), ethers.MaxUint256);
      await (await ethers.getContractAt("ENSPLUSVault", await gov.vault())).connect(v).wrap(E(100));
    }
    await jump(VEST + 1);
    const five = voters; // 3 voters suffice for T1 (ladder [2,3,5], turnout)
    for (let ep = 0; ep < 3; ep++) {
      const id = Number(await gov.proposalCount()) + 1;
      await gov.connect(a).createProposal(0, ethers.id(`cl${ep}`));
      await jump(DELAY + 1);
      const rs = [];
      for (let i = 0; i < five.length; i++) rs.push(await vote(gov, five[i], id, 2, `cl${ep}${i}`));
      await jump(COMMIT);
      for (const r of rs) await r();
      await jump(EPOCH - (DELAY + COMMIT + 2));
    }
    while ((await gov.lastClosedEpoch()) < (await gov.currentEpoch())) {
      await gov.connect(a).closeEpoch(await gov.lastClosedEpoch());
    }
    expect(Number(await gov.currentTier())).to.be.greaterThanOrEqual(1);
    const retDesc = await registry.expectedDescriptionHash(await registry.ACTION_RETIRE(),
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string", "uint16"], ["participation-credits", 1])));
    const pid = Number(await gov.proposalCount()) + 1;
    await gov.connect(a).createProposal(1, retDesc);
    await jump(DELAY + 1);
    const rs2 = [];
    for (let i = 0; i < five.length; i++) rs2.push(await vote(gov, five[i], pid, 1, `ret${i}`));
    await jump(COMMIT);
    for (const r of rs2) await r();
    await jump(REVEAL + 1);
    await registry.retireModule(pid, "participation-credits", 1);
    expect(await registry.hasActivePermission(await pcredits.getAddress(), 2)).to.equal(false);
    // an old revealed vote can no longer be claimed — the charter is dead
    await expect(pcredits.claim(pid, a.address))
      .to.be.revertedWithCustomError(citizen, "NotCreditModule");
  });
});
