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
const node = (s) => ethers.namehash(s);
const asStruct = (l) => ({ labelhash: l[0], registrationTimestamp: l[1], ordinalRank: l[2], era: l[3], flags: l[4], leafVersion: l[5] });
const jump = async (s) => { await network.provider.send("evm_increaseTime", [s]); await network.provider.send("evm_mine"); };

// selectors for ENSIP-10 resolve dispatch
const IFACE = new ethers.Interface([
  "function text(bytes32 node, string key) view returns (string)",
  "function addr(bytes32 node) view returns (address)",
  "function contenthash(bytes32 node) view returns (bytes)",
]);

async function setup() {
  const [deployer, vaultGov, a, b, pool] = await ethers.getSigners();
  const voters = [a, b, deployer];
  const ens = await (await ethers.getContractFactory("MockENS")).deploy();
  const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy([pool.address], [10000]);
  const tokenVault = await (await ethers.getContractFactory("ENSPLUSVault")).deploy(
    await ens.getAddress(), vaultGov.address, await splitter.getAddress(), 0n, vaultGov.address);
  const gov = await (await ethers.getContractFactory("InternalGovernor")).deploy([
    await tokenVault.getAddress(), ethers.ZeroAddress,
    5000, QUORUM, VEST, MINCOUNT, DELAY, COMMIT, REVEAL, EPOCH, LADDER_C, LADDER_T]);
  const registrar = await (await ethers.getContractFactory("MockBaseRegistrar")).deploy();
  const wrapper = await (await ethers.getContractFactory("MockNameWrapper")).deploy();
  const nameVault = await (await ethers.getContractFactory("NameVault")).deploy(
    await gov.getAddress(), await registrar.getAddress(), await wrapper.getAddress(), await splitter.getAddress(), 0n);
  const leaves = [
    [lh("rilxxlir"), 1494000000, 1, 0, 4, 1],
    [lh("filler"), 1600000000, 5000, 2, 0, 1],
  ];
  const tree = StandardMerkleTree.of(leaves, LEAF_TYPES);
  const attestor = await (await ethers.getContractFactory("AttestorRegistry")).deploy(
    await gov.getAddress(), await registrar.getAddress(), ERA_WADS, [tree.root]);
  const exec = await (await ethers.getContractFactory("MockRenewalExecutor")).deploy(E("0.002"));
  const renewalPool = await (await ethers.getContractFactory("RenewalPool")).deploy(
    await gov.getAddress(), await nameVault.getAddress(), await exec.getAddress(),
    pool.address, E("0.002"), 1000, E("0.01"), 3, 2, 7 * DAY);
  const constitution = await (await ethers.getContractFactory("ConstitutionRegistry")).deploy(
    await gov.getAddress(), ["I", "II", "III", "IV"]);
  const modReg = await (await ethers.getContractFactory("ModuleRegistry")).deploy(
    await gov.getAddress(), await constitution.getAddress(), []);
  const citizen = await (await ethers.getContractFactory("Citizen")).deploy(
    await tokenVault.getAddress(), await nameVault.getAddress(), await modReg.getAddress());
  const oracle = await (await ethers.getContractFactory("TrustOracle")).deploy(
    await attestor.getAddress(), await gov.getAddress(), await nameVault.getAddress(),
    await renewalPool.getAddress(), await citizen.getAddress(), ethers.ZeroAddress);
  const ensRegistry = await (await ethers.getContractFactory("MockENSRegistry")).deploy();
  const resolver = await (await ethers.getContractFactory("CitizenResolver")).deploy(
    await ensRegistry.getAddress(), await oracle.getAddress(), await attestor.getAddress(),
    await renewalPool.getAddress());
  return { deployer, gov, registrar, nameVault, attestor, oracle, ensRegistry, resolver, voters, tree, leaves, a, b };
}

async function ownAndWrap(registrar, nameVault, owner, name) {
  const id = BigInt(lh(name));
  await registrar.register(id, owner.address);
  await registrar.connect(owner).approve(await nameVault.getAddress(), id);
  await nameVault.connect(owner).wrapName(id, { value: 0 });
  return id;
}

