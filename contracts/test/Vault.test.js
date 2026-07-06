const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const FEE = ethers.parseEther("0.003"); // LNR precedent

async function setup(wrapFee = FEE) {
  const [deployer, governor, alice, bob, ops, pool, tithe] = await ethers.getSigners();
  const ens = await (await ethers.getContractFactory("MockENS")).deploy();
  const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy(
    [pool.address, tithe.address, ops.address],
    [7000, 1000, 2000]
  );
  const vault = await (await ethers.getContractFactory("ENSPLUSVault")).deploy(
    await ens.getAddress(),
    governor.address,
    await splitter.getAddress(),
    wrapFee,
    governor.address // initial external delegatee (genesis: GovernorAdapter)
  );
  for (const a of [alice, bob]) {
    await ens.mint(a.address, E(1000));
    await ens.connect(a).approve(await vault.getAddress(), ethers.MaxUint256);
  }
  return { ens, splitter, vault, governor, alice, bob, pool, tithe, ops };
}

const jump = async (s) => {
  await network.provider.send("evm_increaseTime", [s]);
  await network.provider.send("evm_mine");
};

describe("ENSPLUSVault", () => {
  it("wraps 1:1, pulls underlying, mints ENS+, forwards exact fee to splitter", async () => {
    const { ens, vault, splitter, alice } = await setup();
    await expect(vault.connect(alice).wrap(E(100), { value: FEE }))
      .to.emit(vault, "Wrapped").withArgs(alice.address, E(100), FEE);
    expect(await vault.balanceOf(alice.address)).to.equal(E(100));
    expect(await ens.balanceOf(await vault.getAddress())).to.equal(E(100));
    expect(await ethers.provider.getBalance(await splitter.getAddress())).to.equal(FEE);
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0n); // never holds ETH
  });

  it("rejects wrong fee (over and under) and zero amount", async () => {
    const { vault, alice } = await setup();
    await expect(vault.connect(alice).wrap(E(1), { value: 0 }))
      .to.be.revertedWithCustomError(vault, "WrongFee");
    await expect(vault.connect(alice).wrap(E(1), { value: FEE + 1n }))
      .to.be.revertedWithCustomError(vault, "WrongFee");
    await expect(vault.connect(alice).wrap(0, { value: FEE }))
      .to.be.revertedWithCustomError(vault, "ZeroAmount");
  });

  it("zero-fee deployments wrap with no ETH", async () => {
    const { vault, alice } = await setup(0n);
    await vault.connect(alice).wrap(E(5), { value: 0 });
    expect(await vault.balanceOf(alice.address)).to.equal(E(5));
  });

  it("unwrap is 1:1, feeless, and always available (C4 / I1)", async () => {
    const { ens, vault, alice } = await setup();
    await vault.connect(alice).wrap(E(100), { value: FEE });
    const before = await ens.balanceOf(alice.address);
    await expect(vault.connect(alice).unwrap(E(40)))
      .to.emit(vault, "Unwrapped").withArgs(alice.address, E(40));
    expect(await ens.balanceOf(alice.address)).to.equal(before + E(40));
    expect(await vault.balanceOf(alice.address)).to.equal(E(60));
    await vault.connect(alice).unwrap(E(60)); // full exit
    expect(await vault.balanceOf(alice.address)).to.equal(0n);
  });

  it("unwrap of more than balance reverts; transferred ENS+ is unwrappable by receiver (I1)", async () => {
    const { ens, vault, alice, bob } = await setup();
    await vault.connect(alice).wrap(E(10), { value: FEE });
    await expect(vault.connect(alice).unwrap(E(11))).to.be.reverted;
    await vault.connect(alice).transfer(bob.address, E(10));
    await vault.connect(bob).unwrap(E(10));
    expect(await ens.balanceOf(bob.address)).to.equal(E(1010));
  });

  it("delegates underlying votes to initial delegatee and re-delegates only via governor (C3/I4)", async () => {
    const { ens, vault, governor, alice, bob } = await setup();
    await vault.connect(alice).wrap(E(100), { value: FEE });
    expect(await ens.getVotes(governor.address)).to.equal(E(100)); // vault power -> delegatee
    await expect(vault.connect(alice).setDelegatee(bob.address))
      .to.be.revertedWithCustomError(vault, "NotGovernor");
    await expect(vault.connect(governor).setDelegatee(bob.address))
      .to.emit(vault, "DelegateeChanged").withArgs(governor.address, bob.address);
    expect(await ens.getVotes(bob.address)).to.equal(E(100));
    expect(await ens.getVotes(governor.address)).to.equal(0n);
    await expect(vault.connect(governor).setDelegatee(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(vault, "ZeroAddress");
  });

  it("has no owner/admin surface beyond setDelegatee (I4)", async () => {
    const { vault } = await setup();
    const mutators = vault.interface.fragments.filter(
      (f) => f.type === "function" && !["view", "pure"].includes(f.stateMutability)
    ).map((f) => f.name).sort();
    expect(mutators).to.deep.equal(["approve", "setDelegatee", "transfer", "transferFrom", "unwrap", "wrap"]);
  });

  it("checkpoints balances and total supply by timestamp (governor snapshot source)", async () => {
    const { vault, alice, bob } = await setup();
    await vault.connect(alice).wrap(E(100), { value: FEE });
    const t1 = (await ethers.provider.getBlock("latest")).timestamp;
    await jump(100);
    await vault.connect(alice).transfer(bob.address, E(30));
    await jump(100);
    expect(await vault.balanceOfAt(alice.address, t1)).to.equal(E(100));
    expect(await vault.balanceOfAt(bob.address, t1)).to.equal(0n);
    const t2 = (await ethers.provider.getBlock("latest")).timestamp - 50;
    expect(await vault.balanceOfAt(alice.address, t2)).to.equal(E(70));
    expect(await vault.balanceOfAt(bob.address, t2)).to.equal(E(30));
    expect(await vault.totalSupplyAt(t1)).to.equal(E(100));
    await expect(vault.balanceOfAt(alice.address, t2 + 10 ** 6))
      .to.be.revertedWithCustomError(vault, "FutureLookup");
  });

  it("vesting start blends by amount on wrap and transfer-in (G3)", async () => {
    const { vault, alice, bob } = await setup();
    await vault.connect(alice).wrap(E(100), { value: FEE });
    const t0 = Number(await vault.vestingStart(alice.address));
    await jump(1000);
    // equal top-up: start moves to midpoint (+-1s tolerance for block time)
    await vault.connect(alice).wrap(E(100), { value: FEE });
    const t1 = Number(await vault.vestingStart(alice.address));
    expect(t1 - t0).to.be.closeTo(500, 3);
    // fresh receiver gets a fresh start
    await jump(1000);
    await vault.connect(alice).transfer(bob.address, E(50));
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    expect(Number(await vault.vestingStart(bob.address))).to.be.closeTo(now, 2);
    // alice's start unchanged by outbound transfer
    expect(Number(await vault.vestingStart(alice.address))).to.equal(t1);
    // vestingElapsed grows
    await jump(500);
    expect(Number(await vault.vestingElapsed(bob.address))).to.be.closeTo(500, 3);
  });
});
