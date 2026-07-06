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
const WINDOW = 3600, BOND = ethers.parseEther("0.1");
const ERA_WADS = [2n * WAD, 15n * 10n ** 17n, 125n * 10n ** 16n, WAD]; // 2.0 / 1.5 / 1.25 / 1.0
const LEAF_TYPES = ["bytes32", "uint40", "uint32", "uint8", "uint16", "uint8"];
const LAYER0 = ["Article I.", "Article II.", "Article III.", "Article IV."];

const jump = async (s) => { await network.provider.send("evm_increaseTime", [s]); await network.provider.send("evm_mine"); };
const isqrt = (n) => { if (n < 2n) return n; let x = n, y = (x + 1n) >> 1n; while (y < x) { x = y; y = (x + n / x) >> 1n; } return x; };
const salt = (s) => ethers.id(s);
const lh = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const asStruct = (l) => ({ labelhash: l[0], registrationTimestamp: l[1], ordinalRank: l[2], era: l[3], flags: l[4], leafVersion: l[5] });

async function vote(gov, voter, id, support, tag) {
  const c = await gov.commitmentOf(id, voter.address, support, salt(tag));
  await gov.connect(voter).commit(id, c);
  return () => gov.connect(voter).reveal(id, support, salt(tag));
}

async function runVotes(gov, id, votePlan, tag) {
  await jump(DELAY + 1);
  const rs = [];
  for (let i = 0; i < votePlan.length; i++) rs.push(await vote(gov, votePlan[i][0], id, votePlan[i][1], `${tag}${i}`));
  await jump(COMMIT);
  for (const r of rs) await r();
  await jump(REVEAL + 1);
}

async function setup() {
  const [deployer, a, b, c, pool] = await ethers.getSigners();
  const voters = [a, b, c];
  const ens = await (await ethers.getContractFactory("MockENS")).deploy();
  const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy([pool.address], [10000]);
  const registrar = await (await ethers.getContractFactory("MockRegistrar")).deploy();

  // attestation corpus: rank 1 prepunk, a modern name, and an auction-era name
  const leaves = [
    [lh("rilxxlir"), 1494000000, 1, 0, 4, 1],
    [lh("kingname"), 1495000000, 42, 0, 8, 1],
    [lh("auctionname"), 1520000000, 25000, 1, 8, 1],
    [lh("modernname"), 1700000000, 0, 3, 0, 1],
  ];
  const tree = StandardMerkleTree.of(leaves, LEAF_TYPES);

  // ---- genesis ceremony rehearsal: vault needs steward's FUTURE address
  const deployerNonce = await ethers.provider.getTransactionCount(deployer.address);
  // deploy order from here: vault (nonce), governor (+1), attestor (+2), constitution (+3), so (+4), steward (+5)
  const predictedSteward = ethers.getCreateAddress({ from: deployer.address, nonce: deployerNonce + 5 });

  const vault = await (await ethers.getContractFactory("ENSPLUSVault")).deploy(
    await ens.getAddress(), predictedSteward, await splitter.getAddress(), 0n, deployer.address
  );
  const gov = await (await ethers.getContractFactory("InternalGovernor")).deploy([
    await vault.getAddress(), ethers.getCreateAddress({ from: deployer.address, nonce: deployerNonce + 2 }),
    5000, QUORUM, VEST, MINCOUNT, DELAY, COMMIT, REVEAL, EPOCH, LADDER_C, LADDER_T,
  ]);
  const attestor = await (await ethers.getContractFactory("AttestorRegistry")).deploy(
    await gov.getAddress(), await registrar.getAddress(), ERA_WADS, [tree.root]
  );
  const constitution = await (await ethers.getContractFactory("ConstitutionRegistry")).deploy(await gov.getAddress(), LAYER0);
  const so = await (await ethers.getContractFactory("StandingOrders")).deploy(
    [await gov.getAddress(), await constitution.getAddress(), WINDOW, BOND, await splitter.getAddress()],
    [
      { position: 0, articleIds: [3], criteriaHash: ethers.id("SO-3") },
      { position: 1, articleIds: [4], criteriaHash: ethers.id("SO-4") },
    ]
  );
  const steward = await (await ethers.getContractFactory("VaultSteward")).deploy(await gov.getAddress(), await vault.getAddress());
  expect(await steward.getAddress()).to.equal(predictedSteward); // ceremony math holds
  expect(await attestor.getAddress()).to.equal(await gov.provenanceSource()); // and for the attestor

  const extGov = await (await ethers.getContractFactory("MockExternalGovernor")).deploy();
  const adapter = await (await ethers.getContractFactory("GovernorAdapter")).deploy(
    await gov.getAddress(), await so.getAddress(), await extGov.getAddress(), 6000
  );

  for (const v of voters) {
    await ens.mint(v.address, E(10_000));
    await ens.connect(v).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(v).wrap(E(100));
  }
  await jump(VEST + 1);
  return { ens, vault, gov, attestor, constitution, so, steward, adapter, extGov, registrar, splitter, voters, tree, leaves, deployer };
}