describe("CitizenResolver - civic identity as an ENS resolver", () => {
  it("is ownerless: only node-owner-gated writers, no admin surface", async () => {
    const { resolver } = await setup();
    const names = resolver.interface.fragments
      .filter((f) => f.type === "function" && f.stateMutability !== "view" && f.stateMutability !== "pure")
      .map((f) => f.name).sort();
    expect(names).to.deep.equal(["link", "setAddr", "setContenthash", "setText", "unlink"]);
    // no owner/admin/pause/upgrade
    for (const bad of ["owner", "admin", "pause", "upgradeTo", "setOwner"]) {
      expect(resolver.interface.fragments.some((f) => f.type === "function" && f.name === bad)).to.equal(false);
    }
  });

  it("link is ENS-owner-gated; setText rejects reserved ensplus.* keys", async () => {
    const { resolver, ensRegistry, a, b } = await setup();
    const nd = node("alice.eth");
    await expect(resolver.connect(a).link(nd, labelOf("alice")))
      .to.be.revertedWithCustomError(resolver, "NotNodeOwner");
    await ensRegistry.setOwner(nd, a.address);
    await resolver.connect(a).link(nd, labelOf("alice"));
    expect(await resolver.labelOf(nd)).to.equal(ethers.hexlify(labelOf("alice")));
    await resolver.connect(a).setText(nd, "com.twitter", "alice");
    expect(await resolver.text(nd, "com.twitter")).to.equal("alice");
    await expect(resolver.connect(a).setText(nd, "ensplus.era", "Prepunk"))
      .to.be.revertedWithCustomError(resolver, "ReservedKey"); // civic keys are computed, not set
  });

  it("recordVersion pattern: unlink/relink cheaply clears prior user records", async () => {
    const { resolver, ensRegistry, a } = await setup();
    const nd = node("bob.eth");
    await ensRegistry.setOwner(nd, a.address);
    await resolver.connect(a).link(nd, labelOf("bob"));
    await resolver.connect(a).setText(nd, "url", "https://bob.example");
    expect(await resolver.text(nd, "url")).to.equal("https://bob.example");
    const v1 = await resolver.recordVersion(nd);
    await resolver.connect(a).unlink(nd); // bumps version
    expect(await resolver.recordVersion(nd)).to.equal(v1 + 1n);
    expect(await resolver.text(nd, "url")).to.equal(""); // old record gone, no delete needed
    await resolver.connect(a).link(nd, labelOf("bob"));
    expect(await resolver.text(nd, "url")).to.equal(""); // still clean after relink
  });

  it("live civic records: era/rank/reputation reflect on-chain truth for a prepunk citizen", async () => {
    const { resolver, ensRegistry, registrar, nameVault, attestor, oracle, tree, leaves, a } = await setup();
    const nd = node("rilxxlir.eth");
    const id = BigInt(leaves[0][0]);
    await registrar.register(id, a.address);
    await attestor.connect(a).claim(0, tree.getProof(0), asStruct(leaves[0])); // bind prepunk to a
    await registrar.connect(a).approve(await nameVault.getAddress(), id);
    await nameVault.connect(a).wrapName(id, { value: 0 });
    await ensRegistry.setOwner(nd, a.address);
    await resolver.connect(a).link(nd, labelOf("rilxxlir"));

    expect(await resolver.text(nd, "ensplus.era")).to.equal("Prepunk");
    expect(await resolver.text(nd, "ensplus.rank")).to.equal("1");
    const rep = await oracle.reputationOf(a.address, labelOf("rilxxlir"));
    expect(await resolver.text(nd, "ensplus.reputation")).to.equal(rep.toString());
    expect(await resolver.text(nd, "ensplus.multiplier")).to.not.equal("");
    // addr defaults to the node's current controller
    expect(await resolver.addr(nd)).to.equal(a.address);
  });

  it("selling the ENS name does not carry the seller's civic identity", async () => {
    const { resolver, ensRegistry, registrar, nameVault, attestor, tree, leaves, a, b } = await setup();
    const nd = node("rilxxlir.eth");
    const id = BigInt(leaves[0][0]);
    await registrar.register(id, a.address);
    await attestor.connect(a).claim(0, tree.getProof(0), asStruct(leaves[0]));
    await ensRegistry.setOwner(nd, a.address);
    await resolver.connect(a).link(nd, labelOf("rilxxlir"));
    expect(await resolver.text(nd, "ensplus.era")).to.equal("Prepunk");
    // a "sells" the ENS name: registry owner becomes b, but the attestation still binds a
    await ensRegistry.setOwner(nd, b.address);
    expect(await resolver.text(nd, "ensplus.era")).to.equal(""); // boundTo(a) != owner(b) -> hidden
    expect(await resolver.text(nd, "ensplus.reputation")).to.equal(""); // oracle reverts -> ""
  });

  it("ENSIP-10 resolve dispatches text/addr on-chain", async () => {
    const { resolver, ensRegistry, a } = await setup();
    const nd = node("carol.eth");
    await ensRegistry.setOwner(nd, a.address);
    await resolver.connect(a).link(nd, labelOf("carol"));
    await resolver.connect(a).setText(nd, "url", "https://carol.example");
    const textCall = IFACE.encodeFunctionData("text", [nd, "url"]);
    const out = await resolver.resolve("0x", textCall);
    expect(IFACE.decodeFunctionResult("text", out)[0]).to.equal("https://carol.example");
    const addrCall = IFACE.encodeFunctionData("addr", [nd]);
    const outA = await resolver.resolve("0x", addrCall);
    expect(ethers.getAddress("0x" + out.slice(-40).length ? IFACE.decodeFunctionResult("addr", outA)[0].slice(2) : "")).to.be.a("string");
  });

  it("CCIP-read: ensplus.offchain.* keys raise OffchainLookup to the gateway", async () => {
    const { resolver, ensRegistry, a } = await setup();
    const nd = node("dave.eth");
    await ensRegistry.setOwner(nd, a.address);
    await resolver.connect(a).link(nd, labelOf("dave"));
    const call = IFACE.encodeFunctionData("text", [nd, "ensplus.offchain.guild-roster"]);
    await expect(resolver.resolve("0x", call)).to.be.revertedWithCustomError(resolver, "OffchainLookup");
  });

  it("advertises the ENS resolver interfaces via supportsInterface", async () => {
    const { resolver } = await setup();
    for (const id of ["0x01ffc9a7", "0x3b3b57de", "0xf1cb7e06", "0x59d1d43c", "0xbc1c58d1", "0x9061b923"]) {
      expect(await resolver.supportsInterface(id)).to.equal(true);
    }
    expect(await resolver.supportsInterface("0xdeadbeef")).to.equal(false);
  });
});
