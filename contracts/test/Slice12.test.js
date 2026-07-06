const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");

const E = (n) => ethers.parseEther(String(n));
const WAD = 10n ** 18n;
const DAY = 86400;
const VEST = 30 * DAY;
const DELAY = 100, COMMIT = 1000, REVEAL = 1000;
const EPOCH = 10 * DAY, QUORUM = 100, MINCOUNT = 10n ** 9n;
const LADDER_C = [2, 3, 5], LADDER_T = [500, 1000, 1500];
const ERA_WADS = [4n * WAD, 3n * WAD, 2n * WAD, 1n * WAD];
const LEAF_TYPES = ["bytes32", "uint40", "uint32", "uint8", "uint16", "uint8"];

const lh = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const labelOf = (s) => ethers.toUtf8Bytes(s);
const asStruct = (l) => ({ labelhash: l[0], registrationTimestamp: l[1], ordinalRank: l[2], era: l[3], flags: l[4], leafVersion: l[5] });
const jump = async (s) => { await network.provider.send("evm_increaseTime", [s]); await network.provider.send("evm_mine"); };
const salt = (s) => ethers.id(s);

async function vote(gov, voter, id, support, tag) {
  const c = await gov.commitmentOf(id, voter.address, support, salt(tag));
  await gov.connect(voter).commit(id, c);
  return () => gov.connect(voter).reveal(id, support, salt(tag));
}

function composeRep(prov, tenure, part, cat) {
  return (prov * 4000n + tenure * 2500n + part * 3000n + cat * 500n) / 10000n;
}
function composeMult(rep) {
  return WAD + (rep * (WAD / 4n)) / 10000n;
}

async function setup() {
  const [deployer, vaultGov, a, b, c, pool] = await ethers.getSigners();
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
  const leaves = [
    [lh("rilxxlir"), 1494000000, 1, 0, 4, 1],
    [lh("filler"), 1600000000, 5000, 2, 0, 1],
  ];
  const tree = StandardMerkleTree.of(leaves, LEAF_TYPES);
  const attestor = await (await ethers.getContractFactory("AttestorRegistry")).deploy(
    await gov.getAddress(), await registrar.getAddress(), ERA_WADS, [tree.root]
  );
  const exec = await (await ethers.getContractFactory("MockRenewalExecutor")).deploy(E("0.002"));
  const renewalPool = await (await ethers.getContractFactory("RenewalPool")).deploy(
    await gov.getAddress(), await nameVault.getAddress(), await exec.getAddress(),
    pool.address, E("0.002"), 1000, E("0.01"), 3, 2, 7 * DAY
  );
  const constitution = await (await ethers.getContractFactory("ConstitutionRegistry")).deploy(
    await gov.getAddress(), ["I", "II", "III", "IV"]
  );
  const modReg = await (await ethers.getContractFactory("ModuleRegistry")).deploy(
    await gov.getAddress(), await constitution.getAddress(), []
  );
  const citizen = await (await ethers.getContractFactory("Citizen")).deploy(
    await tokenVault.getAddress(), await nameVault.getAddress(), await modReg.getAddress()
  );
  const zkHelper = await (await ethers.getContractFactory("MockZKHelper")).deploy();
  const zkVerifier = await (await ethers.getContractFactory("MockZKVerifier")).deploy(await zkHelper.getAddress());
  const humanAttestor = await (await ethers.getContractFactory("HumanAttestor")).deploy(
    await zkVerifier.getAddress(), "ensplus.test", true
  );
  const oracle = await (await ethers.getContractFactory("TrustOracle")).deploy(
    await attestor.getAddress(), await gov.getAddress(), await nameVault.getAddress(),
    await renewalPool.getAddress(), await citizen.getAddress(), await humanAttestor.getAddress()
  );
  for (const v of voters) {
    await ens.mint(v.address, E(10_000));
    await ens.connect(v).approve(await tokenVault.getAddress(), ethers.MaxUint256);
    await tokenVault.connect(v).wrap(E(100));
  }
  await jump(VEST + 1);
  return { deployer, gov, registrar, nameVault, attestor, renewalPool, citizen, oracle, voters, tree, leaves, zkVerifier, zkHelper, humanAttestor };
}

async function ownAndWrap(registrar, nameVault, owner, name) {
  const id = BigInt(lh(name));
  await registrar.register(id, owner.address);
  await registrar.connect(owner).approve(await nameVault.getAddress(), id);
  await nameVault.connect(owner).wrapName(id, { value: 0 });
  return id;
}

