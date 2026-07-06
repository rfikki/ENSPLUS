const { expect } = require("chai");
const { ethers } = require("hardhat");

const enc = ethers.AbiCoder.defaultAbiCoder();
// committedInputs the mock helper decodes into BoundData(sender, chainId)
const bound = (sender, chainId) => enc.encode(["address", "uint256"], [sender, chainId]);
// publicInputs[0] != 0 => scope ok in the mock helper
const OK_SCOPE = [ethers.id("scope-ok")];
const BAD_SCOPE = [ethers.ZeroHash];

// a full ProofVerificationParams shell (fields the mock ignores except committedInputs/publicInputs/devMode)
function params(committedInputs, publicInputs, devMode = false) {
  return {
    version: ethers.ZeroHash,
    proofVerificationData: { vkeyHash: ethers.ZeroHash, proof: "0x", publicInputs },
    committedInputs,
    serviceConfig: { validityPeriodInSeconds: 0, domain: "ensplus.test", scope: "ensplus.citizen", devMode },
  };
}

async function setup(allowDevMode = false) {
  const [deployer, a, b, c] = await ethers.getSigners();
  const helper = await (await ethers.getContractFactory("MockZKHelper")).deploy();
  const verifier = await (await ethers.getContractFactory("MockZKVerifier")).deploy(await helper.getAddress());
  const attestor = await (await ethers.getContractFactory("HumanAttestor")).deploy(
    await verifier.getAddress(), "ensplus.test", allowDevMode
  );
  const chainId = (await ethers.provider.getNetwork()).chainId;
  return { deployer, a, b, c, helper, verifier, attestor, chainId };
}

describe("HumanAttestor — proof of humanity (ownerless)", () => {
  it("has no owner/admin surface: only claim() writes, verifier/domain immutable", async () => {
    const { attestor, verifier } = await setup();
    const iface = attestor.interface;
    const mutators = iface.fragments.filter((f) => f.type === "function" && f.stateMutability !== "view" && f.stateMutability !== "pure").map((f) => f.name);
    expect(mutators).to.deep.equal(["claim"]); // the ONLY state-changing entry point
    expect(await attestor.verifier()).to.equal(await verifier.getAddress());
    expect(await attestor.SCOPE()).to.equal("ensplus.citizen");
  });

  it("verifies a human bound to the caller + chain; sets isVerifiedHuman", async () => {
    const { attestor, verifier, a, chainId } = await setup();
    const uid = ethers.id("passport-A");
    await verifier.set(true, uid);
    expect(await attestor.isVerifiedHuman(a.address)).to.equal(false);
    await attestor.connect(a).claim(params(bound(a.address, chainId), OK_SCOPE));
    expect(await attestor.isVerifiedHuman(a.address)).to.equal(true);
    expect(await attestor.passportOf(a.address)).to.equal(uid);
    expect(await attestor.humanOf(uid)).to.equal(a.address);
    expect(await attestor.verifiedCount()).to.equal(1n);
  });

  it("rejects unverified proofs, wrong scope, wrong sender, wrong chain", async () => {
    const { attestor, verifier, a, b, chainId } = await setup();
    const uid = ethers.id("p");
    await verifier.set(false, uid);
    await expect(attestor.connect(a).claim(params(bound(a.address, chainId), OK_SCOPE)))
      .to.be.revertedWithCustomError(attestor, "NotVerified");
    await verifier.set(true, uid);
    await expect(attestor.connect(a).claim(params(bound(a.address, chainId), BAD_SCOPE)))
      .to.be.revertedWithCustomError(attestor, "WrongScope");
    await expect(attestor.connect(a).claim(params(bound(b.address, chainId), OK_SCOPE)))
      .to.be.revertedWithCustomError(attestor, "WrongSender"); // bound to b, a calls
    await expect(attestor.connect(a).claim(params(bound(a.address, 999999n), OK_SCOPE)))
      .to.be.revertedWithCustomError(attestor, "WrongChain");
  });

  it("one passport, one human: a second passport from the same wallet reverts", async () => {
    const { attestor, verifier, a, chainId } = await setup();
    await verifier.set(true, ethers.id("passport-A"));
    await attestor.connect(a).claim(params(bound(a.address, chainId), OK_SCOPE));
    await expect(attestor.connect(a).claim(params(bound(a.address, chainId), OK_SCOPE)))
      .to.be.revertedWithCustomError(attestor, "AlreadyBoundToCaller");
    await verifier.set(true, ethers.id("passport-B")); // different passport, same wallet
    await expect(attestor.connect(a).claim(params(bound(a.address, chainId), OK_SCOPE)))
      .to.be.revertedWithCustomError(attestor, "AddressBoundToAnotherPassport");
  });

  it("rebind on wallet rotation: same passport moves to a new wallet, old is cleared", async () => {
    const { attestor, verifier, a, b, chainId } = await setup();
    const uid = ethers.id("passport-A");
    await verifier.set(true, uid);
    await attestor.connect(a).claim(params(bound(a.address, chainId), OK_SCOPE));
    // same passport, new wallet b
    await expect(attestor.connect(b).claim(params(bound(b.address, chainId), OK_SCOPE)))
      .to.emit(attestor, "HumanityRebound").withArgs(uid, a.address, b.address);
    expect(await attestor.isVerifiedHuman(a.address)).to.equal(false); // old cleared
    expect(await attestor.isVerifiedHuman(b.address)).to.equal(true);
    expect(await attestor.verifiedCount()).to.equal(1n); // still one human
  });

  it("dev-mode proofs are rejected unless explicitly allowed", async () => {
    const { attestor, verifier, a, chainId } = await setup(false); // mainnet-like
    await verifier.set(true, ethers.id("p"));
    await expect(attestor.connect(a).claim(params(bound(a.address, chainId), OK_SCOPE, true)))
      .to.be.revertedWithCustomError(attestor, "DevModeNotAllowed");
    const dev = await setup(true); // sepolia-like
    await dev.verifier.set(true, ethers.id("p"));
    await dev.attestor.connect(dev.a).claim(params(bound(dev.a.address, dev.chainId), OK_SCOPE, true));
    expect(await dev.attestor.isVerifiedHuman(dev.a.address)).to.equal(true);
  });
});
