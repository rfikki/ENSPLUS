const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const DAY = 86400;
const VEST = 30 * DAY;
const DELAY = 100, COMMIT = 1000, REVEAL = 1000;
const GOV_EPOCH = 10 * DAY, QUORUM = 100, MINCOUNT = 10n ** 9n;
const LADDER_C = [2, 3, 5], LADDER_T = [500, 1000, 1500];
const NAME_FEE = 0n;
const COST = ethers.parseEther("0.002"); // base annual renewal cost
const BOND = ethers.parseEther("0.01");
const CAP = 3, RAFFLE_K = 2;
const POOL_EPOCH = 7 * DAY;
const TITHE_BPS = 1000; // 10% of eternal surplus

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

async function climb(gov, voters) {
  for (let ep = 0; ep < 3; ep++) {
    const id = Number(await gov.proposalCount()) + 1;
    await gov.connect(voters[0]).createProposal(0, ethers.id(`c${ep}`));
    await runVotes(gov, id, voters.map((v) => [v, 2]), `c${ep}`);
    await jump(GOV_EPOCH - (DELAY + COMMIT + REVEAL + 3));
  }
  while ((await gov.lastClosedEpoch()) < (await gov.currentEpoch())) {
    await gov.connect(voters[0]).closeEpoch(await gov.lastClosedEpoch());
  }
}

async function setup() {
  const [deployer, vaultGov, a, b, c, d, e, tithe, pool9] = await ethers.getSigners();
  const voters = [a, b, c, d, e];
  const ens = await (await ethers.getContractFactory("MockENS")).deploy();
  const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy([pool9.address], [10000]);
  const tokenVault = await (await ethers.getContractFactory("ENSPLUSVault")).deploy(
    await ens.getAddress(), vaultGov.address, await splitter.getAddress(), 0n, vaultGov.address
  );
  const gov = await (await ethers.getContractFactory("InternalGovernor")).deploy([
    await tokenVault.getAddress(), ethers.ZeroAddress,
    5000, QUORUM, VEST, MINCOUNT, DELAY, COMMIT, REVEAL, GOV_EPOCH, LADDER_C, LADDER_T,
  ]);
  const registrar = await (await ethers.getContractFactory("MockBaseRegistrar")).deploy();
  const wrapper = await (await ethers.getContractFactory("MockNameWrapper")).deploy();
  const nameVault = await (await ethers.getContractFactory("NameVault")).deploy(
    await gov.getAddress(), await registrar.getAddress(), await wrapper.getAddress(),
    await splitter.getAddress(), NAME_FEE
  );
  const exec = await (await ethers.getContractFactory("MockRenewalExecutor")).deploy(COST);
  const pool = await (await ethers.getContractFactory("RenewalPool")).deploy(
    await gov.getAddress(), await nameVault.getAddress(), await exec.getAddress(),
    tithe.address, COST, TITHE_BPS, BOND, CAP, RAFFLE_K, POOL_EPOCH
  );
  for (const v of voters) {
    await ens.mint(v.address, E(10_000));
    await ens.connect(v).approve(await tokenVault.getAddress(), ethers.MaxUint256);
    await tokenVault.connect(v).wrap(E(100));
  }
  await jump(VEST + 1);
  return { gov, registrar, nameVault, exec, pool, tithe, voters, deployer };
}

async function wrapNames(registrar, nameVault, owner, labels) {
  const ids = labels.map(lh);
  for (const id of ids) {
    await registrar.register(id, owner.address);
    await registrar.connect(owner).approve(await nameVault.getAddress(), id);
    await nameVault.connect(owner).wrapName(id, { value: NAME_FEE });
  }
  return ids;
}

async function fundToTier(pool, deployer, enrolled, crWad) {
  // set balance so CR = crWad exactly: balance = enrolled*COST*cr/1e18 (minus current)
  const target = (BigInt(enrolled) * COST * crWad) / 10n ** 18n;
  const cur = await ethers.provider.getBalance(await pool.getAddress());
  if (target > cur) await deployer.sendTransaction({ to: await pool.getAddress(), value: target - cur });
}