describe("AttestorRegistry (Registry of Elders)", () => {
  it("claims bind name provenance to the current owner and flow into governor weight (full-stack)", async () => {
    const { gov, attestor, registrar, voters, tree, leaves } = await setup();
    const [a, b] = voters;
    await registrar.setOwner(BigInt(leaves[0][0]), a.address); // a owns rilxxlir
    await expect(attestor.connect(b).claim(0, tree.getProof(0), asStruct(leaves[0])))
      .to.be.revertedWithCustomError(attestor, "NotNameOwner");
    await expect(attestor.connect(a).claim(0, tree.getProof(0), asStruct(leaves[0])))
      .to.emit(attestor, "NameClaimed");
    expect(await attestor.provenanceWad(a.address)).to.equal(2n * WAD); // prepunk 2.0x
    expect(await attestor.provenanceWad(b.address)).to.equal(0n); // unknown -> neutral at governor
    // the multiplier reaches actual voting weight
    await gov.connect(a).createProposal(0, ethers.id("p"));
    expect(await gov.rawWeightAt(a.address, 1)).to.equal(2n * isqrt(E(100)));
    expect(await gov.rawWeightAt(b.address, 1)).to.equal(isqrt(E(100)));
  });

  it("rebinding: selling the name moves the provenance; best-era wins across multiple claims", async () => {
    const { attestor, registrar, voters, tree, leaves } = await setup();
    const [a, b] = voters;
    // a claims an auction name (1.5x) and the modern name (1.0x)
    await registrar.setOwner(BigInt(leaves[2][0]), a.address);
    await registrar.setOwner(BigInt(leaves[3][0]), a.address);
    await attestor.connect(a).claim(0, tree.getProof(2), asStruct(leaves[2]));
    await attestor.connect(a).claim(0, tree.getProof(3), asStruct(leaves[3]));
    expect(await attestor.provenanceWad(a.address)).to.equal(ERA_WADS[1]); // best = auction 1.5x
    // "sale": registrar owner flips to b; b claims; a falls back to modern 1.0x
    await registrar.setOwner(BigInt(leaves[2][0]), b.address);
    await expect(attestor.connect(b).claim(0, tree.getProof(2), asStruct(leaves[2])))
      .to.emit(attestor, "NameUnbound");
    expect(await attestor.provenanceWad(b.address)).to.equal(ERA_WADS[1]);
    expect(await attestor.provenanceWad(a.address)).to.equal(WAD); // modern only now
    expect(await attestor.eraCount(a.address, 1)).to.equal(0);
    // duplicate claim by same binder rejected
    await expect(attestor.connect(b).claim(0, tree.getProof(2), asStruct(leaves[2])))
      .to.be.revertedWithCustomError(attestor, "AlreadyBoundToClaimant");
  });

  it("rejects bad proofs, unknown roots, and out-of-range era tables", async () => {
    const { attestor, registrar, voters, tree, leaves } = await setup();
    const [a] = voters;
    await registrar.setOwner(BigInt(leaves[1][0]), a.address);
    const tampered = asStruct(leaves[1]);
    tampered.ordinalRank = 2;
    await expect(attestor.connect(a).claim(0, tree.getProof(1), tampered))
      .to.be.revertedWithCustomError(attestor, "InvalidProof");
    await expect(attestor.connect(a).claim(9, tree.getProof(1), asStruct(leaves[1])))
      .to.be.revertedWithCustomError(attestor, "UnknownRoot");
    const F = await ethers.getContractFactory("AttestorRegistry");
    const gAddr = await (await ethers.getSigners())[0].getAddress();
    await expect(F.deploy(gAddr, await registrar.getAddress(), [WAD, 2n * WAD, WAD, WAD], []))
      .to.be.revertedWithCustomError(F, "BadEraWad"); // non-increasing violated
    await expect(F.deploy(gAddr, await registrar.getAddress(), [5n * WAD, WAD, WAD, WAD], []))
      .to.be.revertedWithCustomError(F, "BadEraWad"); // above 4x ceiling
  });
});

