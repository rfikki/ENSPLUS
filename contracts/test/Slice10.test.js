const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const DAY = 86400;
const lh = (s) => BigInt(ethers.keccak256(ethers.toUtf8Bytes(s)));
const jump = async (s) => { await network.provider.send("evm_increaseTime", [s]); await network.provider.send("evm_mine"); };
const now = async () => (await ethers.provider.getBlock("latest")).timestamp;

const L = { Calm: 0, Notice: 1, Warning: 2, Critical: 3, Expired: 4 };
const ALARM = { ResolverChanged: 0, OwnerChanged: 1, TransferObserved: 2, Confusable: 3, Other: 4 };
const CUSTODY_U721 = 1, CUSTODY_W1155 = 2;

async function setup() {
  const [deployer, vaultGov, a, b, keeper, pool] = await ethers.getSigners();
  const gov = vaultGov; // NameVault only needs a governor address for the migration/sentinel slots
  const registrar = await (await ethers.getContractFactory("MockExpiryRegistrar")).deploy();
  const wrapper = await (await ethers.getContractFactory("MockNameWrapper")).deploy();
  const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy([pool.address], [10000]);
  // a lightweight governor stand-in isn't needed; NameVault only calls governor
  // for slot fills, which slice 10 never exercises. Use a dummy nonzero address.
  const nameVault = await (await ethers.getContractFactory("NameVault")).deploy(
    gov.address, await registrar.getAddress(), await wrapper.getAddress(),
    await splitter.getAddress(), 0n
  );
  const watchtower = await (await ethers.getContractFactory("Watchtower")).deploy(
    await nameVault.getAddress(), await registrar.getAddress(), await wrapper.getAddress()
  );
  return { registrar, wrapper, nameVault, watchtower, a, b, keeper };
}

async function wrapU721(registrar, nameVault, owner, label, expiryOffset) {
  const id = lh(label);
  await registrar.register(id, owner.address);
  await registrar.setExpiry(id, (await now()) + expiryOffset);
  await registrar.connect(owner).approve(await nameVault.getAddress(), id);
  await nameVault.connect(owner).wrapName(id, { value: 0 });
  return id;
}

describe("Watchtower — escalation ladder (pure)", () => {
  it("levelFor maps time-to-expiry to levels at exact boundaries", async () => {
    const { watchtower } = await setup();
    const t = 1_000_000_000n;
    const at = (offset) => watchtower.levelFor(t + BigInt(offset), t);
    expect(await at(200 * DAY)).to.equal(L.Calm);
    expect(await at(90 * DAY + 1)).to.equal(L.Calm);
    expect(await at(90 * DAY)).to.equal(L.Notice);      // <= 90d
    expect(await at(30 * DAY + 1)).to.equal(L.Notice);
    expect(await at(30 * DAY)).to.equal(L.Warning);     // <= 30d
    expect(await at(7 * DAY + 1)).to.equal(L.Warning);
    expect(await at(7 * DAY)).to.equal(L.Critical);     // <= 7d
    expect(await at(1)).to.equal(L.Critical);
    expect(await at(0)).to.equal(L.Expired);            // now >= expiry
    expect(await watchtower.levelFor(t - 1n, t)).to.equal(L.Expired);
  });
});

