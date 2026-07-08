const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const DAY = 86400;
const L = { Calm: 0, Notice: 1, Warning: 2, Critical: 3, Expired: 4 };
const lh = (s) => BigInt(ethers.keccak256(ethers.toUtf8Bytes(s)));
const jump = async (s) => { if (s > 0) { await network.provider.send("evm_increaseTime", [s]); await network.provider.send("evm_mine"); } };
const nowT = async () => (await ethers.provider.getBlock("latest")).timestamp;
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];

// JS reference for the escalation ladder (must mirror Watchtower.levelFor)
function jsLevel(expiry, now) {
  if (now >= expiry) return L.Expired;
  const rem = expiry - now;
  if (rem <= 7 * DAY) return L.Critical;
  if (rem <= 30 * DAY) return L.Warning;
  if (rem <= 90 * DAY) return L.Notice;
  return L.Calm;
}

async function setup() {
  const [deployer, vaultGov, a, b, c, pool] = await ethers.getSigners();
  const registrar = await (await ethers.getContractFactory("MockExpiryRegistrar")).deploy();
  const wrapper = await (await ethers.getContractFactory("MockNameWrapper")).deploy();
  const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy([pool.address], [10000]);
  const nameVault = await (await ethers.getContractFactory("NameVault")).deploy(
    vaultGov.address, await registrar.getAddress(), await wrapper.getAddress(), await splitter.getAddress(), 0n);
  const watchtower = await (await ethers.getContractFactory("Watchtower")).deploy(
    await nameVault.getAddress(), await registrar.getAddress(), await wrapper.getAddress());
  return { registrar, nameVault, watchtower, owners: [a, b, c] };
}

describe("Watchtower — property tests (hardening)", function () {
  this.timeout(300000);

  it("levelFor is a correct, monotonic step function over random (expiry, now)", async () => {
    const { watchtower } = await setup();
    for (let i = 0; i < 300; i++) {
      const base = 1_600_000_000 + rnd(400_000_000);
      const expiry = BigInt(base);
      // random now around expiry (both sides)
      const now = BigInt(base - 120 * DAY + rnd(240 * DAY));
      expect(await watchtower.levelFor(expiry, now)).to.equal(jsLevel(Number(expiry), Number(now)));
      // monotonicity: later `now` never de-escalates
      const later = now + BigInt(rnd(60 * DAY));
      const lv1 = Number(await watchtower.levelFor(expiry, now));
      const lv2 = Number(await watchtower.levelFor(expiry, later));
      expect(lv2).to.be.greaterThanOrEqual(lv1);
    }
  });

  it("stateful: watchedCount tracks active watches; lastLevel matches; lapsedAt set-once; Escalated only worsens", async () => {
    const { registrar, nameVault, watchtower, owners } = await setup();
    const model = new Map(); // id -> {watched, live, lastLevel, lapsedAt, owner}
    const ids = [];
    async function wrap(owner, label, offset) {
      const id = lh(label);
      await registrar.register(id, owner.address);
      await registrar.setExpiry(id, (await nowT()) + offset);
      await registrar.connect(owner).approve(await nameVault.getAddress(), id);
      await nameVault.connect(owner).wrapName(id, { value: 0 });
      model.set(id.toString(), { watched: false, live: true, lastLevel: 0, lapsedAt: 0, owner: owner.address });
      ids.push(id);
      return id;
    }
    for (let i = 0; i < 5; i++) await wrap(pick(owners), `wt${i}`, (i + 1) * 40 * DAY);

    const expiryOf = async (id) => Number(await registrar.nameExpires(id));
    const activeCount = () => [...model.values()].filter((m) => m.watched).length;

    for (let step = 0; step < 160; step++) {
      const op = rnd(6);
      const id = pick(ids); const m = model.get(id.toString());
      const os = owners.find((o) => o.address === m.owner);
      if (op === 0 && m.live && !m.watched) { // watch
        await watchtower.connect(os).watch(id);
        const info0 = await watchtower.watchInfo(id);
        m.watched = true; m.lastLevel = Number(info0.lastLevel); m.lapsedAt = Number(info0.lapsedAt);
      } else if (op === 1 && m.watched && m.live) { // unwatch (live only; dead positions auto-close via checkpoint)
        await watchtower.connect(os).unwatch(id);
        m.watched = false;
      } else if (op === 2 && m.live) { // change expiry (renew or lapse)
        const cur = await nowT();
        const off = rnd(2) ? cur + (10 + rnd(200)) * DAY : cur - rnd(30) * DAY;
        await registrar.setExpiry(id, off);
      } else if (op === 3) { // time jump
        await jump((1 + rnd(60)) * DAY);
      } else if (op === 4 && m.live && rnd(3) === 0) { // unwrap (kills position)
        await nameVault.connect(os).unwrap(id);
        m.live = false;
      } else if (op === 5 && m.watched) { // checkpoint — the assertions
        if (!m.live) {
          await expect(watchtower.checkpoint(id)).to.emit(watchtower, "WatchClosed");
          m.watched = false;
        } else {
          const lv = jsLevel(await expiryOf(id), (await nowT()) + 1); // tx mines next block
          const prior = m.lastLevel;
          const tx = await watchtower.checkpoint(id);
          const rc = await tx.wait();
          const t = await nowT();
          const actualLv = jsLevel(await expiryOf(id), t);
          const info = await watchtower.watchInfo(id);
          expect(Number(info.lastLevel)).to.equal(actualLv); // recorded level == truth
          const escalated = rc.logs.some((x) => x.fragment && x.fragment.name === "Escalated");
          expect(escalated).to.equal(actualLv > prior); // Escalated iff worsened
          if (actualLv === L.Expired && m.lapsedAt === 0) {
            expect(Number(info.lapsedAt)).to.be.greaterThan(0); // lapse anchored
            m.lapsedAt = Number(info.lapsedAt);
          } else if (m.lapsedAt !== 0) {
            expect(Number(info.lapsedAt)).to.equal(m.lapsedAt); // never moves once set
          }
          m.lastLevel = actualLv;
        }
      }
      expect(await watchtower.watchedCount()).to.equal(BigInt(activeCount())); // invariant every step
    }
  });
});