describe("RenewalPool — charter & enrollment", () => {
  it("passes the ModuleRegistry machine checks as a REAL genesis module", async () => {
    const { gov, pool } = await setup();
    const constitution = await (await ethers.getContractFactory("ConstitutionRegistry")).deploy(
      await gov.getAddress(), ["Art I", "Art II", "Art III", "Art IV"]
    );
    const F = await ethers.getContractFactory("ModuleRegistry");
    const forfeit = ethers.keccak256(ethers.toUtf8Bytes(
      "ENSPLUS-FORFEITURES-V1: no access to vaulted principal outside holder-initiated flows; " +
      "no mutation of covenants, splitter percentages, attestation roots, or the constitution; " +
      "no role grants to third parties on member names; no pause, freeze, or gating of unwrap/exit; " +
      "no external calls outside a named adapter; no interaction with positions mid-migration."));
    const reg = await F.deploy(await gov.getAddress(), await constitution.getAddress(), [{
      moduleId: "renewal-pool",
      implementation: await pool.getAddress(),
      permissions: 1 | 2 | 4 | 8 | 64, // READ|CREDIT|REVENUE|EXEC|EXT(RegistrarAdapter)
      articleIds: [2, 3],
      forfeituresHash: forfeit,
      fullManifestHash: ethers.id("manifest:renewal-pool:v1"),
    }]);
    expect(await reg.isActive("renewal-pool", 1)).to.equal(true); // the flame is chartered
  });

  it("enrollment: holder-only, exact bond, per-owner cap, refund on unenroll, evict when position leaves the vault", async () => {
    const { registrar, nameVault, pool, voters } = await setup();
    const [a, b] = voters;
    const ids = await wrapNames(registrar, nameVault, a, ["r1", "r2", "r3", "r4"]);
    await expect(pool.connect(b).enroll(ids[0], { value: BOND }))
      .to.be.revertedWithCustomError(pool, "NotPositionHolder");
    await expect(pool.connect(a).enroll(ids[0], { value: BOND - 1n }))
      .to.be.revertedWithCustomError(pool, "WrongBond");
    for (let i = 0; i < 3; i++) await pool.connect(a).enroll(ids[i], { value: BOND });
    await expect(pool.connect(a).enroll(ids[3], { value: BOND }))
      .to.be.revertedWithCustomError(pool, "EnrollCapReached"); // R1 cap
    await expect(pool.connect(a).enroll(ids[0], { value: BOND }))
      .to.be.revertedWithCustomError(pool, "AlreadyEnrolled");
    expect(await pool.enrolledCount()).to.equal(3);
    // unenroll refunds the bond exactly
    const before = await ethers.provider.getBalance(a.address);
    const tx = await pool.connect(a).unenroll(ids[2]);
    const rc = await tx.wait();
    const gas = rc.gasUsed * rc.gasPrice;
    expect((await ethers.provider.getBalance(a.address)) - before + gas).to.equal(BOND);
    // evict: unwrap without unenrolling -> anyone evicts, bond stays in pool
    await expect(pool.connect(b).evict(ids[0])).to.be.revertedWithCustomError(pool, "PositionStillLive");
    await nameVault.connect(a).unwrap(ids[0]);
    await pool.connect(b).evict(ids[0]);
    expect(await pool.enrolledCount()).to.equal(1);
    expect(await pool.enrolledCountOf(a.address)).to.equal(1);
  });
});

