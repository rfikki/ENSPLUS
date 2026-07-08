const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const DAY = 86400, HOUR = 3600;
const VEST = 30 * DAY;
const DELAY = 100, COMMIT = 1000, REVEAL = 1000;
const EPOCH = 10 * DAY, QUORUM = 100, MINCOUNT = 10n ** 9n;
const LADDER_C = [2, 3, 5], LADDER_T = [500, 1000, 1500];
const K = { None: 0, Transfer: 1, Unwrap: 2 };
const MIN_TL = HOUR;

const lh = (s) => BigInt(ethers.keccak256(ethers.toUtf8Bytes(s)));
const jump = async (s) => { if (s > 0) { await network.provider.send("evm_increaseTime", [s]); await network.provider.send("evm_mine"); } };
const salt = (s) => ethers.id(s);
const nowT = async () => (await ethers.provider.getBlock("latest")).timestamp;
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];

async function vote(gov, v, id, sup, tag) {
  await gov.connect(v).commit(id, await gov.commitmentOf(id, v.address, sup, salt(tag)));
  return () => gov.connect(v).reveal(id, sup, salt(tag));
}
async function runVotes(gov, id, plan, tag) {
  await jump(DELAY + 1);
  const rs = [];
  for (let i = 0; i < plan.length; i++) rs.push(await vote(gov, plan[i][0], id, plan[i][1], `${tag}${i}`));
  await jump(COMMIT);
  for (const r of rs) await r();
  await jump(REVEAL + 1);
}
async function climbT3(gov, voters) {
  for (let ep = 0; ep < 3; ep++) {
    const id = Number(await gov.proposalCount()) + 1;
    await gov.connect(voters[0]).createProposal(0, ethers.id(`c${ep}`));
    await runVotes(gov, id, voters.map((v) => [v, 2]), `c${ep}`);
    await jump(EPOCH - (DELAY + COMMIT + REVEAL + 3));
  }
  while ((await gov.lastClosedEpoch()) < (await gov.currentEpoch())) await gov.connect(voters[0]).closeEpoch(await gov.lastClosedEpoch());
}

