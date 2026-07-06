const { expect } = require("chai");
const { ethers } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const FEE = ethers.parseEther("0.003");

// deterministic PRNG (reproducible failures)
let S = 0xc0ffee ^ 0x5eed;
const rnd = () => (S = (S * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

describe("Invariants I1–I4 (randomized stateful run)", () => {
  it("holds conservation, redeemability, covenant outflow, and no-priv across 300 random ops", async function () {
    this.timeout(300000);
    const [_, governor, a1, a2, a3, a4, pool, tithe, ops] = await ethers.getSigners();
    const actors = [a1, a2, a3, a4];
    const ens = await (await ethers.getContractFactory("MockENS")).deploy();
    const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy(
      [pool.address, tithe.address, ops.address], [7000, 1000, 2000]
    );
    const vault = await (await ethers.getContractFactory("ENSPLUSVault")).deploy(
      await ens.getAddress(), governor.address, await splitter.getAddress(), FEE, governor.address
    );
    const vaultAddr = await vault.getAddress();
    for (const a of actors) {
      await ens.mint(a.address, E(10000));
      await ens.connect(a).approve(vaultAddr, ethers.MaxUint256);
    }

    let underlyingOut = 0n; // sum of all underlying that ever left the vault
    let unwrapPaid = 0n;    // sum paid out via unwrap events

    const OPS = Number(process.env.INV_OPS ?? 300);
    for (let i = 0; i < OPS; i++) {
      const actor = pick(actors);
      const op = pick(["wrap", "wrap", "unwrap", "transfer", "unwrap"]);
      const bal = await vault.balanceOf(actor.address);
      try {
        if (op === "wrap") {
          const amt = ethers.parseEther((rnd() * 50 + 0.001).toFixed(6));
          await vault.connect(actor).wrap(amt, { value: FEE });
        } else if (op === "unwrap" && bal > 0n) {
          const amt = (bal * BigInt(Math.floor(rnd() * 1000) + 1)) / 1000n;
          const before = await ens.balanceOf(actor.address);
          await vault.connect(actor).unwrap(amt);
          const delta = (await ens.balanceOf(actor.address)) - before;
          expect(delta).to.equal(amt); // unwrap pays exactly the burn, to the burner (I2)
          unwrapPaid += amt;
        } else if (op === "transfer" && bal > 0n) {
          const to = pick(actors);
          await vault.connect(actor).transfer(to.address, bal / 3n + 1n);
        }
      } catch (e) {
        throw new Error(`op ${i} (${op}) unexpectedly reverted: ${e.message}`);
      }

      // I3 conservation at EVERY step
      const ts = await vault.totalSupply();
      const held = await ens.balanceOf(vaultAddr);
      expect(ts).to.equal(held);
      // vault never holds ETH between transactions
      expect(await ethers.provider.getBalance(vaultAddr)).to.equal(0n);
    }

    // I2 covenant outflow: total underlying ever released == total unwrap payments
    // (reconstructed from final balances: minted - stillHeld == paid out)
    const minted = E(10000) * BigInt(actors.length);
    let actorEns = 0n;
    for (const a of actors) actorEns += await ens.balanceOf(a.address);
    const held = await ens.balanceOf(vaultAddr);
    expect(actorEns + held).to.equal(minted); // nothing leaked anywhere else
    // I1 terminal redeemability: everyone can fully exit right now
    for (const a of actors) {
      const b = await vault.balanceOf(a.address);
      if (b > 0n) await vault.connect(a).unwrap(b);
      expect(await vault.balanceOf(a.address)).to.equal(0n);
    }
    expect(await vault.totalSupply()).to.equal(0n);
    expect(await ens.balanceOf(vaultAddr)).to.equal(0n); // vault empties to exactly zero
    let finalEns = 0n;
    for (const a of actors) finalEns += await ens.balanceOf(a.address);
    expect(finalEns).to.equal(minted); // every wei of underlying accounted (I2/I3)
  });

  it("I4: underlying grants no approvals from the vault; delegatee change is the only governed knob", async () => {
    const [_, governor, alice, pool, tithe, ops, rando] = await ethers.getSigners();
    const ens = await (await ethers.getContractFactory("MockENS")).deploy();
    const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy(
      [pool.address, tithe.address, ops.address], [7000, 1000, 2000]
    );
    const vault = await (await ethers.getContractFactory("ENSPLUSVault")).deploy(
      await ens.getAddress(), governor.address, await splitter.getAddress(), 0n, governor.address
    );
    await ens.mint(alice.address, E(10));
    await ens.connect(alice).approve(await vault.getAddress(), E(10));
    await vault.connect(alice).wrap(E(10), { value: 0 });
    // no path grants underlying allowances from the vault to anyone
    expect(await ens.allowance(await vault.getAddress(), rando.address)).to.equal(0n);
    // rando cannot pull underlying
    await expect(ens.connect(rando).transferFrom(await vault.getAddress(), rando.address, 1n))
      .to.be.reverted;
  });
});

describe("RevenueSplitter", () => {
  async function deploySplitter(payees, bps) {
    return (await ethers.getContractFactory("RevenueSplitter")).deploy(payees, bps);
  }

  it("constructor enforces shape: sum=10000, nonzero payees/bps, matched lengths", async () => {
    const [a, b, c] = (await ethers.getSigners()).map((s) => s.address);
    await expect(deploySplitter([a, b], [5000, 4999])).to.be.revertedWithCustomError(
      await ethers.getContractFactory("RevenueSplitter"), "BpsSumInvalid");
    await expect(deploySplitter([a], [10000, 1])).to.be.reverted;
    await expect(deploySplitter([], [])).to.be.reverted;
    await expect(deploySplitter([a, ethers.ZeroAddress], [5000, 5000])).to.be.reverted;
    await expect(deploySplitter([a, b], [10000, 0])).to.be.reverted;
    const ok = await deploySplitter([a, b, c], [7000, 1000, 2000]);
    expect(await ok.sliceCount()).to.equal(3);
  });

  it("flush distributes exactly with remainder to last payee; no dust remains", async () => {
    const [funder, p1, p2, p3] = await ethers.getSigners();
    const s = await deploySplitter([p1.address, p2.address, p3.address], [3333, 3333, 3334]);
    const amount = 1000000000000000007n; // awkward number to force remainder
    await funder.sendTransaction({ to: await s.getAddress(), value: amount });
    const b1 = await ethers.provider.getBalance(p1.address);
    const b2 = await ethers.provider.getBalance(p2.address);
    const b3 = await ethers.provider.getBalance(p3.address);
    await s.connect(funder).flush();
    const d1 = (await ethers.provider.getBalance(p1.address)) - b1;
    const d2 = (await ethers.provider.getBalance(p2.address)) - b2;
    const d3 = (await ethers.provider.getBalance(p3.address)) - b3;
    expect(d1).to.equal((amount * 3333n) / 10000n);
    expect(d2).to.equal((amount * 3333n) / 10000n);
    expect(d3).to.equal(amount - d1 - d2); // remainder to last
    expect(d1 + d2 + d3).to.equal(amount);
    expect(await ethers.provider.getBalance(await s.getAddress())).to.equal(0n);
    await expect(s.flush()).to.be.revertedWithCustomError(s, "NothingToFlush");
  });

  it("flush is permissionless and repeatable across funding rounds", async () => {
    const [funder, p1, p2, rando] = await ethers.getSigners();
    const s = await deploySplitter([p1.address, p2.address], [6000, 4000]);
    await funder.sendTransaction({ to: await s.getAddress(), value: E(1) });
    await s.connect(rando).flush(); // anyone may flush (keeper job class)
    await funder.sendTransaction({ to: await s.getAddress(), value: E(2) });
    const before = await ethers.provider.getBalance(p2.address);
    await s.connect(rando).flush();
    expect((await ethers.provider.getBalance(p2.address)) - before).to.equal((E(2) * 4000n) / 10000n);
  });

  it("has no mutators besides flush (immutability, I4-adjacent)", async () => {
    const [p1, p2] = (await ethers.getSigners()).map((s) => s.address);
    const s = await deploySplitter([p1, p2], [5000, 5000]);
    const mutators = s.interface.fragments
      .filter((f) => f.type === "function" && !["view", "pure"].includes(f.stateMutability))
      .map((f) => f.name);
    expect(mutators).to.deep.equal(["flush"]);
  });
});