describe("GovernorAdapter (external voice, directional)", () => {
  it("mirror mode: casts FULL power in the winning direction when the bloc is decisive", async () => {
    const { gov, adapter, extGov, voters } = await setup();
    const [a, b, c] = voters;
    const EXT = 777n;
    await extGov.setSnapshot(EXT, 12345);
    const power = E(1_000_000) + 7n;
    await extGov.setVotes(await adapter.getAddress(), 12345, power);
    const desc = await adapter.externalBindingHash(EXT);
    await gov.connect(a).createProposal(0, desc);
    // 2 FOR, 1 AGAINST, equal weights -> For share = 2/3 = 6667 bps >= 6000 threshold
    await runVotes(gov, 1, [[a, 1], [b, 1], [c, 0]], "m");
    await adapter.castMirror(1, EXT);
    const cast = await extGov.lastCast();
    expect(cast.support).to.equal(1); // FOR (full weight, one option)
    expect(await adapter.supportOf(EXT)).to.equal(1);
    expect(await adapter.castModeOf(EXT)).to.equal(1); // Mirror
    expect(cast.reason).to.contain("ENSPLUS");
    await expect(adapter.castMirror(1, EXT)).to.be.revertedWithCustomError(adapter, "AlreadyCast");
  });

  it("mirror mode: a DIVIDED bloc abstains externally rather than ram a narrow majority", async () => {
    const { gov, adapter, so, extGov, voters } = await setup();
    const [a, b, c] = voters;
    // a fresh adapter with a 70% confidence bar; a 2-1 split (66.7%) is below it
    const hi = await (await ethers.getContractFactory("GovernorAdapter")).deploy(
      await gov.getAddress(), await so.getAddress(), await extGov.getAddress(), 7000
    );
    const EXT = 779n;
    await extGov.setSnapshot(EXT, 1);
    await extGov.setVotes(await hi.getAddress(), 1, E(1_000_000));
    const desc = await hi.externalBindingHash(EXT);
    await gov.connect(a).createProposal(0, desc);
    await runVotes(gov, 1, [[a, 1], [b, 1], [c, 0]], "d"); // 2 FOR, 1 AGAINST = 66.7% < 70%
    await hi.castMirror(1, EXT);
    expect((await extGov.lastCast()).support).to.equal(2); // ABSTAIN (too divided)
    expect(await hi.castModeOf(EXT)).to.equal(1); // still Mirror (the decision was internal)
  });

  it("binding enforced: an unrelated internal tally cannot speak for an external", async () => {
    const { gov, adapter, extGov, voters } = await setup();
    const [a] = voters;
    await extGov.setSnapshot(9n, 1);
    await extGov.setVotes(await adapter.getAddress(), 1, E(1));
    await gov.connect(a).createProposal(0, ethers.id("unrelated"));
    await runVotes(gov, 1, [[a, 1]], "u");
    await expect(adapter.castMirror(1, 9n)).to.be.revertedWithCustomError(adapter, "WrongBinding");
    const desc = await adapter.externalBindingHash(9n);
    await gov.connect(a).createProposal(0, desc);
    await expect(adapter.castMirror(2, 9n)).to.be.revertedWithCustomError(adapter, "InternalNotEnded");
  });

  it("quorum-fail routes to standing order; unclassified abstains with full power", async () => {
    const { gov, so, adapter, extGov, voters } = await setup();
    const [a] = voters;
    const EXT = 4242n;
    await extGov.setSnapshot(EXT, 5);
    await extGov.setVotes(await adapter.getAddress(), 5, E(500_000));
    await so.connect(a).postClassification(ethers.toBeHex(EXT, 32), 1); // AGAINST
    await jump(WINDOW + 1);
    await so.finalize(1);
    const desc = await adapter.externalBindingHash(EXT);
    await gov.connect(a).createProposal(0, desc);
    await jump(DELAY + COMMIT + REVEAL + 2);
    expect(await gov.outcome(1)).to.equal(1); // QuorumFailed
    await adapter.castMirror(1, EXT);
    expect((await extGov.lastCast()).support).to.equal(0); // AGAINST per SO, full power
    expect(await adapter.castModeOf(EXT)).to.equal(2); // StandingOrder
    // pure-SO cast on another classified external
    const EXT2 = 4343n;
    await extGov.setSnapshot(EXT2, 5);
    await extGov.setVotes(await adapter.getAddress(), 5, E(100));
    await so.connect(a).postClassification(ethers.toBeHex(EXT2, 32), 2); // FOR
    await jump(WINDOW + 1);
    await so.finalize(2);
    await adapter.castStandingOrder(EXT2);
    expect((await extGov.lastCast()).support).to.equal(1); // FOR
    // unclassified external: full abstain, never guesses
    const EXT3 = 4444n;
    await extGov.setSnapshot(EXT3, 5);
    await extGov.setVotes(await adapter.getAddress(), 5, E(9));
    await adapter.castStandingOrder(EXT3);
    expect((await extGov.lastCast()).support).to.equal(2); // ABSTAIN
    expect(await adapter.castModeOf(EXT3)).to.equal(3); // AbstainDefault
  });
});

