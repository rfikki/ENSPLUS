const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const DAY = 86400;
const VEST = 30 * DAY;
const DELAY = 100, COMMIT = 1000, REVEAL = 1000;
const EPOCH = 10 * DAY, QUORUM = 100;
const MINCOUNT = 10n ** 9n;
const LADDER_C = [2, 3, 5];
const LADDER_T = [500, 1000, 1500];
const WINDOW = 3600; // SO challenge window
const BOND = ethers.parseEther("0.1");

const LAYER0 = [
  "Article I. Name ownership shall be absolute and irrevocable.",
  "Article II. Registration fees exist as an incentive mechanism, not for revenue.",
  "Article III. Income funds ENS development and public goods.",
  "Article IV. ENS integrates with the global namespace.",
];

const jump = async (s) => { await network.provider.send("evm_increaseTime", [s]); await network.provider.send("evm_mine"); };
const salt = (s) => ethers.id(s);

async function vote(gov, voter, id, support, tag) {
  const c = await gov.commitmentOf(id, voter.address, support, salt(tag));
  await gov.connect(voter).commit(id, c);
  return () => gov.connect(voter).reveal(id, support, salt(tag));
}

async function closeAll(gov, keeper) {
  while ((await gov.lastClosedEpoch()) < (await gov.currentEpoch())) {
    await gov.connect(keeper).closeEpoch(await gov.lastClosedEpoch());
  }
}

// run a proposal through commit-reveal with all `supporters` voting FOR
async function passProposal(gov, proposer, kind, descriptionHash, supporters, tag) {
  const id = Number(await gov.proposalCount()) + 1;
  await gov.connect(proposer).createProposal(kind, descriptionHash);
  await jump(DELAY + 1);
  const reveals = [];
  for (let i = 0; i < supporters.length; i++) reveals.push(await vote(gov, supporters[i], id, 1, `${tag}${i}`));
  await jump(COMMIT);
  for (const r of reveals) await r();
  await jump(REVEAL + 1);
  expect(await gov.outcome(id)).to.equal(2); // Succeeded
  return id;
}

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
    5000, QUORUM, VEST, MINCOUNT, DELAY, COMMIT, REVEAL, EPOCH, LADDER_C, LADDER_T,
  ]);
  const constitution = await (await ethers.getContractFactory("ConstitutionRegistry")).deploy(
    await gov.getAddress(), LAYER0
  );
  for (const v of voters) {
    await ens.mint(v.address, E(10_000));
    await ens.connect(v).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(v).wrap(E(100));
  }
  await jump(VEST + 1);
  return { ens, vault, gov, constitution, splitter, voters };
}

// climb the tier ladder to T3: 3 epochs, all 5 citizens voting
async function climbToT3(gov, voters) {
  for (let ep = 0; ep < 3; ep++) {
    const id = Number(await gov.proposalCount()) + 1;
    await gov.connect(voters[0]).createProposal(0, ethers.id(`climb${ep}`));
    await jump(DELAY + 1);
    const rs = [];
    for (let i = 0; i < voters.length; i++) rs.push(await vote(gov, voters[i], id, 2, `cl${ep}v${i}`));
    await jump(COMMIT);
    for (const r of rs) await r();
    await jump(EPOCH);
  }
  await closeAll(gov, voters[0]);
  expect(await gov.currentTier()).to.equal(3);
}

const FORFEIT_TEXT =
  "ENSPLUS-FORFEITURES-V1: no access to vaulted principal outside holder-initiated flows; " +
  "no mutation of covenants, splitter percentages, attestation roots, or the constitution; " +
  "no role grants to third parties on member names; no pause, freeze, or gating of unwrap/exit; " +
  "no external calls outside a named adapter; no interaction with positions mid-migration.";
const FORFEIT_HASH = ethers.keccak256(ethers.toUtf8Bytes(FORFEIT_TEXT));