describe("SentinelLock — stateful safety invariants (hardening)", function () {
  this.timeout(300000);
  let nameVault, sentinel, registrar, gov, owners, guards, all;

  before(async () => {
    const s = await ethers.getSigners();
    const [deployer, vaultGov, pool] = s;
    const voters = [s[3], s[4], s[5], s[6], s[7]];
    owners = [s[3], s[4], s[5]];
    guards = [s[8], s[9], s[10], s[11]];
    all = [...owners, ...guards];
    const ens = await (await ethers.getContractFactory("MockENS")).deploy();
    const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy([pool.address], [10000]);
    const tokenVault = await (await ethers.getContractFactory("ENSPLUSVault")).deploy(await ens.getAddress(), vaultGov.address, await splitter.getAddress(), 0n, vaultGov.address);
    gov = await (await ethers.getContractFactory("InternalGovernor")).deploy([await tokenVault.getAddress(), ethers.ZeroAddress, 5000, QUORUM, VEST, MINCOUNT, DELAY, COMMIT, REVEAL, EPOCH, LADDER_C, LADDER_T]);
    registrar = await (await ethers.getContractFactory("MockBaseRegistrar")).deploy();
    const wrapper = await (await ethers.getContractFactory("MockNameWrapper")).deploy();
    nameVault = await (await ethers.getContractFactory("NameVault")).deploy(await gov.getAddress(), await registrar.getAddress(), await wrapper.getAddress(), await splitter.getAddress(), 0n);
    sentinel = await (await ethers.getContractFactory("SentinelLock")).deploy(await nameVault.getAddress());
    for (const v of voters) { await ens.mint(v.address, E(10000)); await ens.connect(v).approve(await tokenVault.getAddress(), ethers.MaxUint256); await tokenVault.connect(v).wrap(E(100)); }
    await jump(VEST + 1);
    // install sentinel via Constitutional proposal
    await climbT3(gov, voters);
    const desc = await nameVault.expectedDescriptionHash(await nameVault.ACTION_SET_SENTINEL(), ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address"], [await sentinel.getAddress()])));
    const pid = Number(await gov.proposalCount()) + 1;
    await gov.connect(voters[0]).createProposal(3, desc);
    await runVotes(gov, pid, voters.map((v) => [v, 1]), "sent");
    await nameVault.setSentinel(pid, await sentinel.getAddress());
    expect(await nameVault.sentinel()).to.equal(await sentinel.getAddress());
  });

  it("no armed token ever leaves without a matured, matching, unfrozen release (randomized)", async () => {
    // model
    const guard = new Map(); // owner -> {armed,frozen,timelock,guardians:Set,threshold,disarmReadyAt}
    const rel = new Map();   // tokenId -> {kind,to,readyAt,approvals:Set} | undefined
    const ownerOf = new Map(); // tokenId -> owner address (undefined once unwrapped)
    let tick = 0;

    async function wrap(owner, label) {
      const id = lh(label);
      await registrar.register(id, owner.address);
      await registrar.connect(owner).approve(await nameVault.getAddress(), id);
      await nameVault.connect(owner).wrapName(id, { value: 0 });
      ownerOf.set(id.toString(), owner.address);
      return id;
    }
    const tokens = [];
    for (let i = 0; i < 5; i++) tokens.push(await wrap(pick(owners), `sn${i}`));
    // pre-arm every owner so transfer/unwrap attempts reliably exercise armed paths
    for (const o of owners) {
      const gset = [pick(guards), pick(guards)].filter((x, i, a) => a.indexOf(x) === i && x.address !== o.address);
      const thr = 1 + rnd(gset.length);
      const tl = MIN_TL + rnd(4) * DAY;
      await sentinel.connect(o).arm(tl, gset.map((x) => x.address), thr);
      guard.set(o.address, { armed: true, frozen: false, timelock: tl, guardians: new Set(gset.map((x) => x.address)), threshold: thr, disarmReadyAt: 0 });
    }
    let armedAttempts = 0;

    const G = (a) => guard.get(a);
    const isG = (owner, who) => { const g = G(owner); return g && g.armed && g.guardians.has(who); };
    const curOwnerSigner = (id) => all.find((s) => s.address === ownerOf.get(id.toString()));

    const OPS = 160;
    for (let step = 0; step < OPS; step++) {
      const op = rnd(3) === 0 ? 8 : rnd(8); // ~1/3 attempts -> reliable armed-exit coverage
      try {
        if (op === 0) { // arm
          const o = pick(owners);
          if (G(o.address)?.armed) continue;
          const tl = MIN_TL + rnd(5) * DAY;
          const gset = [...new Set([pick(guards), pick(guards)])].filter((x) => x.address !== o.address);
          const thr = rnd(gset.length + 1);
          await sentinel.connect(o).arm(tl, gset.map((x) => x.address), thr);
          guard.set(o.address, { armed: true, frozen: false, timelock: tl, guardians: new Set(gset.map((x) => x.address)), threshold: thr, disarmReadyAt: 0 });
        } else if (op === 1) { // requestRelease
          const id = pick(tokens); const own = ownerOf.get(id.toString()); if (!own) continue;
          const g = G(own); if (!g?.armed || g.frozen) continue;
          const os = curOwnerSigner(id);
          const kind = pick([K.Transfer, K.Unwrap]);
          const to = kind === K.Transfer ? pick(all).address : ethers.ZeroAddress;
          if (kind === K.Transfer && to === ethers.ZeroAddress) continue;
          await sentinel.connect(os).requestRelease(id, kind, to);
          const t = await nowT();
          rel.set(id.toString(), { kind, to: kind === K.Transfer ? to : ethers.ZeroAddress, readyAt: t + g.timelock, approvals: new Set() });
        } else if (op === 2) { // approveRelease (guardian fast-track)
          const id = pick(tokens); const own = ownerOf.get(id.toString()); if (!own) continue;
          const r = rel.get(id.toString()); const g = G(own); if (!r || !g?.armed) continue;
          const gu = pick([...g.guardians].map((a) => all.find((s) => s.address === a)).filter(Boolean));
          if (!gu || r.approvals.has(gu.address)) continue;
          await sentinel.connect(gu).approveRelease(id);
          r.approvals.add(gu.address);
          if (g.threshold !== 0 && r.approvals.size >= g.threshold) r.readyAt = await nowT();
        } else if (op === 3) { // cancelRelease
          const id = pick(tokens); const own = ownerOf.get(id.toString()); if (!own) continue;
          const r = rel.get(id.toString()); if (!r) continue;
          const os = curOwnerSigner(id);
          await sentinel.connect(os).cancelRelease(id);
          rel.delete(id.toString());
        } else if (op === 4) { // panicFreeze
          const o = pick(owners); const g = G(o.address); if (!g?.armed) continue;
          await sentinel.connect(o).panicFreeze(o.address);
          g.frozen = true;
        } else if (op === 5) { // unfreeze (owner if threshold 0, else guardians)
          const o = pick(owners); const g = G(o.address); if (!g?.armed || !g.frozen) continue;
          if (g.threshold === 0) { await sentinel.connect(o).ownerUnfreeze(); g.frozen = false; }
          else {
            const gsigs = [...g.guardians].map((a) => all.find((s) => s.address === a)).filter(Boolean);
            const approvers = new Set();
            for (const gu of gsigs) { if (approvers.size >= g.threshold) break; await sentinel.connect(gu).approveUnfreeze(o.address); approvers.add(gu.address); }
            if (approvers.size >= g.threshold && g.threshold !== 0) g.frozen = false;
          }
        } else if (op === 6) { // requestDisarm
          const o = pick(owners); const g = G(o.address); if (!g?.armed) continue;
          await sentinel.connect(o).requestDisarm();
          g.disarmReadyAt = (await nowT()) + g.timelock;
        } else if (op === 7) { // maybe mature + executeDisarm
          const o = pick(owners); const g = G(o.address); if (!g?.armed || g.disarmReadyAt === 0) continue;
          if (g.frozen) continue;
          if (rnd(2)) { const t = await nowT(); if (t < g.disarmReadyAt) await jump(g.disarmReadyAt - t + 5); }
          const t = await nowT();
          if (t >= g.disarmReadyAt) { await sentinel.connect(o).executeDisarm(); guard.delete(o.address); for (const [k, v] of rel) if (ownerOf.get(k) === o.address) {} }
        } else if (op === 8) { // ATTEMPT transfer or unwrap — the invariant assertion
          const id = pick(tokens); const own = ownerOf.get(id.toString()); if (!own) continue;
          const os = curOwnerSigner(id); const g = G(own); const r = rel.get(id.toString());
          if (g && g.armed) armedAttempts++;
          const doUnwrap = rnd(2) === 0;
          // optionally mature the pending release
          if (r && rnd(2)) { const t = await nowT(); if (t < r.readyAt) await jump(r.readyAt - t + 5); }
          const t = await nowT();
          const matured = r && t >= r.readyAt;
          let predictOk;
          if (!g || !g.armed) predictOk = true; // unarmed: never gated
          else if (g.frozen) predictOk = false;
          else if (doUnwrap) predictOk = !!(r && r.kind === K.Unwrap && matured);
          else predictOk = !!(r && r.kind === K.Transfer && matured); // to must match; pick r.to
          if (doUnwrap) {
            if (predictOk) { await nameVault.connect(os).unwrap(id); ownerOf.delete(id.toString()); rel.delete(id.toString()); }
            else { await expect(nameVault.connect(os).unwrap(id)).to.be.reverted; }
          } else {
            const to = (g && g.armed && r && r.kind === K.Transfer) ? r.to : pick(all).address;
            const ok = (!g || !g.armed) ? true : (!g.frozen && r && r.kind === K.Transfer && r.to === to && matured);
            if (ok) {
              await nameVault.connect(os).transferFrom(os.address, to, id);
              ownerOf.set(id.toString(), to); rel.delete(id.toString());
            } else {
              await expect(nameVault.connect(os).transferFrom(os.address, to, id)).to.be.reverted;
            }
          }
        }
      } catch (e) {
        // a modelled op reverted unexpectedly -> surface it (invariant/model mismatch)
        throw new Error(`op ${op} @step ${step} unexpected revert: ${e.message.split("\n")[0]}`);
      }
    }
    expect(armedAttempts).to.be.greaterThan(12); // meaningful coverage of the armed exit path
  });

  it("explicit: frozen blocks a fully-matured release until guardian-threshold unfreeze", async () => {
    const [o, , , , , , , , g1, g2] = await ethers.getSigners();
    const id = lh("frozentest");
    await registrar.register(id, o.address);
    await registrar.connect(o).approve(await nameVault.getAddress(), id);
    await nameVault.connect(o).wrapName(id, { value: 0 });
    if (!(await sentinel.guardOf(o.address)).armed) await sentinel.connect(o).arm(HOUR, [g1.address, g2.address], 2);
    await sentinel.connect(o).requestRelease(id, K.Unwrap, ethers.ZeroAddress);
    await jump(HOUR + 5); // matured
    await sentinel.connect(g1).panicFreeze(o.address);
    await expect(nameVault.connect(o).unwrap(id)).to.be.revertedWithCustomError(sentinel, "Frozen");
    await expect(sentinel.connect(o).ownerUnfreeze()).to.be.revertedWithCustomError(sentinel, "NotGuardian");
    await sentinel.connect(g1).approveUnfreeze(o.address);
    await sentinel.connect(g2).approveUnfreeze(o.address);
    await nameVault.connect(o).unwrap(id); // now released
    expect(await registrar.ownerOf(id)).to.equal(o.address);
  });
});