describe("Watchtower — watching & checkpoints", () => {
  it("enrollment is holder-only; snapshots custody; unwatch holder-only", async () => {
    const { registrar, nameVault, watchtower, a, b } = await setup();
    const id = await wrapU721(registrar, nameVault, a, "watched", 200 * DAY);
    await expect(watchtower.connect(b).watch(id)).to.be.revertedWithCustomError(watchtower, "NotHolder");
    await expect(watchtower.connect(a).watch(id)).to.emit(watchtower, "Watched").withArgs(id, a.address, CUSTODY_U721);
    expect(await watchtower.watchedCount()).to.equal(1n);
    expect((await watchtower.watchInfo(id)).custody).to.equal(CUSTODY_U721);
    expect(await watchtower.levelOf(id)).to.equal(L.Calm);
    await expect(watchtower.connect(a).watch(id)).to.be.revertedWithCustomError(watchtower, "AlreadyWatched");
    await expect(watchtower.connect(b).unwatch(id)).to.be.revertedWithCustomError(watchtower, "NotHolder");
    await watchtower.connect(a).unwatch(id);
    expect(await watchtower.watchedCount()).to.equal(0n);
    await expect(watchtower.levelOf(id)).to.be.revertedWithCustomError(watchtower, "NotWatched");
  });

  it("checkpoint emits Escalated only when risk worsens; Checkpointed always; permissionless", async () => {
    const { registrar, nameVault, watchtower, a, keeper } = await setup();
    const id = await wrapU721(registrar, nameVault, a, "escalate", 100 * DAY);
    await watchtower.connect(a).watch(id); // starts Calm (100d)
    // drop to Notice (jump so ~60d remain)
    await jump(40 * DAY);
    await expect(watchtower.connect(keeper).checkpoint(id))
      .to.emit(watchtower, "Escalated").withArgs(id, L.Calm, L.Notice)
      .and.to.emit(watchtower, "Checkpointed");
    expect((await watchtower.watchInfo(id)).lastLevel).to.equal(L.Notice);
    // re-checkpoint with no change: Checkpointed but NOT Escalated
    await expect(watchtower.connect(keeper).checkpoint(id)).to.emit(watchtower, "Checkpointed");
    const rc = await (await watchtower.connect(keeper).checkpoint(id)).wait();
    expect(rc.logs.some((l) => l.fragment && l.fragment.name === "Escalated")).to.equal(false);
    // jump into Warning (~20d) then Critical (~5d)
    await jump(40 * DAY);
    await expect(watchtower.checkpoint(id)).to.emit(watchtower, "Escalated").withArgs(id, L.Notice, L.Warning);
    await jump(16 * DAY);
    await expect(watchtower.checkpoint(id)).to.emit(watchtower, "Escalated").withArgs(id, L.Warning, L.Critical);
  });

  it("first Expired observation anchors the resurrection deadline (Lapsed emitted once)", async () => {
    const { registrar, nameVault, watchtower, a } = await setup();
    const id = await wrapU721(registrar, nameVault, a, "lapse", 10 * DAY);
    await watchtower.connect(a).watch(id);
    expect(await watchtower.resurrectionDeadline(id)).to.equal(0n);
    await jump(11 * DAY); // now expired
    const tx = await watchtower.checkpoint(id);
    await expect(tx).to.emit(watchtower, "Lapsed");
    const lapsedAt = (await watchtower.watchInfo(id)).lapsedAt;
    expect(await watchtower.resurrectionDeadline(id)).to.equal(BigInt(lapsedAt) + BigInt(90 * DAY));
    expect(await watchtower.levelOf(id)).to.equal(L.Expired);
    // a second checkpoint does NOT re-anchor (Lapsed only once)
    const rc = await (await watchtower.checkpoint(id)).wait();
    expect(rc.logs.some((l) => l.fragment && l.fragment.name === "Lapsed")).to.equal(false);
  });

  it("renewal de-escalates: a later checkpoint reflects the extended expiry", async () => {
    const { registrar, nameVault, watchtower, a } = await setup();
    const id = await wrapU721(registrar, nameVault, a, "renewed", 10 * DAY);
    await watchtower.connect(a).watch(id);
    await jump(6 * DAY);
    await watchtower.checkpoint(id);
    expect((await watchtower.watchInfo(id)).lastLevel).to.equal(L.Critical);
    // owner renews far out
    await registrar.setExpiry(id, (await now()) + 300 * DAY);
    await watchtower.checkpoint(id);
    expect((await watchtower.watchInfo(id)).lastLevel).to.equal(L.Calm);
    expect(await watchtower.levelOf(id)).to.equal(L.Calm);
  });

  it("auto-closes a watch when the position leaves the vault (unwrapped)", async () => {
    const { registrar, nameVault, watchtower, a } = await setup();
    const id = await wrapU721(registrar, nameVault, a, "gone", 200 * DAY);
    await watchtower.connect(a).watch(id);
    expect(await watchtower.watchedCount()).to.equal(1n);
    await nameVault.connect(a).unwrap(id); // position burned
    await expect(watchtower.checkpoint(id)).to.emit(watchtower, "WatchClosed").withArgs(id);
    expect(await watchtower.watchedCount()).to.equal(0n);
    await expect(watchtower.checkpoint(id)).to.be.revertedWithCustomError(watchtower, "NotWatched");
  });

  it("W-1155 custody reads expiry from the NameWrapper", async () => {
    const { wrapper, nameVault, watchtower, a } = await setup();
    const node = lh("wrapped-watch");
    const expiry = (await now()) + 20 * DAY;
    await wrapper.mintWrapped(node, a.address, 0, expiry);
    await wrapper.connect(a).setApprovalForAll(await nameVault.getAddress(), true);
    await nameVault.connect(a).wrapWrappedName(node, { value: 0 });
    await watchtower.connect(a).watch(node);
    expect((await watchtower.watchInfo(node)).custody).to.equal(CUSTODY_W1155);
    expect(await watchtower.expiryOf(node)).to.equal(BigInt(expiry));
    expect(await watchtower.levelOf(node)).to.equal(L.Warning); // 20d -> Warning
  });
});

describe("Watchtower — alarms & confusable watchlist", () => {
  it("alarms are permissionless, attributed, event-only", async () => {
    const { registrar, nameVault, watchtower, a, b } = await setup();
    const id = await wrapU721(registrar, nameVault, a, "alarmed", 100 * DAY);
    const hash = ethers.id("evidence:resolver=0xbad");
    // anyone can raise, even without watching (community flagging)
    await expect(watchtower.connect(b).raiseAlarm(id, ALARM.ResolverChanged, hash))
      .to.emit(watchtower, "AlarmRaised").withArgs(id, ALARM.ResolverChanged, b.address, hash);
    await expect(watchtower.connect(a).raiseAlarm(id, ALARM.TransferObserved, ethers.ZeroHash))
      .to.emit(watchtower, "AlarmRaised").withArgs(id, ALARM.TransferObserved, a.address, ethers.ZeroHash);
  });

  it("confusable reports build an attributed impersonation watchlist", async () => {
    const { watchtower, a, b } = await setup();
    const protectedId = lh("nick");
    const lookalike = ethers.keccak256(ethers.toUtf8Bytes("nÑ–ck")); // homoglyph
    const hash = ethers.id("evidence:registered-by-0xscam");
    await expect(watchtower.connect(b).reportConfusable(protectedId, lookalike, hash))
      .to.emit(watchtower, "ConfusableReported").withArgs(protectedId, lookalike, b.address, hash);
  });
});