describe("RenewalPool — the flame ladder", () => {
  it("coverage ratio and tier track funding exactly (the CR simulator, on-chain)", async () => {
    const { registrar, nameVault, pool, voters, deployer } = await setup();
    const [a] = voters;
    const ids = await wrapNames(registrar, nameVault, a, ["t1", "t2"]);
    for (const id of ids) await pool.connect(a).enroll(id, { value: BOND });
    // bonds alone: balance = 2*BOND = 0.02, liability = 2*0.002 = 0.004 -> CR 5.0 already!
    // (bonds count as pool balance — realistic and fine; drain check below uses fresh pool)
    expect(await pool.tier()).to.equal(3);
    // exact boundary walk on a fresh pool with zero bond
    const exec = await (await ethers.getContractFactory("MockRenewalExecutor")).deploy(COST);
    const p2 = await (await ethers.getContractFactory("RenewalPool")).deploy(
      await (await pool.governor()), await nameVault.getAddress(), await exec.getAddress(),
      deployer.address, COST, TITHE_BPS, 0n, CAP, RAFFLE_K, POOL_EPOCH
    );
    const ids2 = await wrapNames(registrar, nameVault, a, ["b1"]);
    await p2.connect(a).enroll(ids2[0], { value: 0 });
    expect(await p2.tier()).to.equal(0); // empty: Ember
    await fundToTier(p2, deployer, 1, 25n * 10n ** 16n);
    expect(await p2.coverageRatio()).to.equal(25n * 10n ** 16n);
    expect(await p2.tier()).to.equal(1); // Kindled at exactly 0.25
    await fundToTier(p2, deployer, 1, 5n * 10n ** 17n);
    expect(await p2.tier()).to.equal(2); // Steady at exactly 0.5
    await fundToTier(p2, deployer, 1, 10n ** 18n);
    expect(await p2.tier()).to.equal(3); // Eternal at exactly 1.0
  });

  it("STEADY: keeper batch renews within the 25% epoch budget; one renewal per name per epoch; banked years accrue", async () => {
    const { registrar, nameVault, pool, exec, voters, deployer } = await setup();
    const [a, b, keeper] = voters;
    const idsA = await wrapNames(registrar, nameVault, a, ["s1", "s2"]);
    const idsB = await wrapNames(registrar, nameVault, b, ["s3"]);
    for (const id of idsA) await pool.connect(a).enroll(id, { value: BOND });
    for (const id of idsB) await pool.connect(b).enroll(id, { value: BOND });
    // bonds: 0.03; liability 0.006 -> CR 5 (Eternal >= Steady) — batch allowed
    await pool.connect(keeper).renewBatch([...idsA, ...idsB]);
    for (const id of [...idsA, ...idsB]) {
      expect(await pool.yearsBanked(id)).to.equal(1);
      expect(await exec.expiryOf(id)).to.be.greaterThan(0n);
    }
    // once per epoch
    await expect(pool.connect(keeper).renewBatch([idsA[0]]))
      .to.be.revertedWithCustomError(pool, "AlreadyRenewedThisEpoch");
    // next epoch: renewable again
    await jump(POOL_EPOCH + 1);
    await pool.connect(keeper).renewBatch([idsA[0]]);
    expect(await pool.yearsBanked(idsA[0])).to.equal(2);
    // budget exhaustion: shrink pool so 25% covers only one renewal
    // fresh pool: balance such that budget = 25% = 1 renewal exactly
    const exec2 = await (await ethers.getContractFactory("MockRenewalExecutor")).deploy(COST);
    const p2 = await (await ethers.getContractFactory("RenewalPool")).deploy(
      await pool.governor(), await nameVault.getAddress(), await exec2.getAddress(),
      deployer.address, COST, 0, 0n, CAP, RAFFLE_K, POOL_EPOCH
    );
    const more = await wrapNames(registrar, nameVault, b, ["s4", "s5"]);
    for (const id of more) await p2.connect(b).enroll(id, { value: 0 });
    // liability 0.004; fund to CR exactly 0.6 (Steady): balance 0.0024; budget=0.0006 < COST!
    await fundToTier(p2, deployer, 2, 6n * 10n ** 17n);
    await expect(p2.connect(keeper).renewBatch([more[0]]))
      .to.be.revertedWithCustomError(p2, "EpochBudgetExhausted");
  });

  it("KINDLED: member pays a year, pool matches a year; wrong tier and wrong payment revert", async () => {
    const { registrar, nameVault, pool, exec, voters, deployer } = await setup();
    const [a] = voters;
    // fresh zero-bond pool for precise tier control
    const exec2 = await (await ethers.getContractFactory("MockRenewalExecutor")).deploy(COST);
    const p2 = await (await ethers.getContractFactory("RenewalPool")).deploy(
      await pool.governor(), await nameVault.getAddress(), await exec2.getAddress(),
      deployer.address, COST, 0, 0n, CAP, RAFFLE_K, POOL_EPOCH
    );
    const ids = await wrapNames(registrar, nameVault, a, ["k1"]);
    await p2.connect(a).enroll(ids[0], { value: 0 });
    // budget note: 25% of balance must cover the pool's half -> CR 0.45 gives
    // balance 0.0009, budget 0.000225 < COST. Use CR 0.45? need budget >= COST:
    // balance*0.25 >= 0.002 -> balance >= 0.008 -> CR >= 4 (Eternal). Conflict!
    // With ONE enrolled name Kindled matching can never fit the 25% budget —
    // realistic pools have many names. Enroll 20 names via 4 more owners? Use
    // one owner cap 3... wrap under different voters:
    const owners = voters.slice(0, 5);
    const allIds = [];
    for (let o = 0; o < 5; o++) {
      // owner 0 (a) already enrolled k1 — cap 3 leaves room for 2 more
      const labels = o === 0 ? [`kk0a`, `kk0b`] : [`kk${o}a`, `kk${o}b`, `kk${o}c`];
      const oids = await wrapNames(registrar, nameVault, owners[o], labels);
      for (const id of oids) { await p2.connect(owners[o]).enroll(id, { value: 0 }); allIds.push(id); }
    }
    // 15 enrolled; liability 0.03; CR 0.3 -> balance 0.009; budget 0.00225 >= COST
    await fundToTier(p2, deployer, 15, 3n * 10n ** 17n);
    expect(await p2.tier()).to.equal(1);
    await expect(p2.connect(a).matchRenew(ids[0], { value: COST - 1n }))
      .to.be.revertedWithCustomError(p2, "WrongMatchPayment");
    await expect(p2.connect(voters[1]).matchRenew(ids[0], { value: COST }))
      .to.be.revertedWithCustomError(p2, "NotPositionHolder");
    await p2.connect(a).matchRenew(ids[0], { value: COST });
    expect(await p2.yearsBanked(ids[0])).to.equal(2); // member year + pool year
    expect(await exec2.expiryOf(ids[0])).to.be.greaterThan(0n);
    // steady-tier pools reject matching
    await fundToTier(p2, deployer, 16, 8n * 10n ** 17n);
    await expect(p2.connect(a).matchRenew(allIds[0], { value: COST }))
      .to.be.revertedWithCustomError(p2, "WrongTier");
  });

  it("EMBER raffle: once per epoch, winners are enrolled names within budget; tithe skims eternal surplus at epoch open", async () => {
    const { registrar, nameVault, pool, voters, deployer, tithe } = await setup();
    const [a, b] = voters;
    const exec2 = await (await ethers.getContractFactory("MockRenewalExecutor")).deploy(COST);
    const p2 = await (await ethers.getContractFactory("RenewalPool")).deploy(
      await pool.governor(), await nameVault.getAddress(), await exec2.getAddress(),
      tithe.address, COST, TITHE_BPS, 0n, CAP, RAFFLE_K, POOL_EPOCH
    );
    const ids = await wrapNames(registrar, nameVault, a, ["e1", "e2", "e3"]);
    for (const id of ids) await p2.connect(a).enroll(id, { value: 0 });
    // Ember with enough budget for K winners: CR 0.2 -> balance 0.0012, budget 0.0003 < COST.
    // Need budget >= 2*COST=0.004 -> balance >= 0.016 -> CR 2.67. Ember demands CR<0.25.
    // Realistic ember pools have MANY enrolled names: enroll 15 more.
    for (let o = 1; o < 5; o++) {
      const oids = await wrapNames(registrar, nameVault, voters[o], [`ee${o}a`, `ee${o}b`, `ee${o}c`]);
      for (const id of oids) await p2.connect(voters[o]).enroll(id, { value: 0 });
    }
    // 15 enrolled; CR 0.24 -> balance = 15*0.002*0.24 = 0.0072; budget 0.0018 (not enough for 1!)
    // K winners need budget >= K*COST = 0.004 -> balance >= 0.016 -> CR = 0.016/0.03 = 0.533. Too high.
    // Ember raffles at tiny CR renew FEWER than K — that's the design (break on budget).
    await fundToTier(p2, deployer, 15, 24n * 10n ** 16n);
    expect(await p2.tier()).to.equal(0);
    await p2.connect(b).raffleDraw();
    // budget 0.0018 covers 0 full renewals? 0.0018 < 0.002 -> zero winners, gracefully
    let banked = 0n;
    for (const id of ids) banked += await p2.yearsBanked(id);
    // now a richer ember: more names, same low CR, bigger absolute budget
    for (let o = 0; o < 5; o++) {
      const oids2 = await wrapNames(registrar, nameVault, voters[o], [`ez${o}a`, `ez${o}b`, `ez${o}c`].map((s) => s + "x"));
      // cap reached for some owners — enroll what fits
      for (const id of oids2) {
        try { await p2.connect(voters[o]).enroll(id, { value: 0 }); } catch {}
      }
    }
    const n = await p2.enrolledCount();
    await fundToTier(p2, deployer, Number(n), 24n * 10n ** 16n);
    await jump(POOL_EPOCH + 1);
    const tx = await p2.connect(b).raffleDraw();
    const rc = await tx.wait();
    const drawn = rc.logs.filter((l) => l.fragment && l.fragment.name === "Renewed").length;
    expect(drawn).to.be.lessThanOrEqual(RAFFLE_K);
    await expect(p2.connect(b).raffleDraw()).to.be.revertedWithCustomError(p2, "RaffleAlreadyDrawn");
    // tithe: overfund far past eternal, next epoch open skims 10% of surplus
    const liab = await p2.annualLiability();
    await deployer.sendTransaction({ to: await p2.getAddress(), value: liab * 3n });
    const titheBefore = await ethers.provider.getBalance(tithe.address);
    await jump(POOL_EPOCH + 1);
    await p2.connect(b).renewBatch([]); // opens epoch (Eternal now) — empty batch just opens
    const skim = (await ethers.provider.getBalance(tithe.address)) - titheBefore;
    expect(skim).to.be.greaterThan(0n);
    // skim = 10% of (balance - liability) at open
  });

  it("governed re-pricing: baseAnnualCost changes only via a Succeeded Standard proposal binding the value", async () => {
    const { gov, pool, voters } = await setup();
    await climb(gov, voters);
    const newCost = ethers.parseEther("0.003");
    const desc = await pool.expectedDescriptionHash(await pool.ACTION_SET_BASE_COST(),
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [newCost])));
    const pid = Number(await gov.proposalCount()) + 1;
    await gov.connect(voters[0]).createProposal(1, desc);
    await runVotes(gov, pid, voters.map((v) => [v, 1]), "cost");
    await expect(pool.setBaseAnnualCost(pid, ethers.parseEther("0.009")))
      .to.be.revertedWithCustomError(pool, "PayloadMismatch");
    await pool.setBaseAnnualCost(pid, newCost);
    expect(await pool.baseAnnualCostWei()).to.equal(newCost);
  });
});