function manifest(id, impl, permissions, articleIds, forfeituresHash = FORFEIT_HASH) {
  return {
    moduleId: id,
    implementation: impl,
    permissions,
    articleIds,
    forfeituresHash,
    fullManifestHash: ethers.id(`manifest:${id}`),
  };
}

describe("ConstitutionRegistry", () => {
  it("inscribes Layer 0 verbatim, immutably, and reads back byte-exact", async () => {
    const { constitution } = await setup();
    expect(await constitution.layer0Count()).to.equal(4);
    expect(await constitution.articleCount()).to.equal(4);
    for (let i = 1; i <= 4; i++) {
      const a = await constitution.article(i);
      expect(a.text).to.equal(LAYER0[i - 1]);
      expect(a.layer0).to.equal(true);
      expect(a.inForce).to.equal(true);
      expect(await constitution.articleInForce(i)).to.equal(true);
    }
    expect(await constitution.articleInForce(0)).to.equal(false);
    expect(await constitution.articleInForce(5)).to.equal(false);
    // no code path can touch layer 0: supersede reverts even with a valid-looking call
    await expect(constitution.supersedeAmendment(1, 1, "coup")).to.be.reverted;
  });

  it("ratifies an amendment only via a Succeeded Constitutional proposal binding the exact text", async () => {
    const { gov, constitution, voters } = await setup();
    await climbToT3(gov, voters);
    const text = "Article V. Fair governance: no holder may dominate; power flows to participants.";
    const payload = ethers.keccak256(ethers.toUtf8Bytes(text));
    const desc = await constitution.expectedDescriptionHash(await constitution.ACTION_AMEND(), payload);
    // a Standard-kind proposal with the right hash is NOT enough (kind floor)
    const low = await passProposal(gov, voters[0], 1, desc, voters, "low");
    await expect(constitution.ratifyAmendment(low, text))
      .to.be.revertedWithCustomError(constitution, "ProposalKindTooLow");
    // the real thing
    const pid = await passProposal(gov, voters[0], 3, desc, voters, "amend");
    // wrong text against the right proposal fails the binding
    await expect(constitution.ratifyAmendment(pid, text + " (edited)"))
      .to.be.revertedWithCustomError(constitution, "PayloadMismatch");
    await expect(constitution.ratifyAmendment(pid, text)).to.emit(constitution, "ArticleInscribed");
    expect(await constitution.articleText(5)).to.equal(text);
    // consumed: cannot execute twice
    await expect(constitution.ratifyAmendment(pid, text))
      .to.be.revertedWithCustomError(constitution, "ProposalAlreadyConsumed");
  });

  it("supersedes amendments (never Layer 0), keeping append-only history", async () => {
    const { gov, constitution, voters } = await setup();
    await climbToT3(gov, voters);
    const v1 = "Article V. Placeholder fair governance.";
    const pid1 = await passProposal(gov, voters[0], 3,
      await constitution.expectedDescriptionHash(await constitution.ACTION_AMEND(), ethers.keccak256(ethers.toUtf8Bytes(v1))),
      voters, "a1");
    await constitution.ratifyAmendment(pid1, v1);
    const v2 = "Article VI(new). Refined fair governance with caps and decay.";
    const payload = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint16", "bytes32"], [5, ethers.keccak256(ethers.toUtf8Bytes(v2))]));
    const pid2 = await passProposal(gov, voters[0], 3,
      await constitution.expectedDescriptionHash(await constitution.ACTION_SUPERSEDE(), payload), voters, "a2");
    await expect(constitution.supersedeAmendment(pid2, 5, v2)).to.emit(constitution, "ArticleSuperseded");
    expect(await constitution.articleInForce(5)).to.equal(false);
    expect(await constitution.articleInForce(6)).to.equal(true);
    const old = await constitution.article(5);
    expect(old.text).to.equal(v1); // history intact
    expect(old.supersededBy).to.equal(6);
  });
});