describe("TrustOracle - LibTrust live against the registries", () => {
  it("a stranger's name reverts; an owned-but-unattested name scores category, not provenance", async () => {
    const { registrar, nameVault, oracle, voters } = await setup();
    const [a, b] = voters;
    await ownAndWrap(registrar, nameVault, b, "999");
    await expect(oracle.reputationOf(a.address, labelOf("999")))
      .to.be.revertedWithCustomError(oracle, "NotMembersName");
    const bd = await oracle.breakdownOf(b.address, labelOf("999"));
    expect(bd.provenance).to.equal(0n);
    expect(bd.category).to.be.greaterThan(0n);
    expect(bd.reputation).to.equal(composeRep(bd.provenance, bd.tenure, bd.participation, bd.category));
    expect(bd.multiplierWad).to.equal(composeMult(bd.reputation));
    expect(bd.multiplierWad).to.be.greaterThan(WAD);
    expect(bd.multiplierWad).to.be.lessThanOrEqual(WAD + WAD / 4n);
  });

  it("live prepunk gradient: claim a 2017 name -> provenance maxes, reputation rises, capped at +25%", async () => {
    const { registrar, nameVault, attestor, oracle, voters, tree, leaves } = await setup();
    const [a] = voters;
    const id = BigInt(leaves[0][0]);
    await registrar.register(id, a.address);
    await attestor.connect(a).claim(0, tree.getProof(0), asStruct(leaves[0]));
    await registrar.connect(a).approve(await nameVault.getAddress(), id);
    await nameVault.connect(a).wrapName(id, { value: 0 });
    const bd = await oracle.breakdownOf(a.address, labelOf("rilxxlir"));
    expect(bd.provenance).to.equal(10000n);
    expect(bd.reputation).to.be.greaterThan(4000n);
    expect(bd.reputation).to.equal(composeRep(bd.provenance, bd.tenure, bd.participation, bd.category));
    expect(bd.multiplierWad).to.equal(composeMult(bd.reputation));
    expect(bd.multiplierWad).to.be.lessThanOrEqual(WAD + WAD / 4n);
    expect(await attestor.boundRank(leaves[0][0])).to.equal(1n);
  });

  it("participation lifts reputation over epochs (member-level, ungameable denominator)", async () => {
    const { gov, registrar, nameVault, oracle, voters } = await setup();
    const [a] = voters;
    await ownAndWrap(registrar, nameVault, a, "participant");
    const before = await oracle.breakdownOf(a.address, labelOf("participant"));
    for (let ep = 0; ep < 3; ep++) {
      const pid = Number(await gov.proposalCount()) + 1;
      await gov.connect(a).createProposal(0, ethers.id(`p${ep}`));
      await jump(DELAY + 1);
      const r = await vote(gov, a, pid, 2, `p${ep}`);
      await jump(COMMIT);
      await r();
      await jump(EPOCH - (DELAY + COMMIT + 2));
    }
    const after = await oracle.breakdownOf(a.address, labelOf("participant"));
    expect(after.participation).to.be.greaterThan(before.participation);
    expect(after.reputation).to.be.greaterThan(before.reputation);
  });

  it("verified humanity lifts the live reputation (sybil-proof bonus)", async () => {
    const { registrar, nameVault, oracle, zkVerifier, humanAttestor, voters } = await setup();
    const [a] = voters;
    await ownAndWrap(registrar, nameVault, a, "human");
    const before = await oracle.reputationOf(a.address, labelOf("human"));
    // a proves humanity
    const enc = ethers.AbiCoder.defaultAbiCoder();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    await zkVerifier.set(true, ethers.id("passport-a"));
    const p = {
      version: ethers.ZeroHash,
      proofVerificationData: { vkeyHash: ethers.ZeroHash, proof: "0x", publicInputs: [ethers.id("ok")] },
      committedInputs: enc.encode(["address", "uint256"], [a.address, chainId]),
      serviceConfig: { validityPeriodInSeconds: 0, domain: "ensplus.test", scope: "ensplus.citizen", devMode: false },
    };
    await humanAttestor.connect(a).claim(p);
    const after = await oracle.reputationOf(a.address, labelOf("human"));
    expect(after).to.equal(before + 2000n > 10000n ? 10000n : before + 2000n);
    expect(after).to.be.greaterThan(before);
  });
});