describe("VaultSteward (delegatee governance, genesis ceremony)", () => {
  it("redirects the vault's underlying delegation only via a ratified Override proposal", async () => {
    const { ens, vault, gov, steward, adapter, voters } = await setup();
    const [a, b] = voters;
    // initial delegatee was the deployer placeholder; redirect to the adapter (the real genesis move)
    const target = await adapter.getAddress();
    const desc = await steward.expectedDescriptionHash(await steward.ACTION_REDIRECT(),
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address"], [target])));
    await gov.connect(a).createProposal(0, desc);
    await runVotes(gov, 1, [[a, 1], [b, 1]], "r");
    // wrong payload cannot execute
    await expect(steward.redirectDelegatee(1, b.address))
      .to.be.revertedWithCustomError(steward, "PayloadMismatch");
    await expect(steward.redirectDelegatee(1, target)).to.emit(steward, "DelegateeRedirected");
    expect(await vault.delegatee()).to.equal(target);
    expect(await ens.getVotes(target)).to.equal(E(300)); // the bloc's full underlying power
    await expect(steward.redirectDelegatee(1, target))
      .to.be.revertedWithCustomError(steward, "ProposalAlreadyConsumed");
    // and nobody can call the vault directly
    await expect(vault.connect(a).setDelegatee(a.address))
      .to.be.revertedWithCustomError(vault, "NotGovernor");
  });
});