describe("ModuleRegistry machine checks", () => {
  it("registers a genesis bundle through the full checks; rejects every malformed manifest", async () => {
    const { gov, constitution } = await setup();
    const F = await ethers.getContractFactory("ModuleRegistry");
    const good = await (await ethers.getContractFactory("MockModule")).deploy("renewal-pool");
    const govA = await gov.getAddress(), conA = await constitution.getAddress();
    const gm = (m) => F.deploy(govA, conA, [m]);

    // the good one
    const reg = await F.deploy(govA, conA, [manifest("renewal-pool", await good.getAddress(), 1 | 2 | 4, [2, 3])]);
    expect(await reg.isActive("renewal-pool", 1)).to.equal(true);
    const rec = await reg.moduleVersion("renewal-pool", 1);
    expect(rec.genesis).to.equal(true);
    expect(rec.codeHash).to.not.equal(ethers.ZeroHash);

    // rejections
    await expect(gm(manifest("renewal-pool", await good.getAddress(), 1, [99])))
      .to.be.revertedWithCustomError(F, "ArticleNotInForce");
    await expect(gm(manifest("renewal-pool", await good.getAddress(), 1, [1], ethers.id("wrong"))))
      .to.be.revertedWithCustomError(F, "ForfeituresNotAcknowledged");
    await expect(gm(manifest("renewal-pool", await good.getAddress(), 0, [1])))
      .to.be.revertedWithCustomError(F, "NoPermissions");
    await expect(gm(manifest("renewal-pool", await good.getAddress(), 0x80, [1])))
      .to.be.revertedWithCustomError(F, "UnknownPermissionBits");
    await expect(gm(manifest("renewal-pool", await good.getAddress(), 1, [])))
      .to.be.revertedWithCustomError(F, "NoCitations");
    const bad = await (await ethers.getContractFactory("BadInterfaceModule")).deploy();
    await expect(gm(manifest("bad", await bad.getAddress(), 1, [1])))
      .to.be.revertedWithCustomError(F, "InterfaceCheckFailed"); // the LNR/GRDO lesson, gating
    const misnamed = await (await ethers.getContractFactory("MockModule")).deploy("other-id");
    await expect(gm(manifest("renewal-pool", await misnamed.getAddress(), 1, [1])))
      .to.be.revertedWithCustomError(F, "ModuleIdMismatch");
    const [eoa] = await ethers.getSigners();
    await expect(gm(manifest("renewal-pool", eoa.address, 1, [1])))
      .to.be.revertedWithCustomError(F, "CodeHashMismatch"); // no bytecode at an EOA
  });

  it("proposal-path registration enforces the permission-derived kind floor; retire is append-only", async () => {
    const { gov, constitution, voters } = await setup();
    await climbToT3(gov, voters);
    const reg = await (await ethers.getContractFactory("ModuleRegistry")).deploy(
      await gov.getAddress(), await constitution.getAddress(), []
    );
    const modA = await (await ethers.getContractFactory("MockModule")).deploy("social");
    const mA = manifest("social", await modA.getAddress(), 1, [1]); // P_READ only -> Standard floor
    const payloadA = await reg.registrationPayloadHash(mA);
    const descA = await reg.expectedDescriptionHash(await reg.ACTION_REGISTER(), payloadA);
    // Override-kind proposal (below Standard) must fail the floor
    const lowId = await passProposal(gov, voters[0], 0, descA, voters, "mlow");
    await expect(reg.registerModule(lowId, mA)).to.be.revertedWithCustomError(reg, "ProposalKindTooLow");
    const okId = await passProposal(gov, voters[0], 1, descA, voters, "mok");
    await reg.registerModule(okId, mA);
    expect(await reg.isActive("social", 1)).to.equal(true);
    expect((await reg.moduleVersion("social", 1)).genesis).to.equal(false);

    // P_EXT demands Treasury kind
    const modB = await (await ethers.getContractFactory("MockModule")).deploy("registrar-adapter");
    const mB = manifest("registrar-adapter", await modB.getAddress(), 1 | 64, [4]);
    const descB = await reg.expectedDescriptionHash(await reg.ACTION_REGISTER(), await reg.registrationPayloadHash(mB));
    const stdId = await passProposal(gov, voters[0], 1, descB, voters, "blow");
    await expect(reg.registerModule(stdId, mB)).to.be.revertedWithCustomError(reg, "ProposalKindTooLow");
    const treId = await passProposal(gov, voters[0], 2, descB, voters, "bok");
    await reg.registerModule(treId, mB);

    // version monotonic: registering social v2 via a fresh proposal
    const modA2 = await (await ethers.getContractFactory("MockModule")).deploy("social");
    const mA2 = manifest("social", await modA2.getAddress(), 1, [1]);
    const descA2 = await reg.expectedDescriptionHash(await reg.ACTION_REGISTER(), await reg.registrationPayloadHash(mA2));
    const v2Id = await passProposal(gov, voters[0], 1, descA2, voters, "mv2");
    await reg.registerModule(v2Id, mA2);
    expect(await reg.latestVersion(await reg.moduleKey("social"))).to.equal(2);
    expect(await reg.isActive("social", 1)).to.equal(true); // v1 untouched

    // retire v1 via proposal; record survives as Retired
    const retDesc = await reg.expectedDescriptionHash(await reg.ACTION_RETIRE(),
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string", "uint16"], ["social", 1])));
    const retId = await passProposal(gov, voters[0], 1, retDesc, voters, "ret");
    await expect(reg.retireModule(retId, "social", 1)).to.emit(reg, "ModuleRetired");
    expect(await reg.isActive("social", 1)).to.equal(false);
    expect((await reg.moduleVersion("social", 1)).implementation).to.not.equal(ethers.ZeroAddress);
    await expect(reg.retireModule(retId, "social", 1)).to.be.revertedWithCustomError(reg, "NotActive");
  });
});

describe("StandingOrders pipeline", () => {
  async function soSetup() {
    const base = await setup();
    const { gov, constitution, splitter } = base;
    const so = await (await ethers.getContractFactory("StandingOrders")).deploy(
      [await gov.getAddress(), await constitution.getAddress(), WINDOW, BOND, await splitter.getAddress()],
      [
        { position: 0, articleIds: [3], criteriaHash: ethers.id("SO-3 treasury transfers") }, // AGAINST
        { position: 2, articleIds: [2], criteriaHash: ethers.id("SO-7 operational silence") }, // ABSTAIN
        { position: 1, articleIds: [4], criteriaHash: ethers.id("SO-4 namespace integration") }, // FOR
      ]
    );
    return { ...base, so };
  }

  it("genesis orders inscribed with citations verified; unclassified externals abstain without guessing", async () => {
    const { so } = await soSetup();
    expect(await so.orderCount()).to.equal(3);
    expect((await so.order(1)).position).to.equal(0);
    const [pos, classified] = await so.positionFor(ethers.id("ens-ep-unknown"));
    expect(pos).to.equal(2);
    expect(classified).to.equal(false);
  });

  it("classify -> window -> finalize; conflict rule picks the most protective position", async () => {
    const { so, voters } = await soSetup();
    const ext = ethers.id("ens-ep-6.99-foundation-transfer");
    await so.connect(voters[0]).postClassification(ext, 3); // FOR (namespace)
    await so.connect(voters[1]).postClassification(ext, 1); // AGAINST (treasury)
    await expect(so.finalize(1)).to.be.revertedWithCustomError(so, "WindowStillOpen");
    await jump(WINDOW + 1);
    await so.finalize(1);
    await so.finalize(2);
    const [pos, classified] = await so.positionFor(ext);
    expect(classified).to.equal(true);
    expect(pos).to.equal(0); // AGAINST beats FOR
    // and ABSTAIN beats FOR on a different external
    const ext2 = ethers.id("ens-ep-7.01-budget");
    await so.connect(voters[0]).postClassification(ext2, 3); // FOR
    await so.connect(voters[0]).postClassification(ext2, 2); // ABSTAIN
    await jump(WINDOW + 1);
    await so.finalize(3); await so.finalize(4);
    expect((await so.positionFor(ext2))[0]).to.equal(2);
  });

  it("bonded challenge: succeeded override voids (bond refunded); defeated override finalizes (bond forfeited)", async () => {
    const { so, gov, splitter, voters } = await soSetup();
    const [a, b] = voters;
    const ext = ethers.id("ens-ep-contested");
    await so.connect(a).postClassification(ext, 1); // AGAINST classification, id 1
    // challenger opens an Override proposal bound to classification 1
    const desc = await so.expectedDescriptionHash(await so.ACTION_CHALLENGE(),
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [1])));
    await gov.connect(b).createProposal(0, desc);
    const overrideId = await gov.proposalCount();
    await expect(so.connect(b).challenge(1, overrideId, { value: BOND / 2n }))
      .to.be.revertedWithCustomError(so, "WrongBond");
    // binding is checked: a proposal with the wrong hash is rejected
    await gov.connect(b).createProposal(0, ethers.id("unrelated"));
    await expect(so.connect(b).challenge(1, await gov.proposalCount(), { value: BOND }))
      .to.be.revertedWithCustomError(so, "WrongChallengeBinding");
    await so.connect(b).challenge(1, overrideId, { value: BOND });
    await expect(so.finalize(1)).to.be.revertedWithCustomError(so, "OverrideNotEnded");
    // override succeeds (community agrees the classification was wrong)
    await jump(DELAY + 1);
    const rs = [await vote(gov, a, overrideId, 1, "o1"), await vote(gov, b, overrideId, 1, "o2")];
    await jump(COMMIT); for (const r of rs) await r();
    await jump(REVEAL + 1);
    const balBefore = await ethers.provider.getBalance(b.address);
    await so.connect(a).finalize(1); // a executes; refund goes to challenger b
    expect((await ethers.provider.getBalance(b.address)) - balBefore).to.equal(BOND);
    expect((await so.classification(1)).status).to.equal(4); // Voided
    expect((await so.positionFor(ext))[1]).to.equal(false); // nothing finalized

    // round 2: challenge fails -> classification final, bond to sink
    await so.connect(a).postClassification(ext, 1); // id 2
    const desc2 = await so.expectedDescriptionHash(await so.ACTION_CHALLENGE(),
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [2])));
    await gov.connect(b).createProposal(0, desc2);
    const ov2 = await gov.proposalCount();
    await so.connect(b).challenge(2, ov2, { value: BOND });
    await jump(DELAY + 1);
    const rs2 = [await vote(gov, a, ov2, 0, "x1"), await vote(gov, b, ov2, 1, "x2")]; // tie -> Defeated
    await jump(COMMIT); for (const r of rs2) await r();
    await jump(REVEAL + 1);
    const sinkBefore = await ethers.provider.getBalance(await splitter.getAddress());
    await so.finalize(2);
    expect((await ethers.provider.getBalance(await splitter.getAddress())) - sinkBefore).to.equal(BOND);
    expect((await so.classification(2)).status).to.equal(2); // Final
    expect((await so.positionFor(ext))[0]).to.equal(0); // AGAINST now in force
  });

  it("challenge window closes; late challenges rejected; already-final cannot re-finalize", async () => {
    const { so, gov, voters } = await soSetup();
    await so.connect(voters[0]).postClassification(ethers.id("x"), 2);
    await jump(WINDOW + 1);
    const desc = await so.expectedDescriptionHash(await so.ACTION_CHALLENGE(),
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [1])));
    await gov.connect(voters[1]).createProposal(0, desc);
    await expect(so.connect(voters[1]).challenge(1, await gov.proposalCount(), { value: BOND }))
      .to.be.revertedWithCustomError(so, "WindowClosed");
    await so.finalize(1);
    await expect(so.finalize(1)).to.be.revertedWithCustomError(so, "NotPending");
  });
});
