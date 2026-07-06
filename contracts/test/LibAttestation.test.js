const { expect } = require("chai");
const { ethers } = require("hardhat");
const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");

const LEAF_TYPES = ["bytes32", "uint40", "uint32", "uint8", "uint16", "uint8"];

const ERA = { PREPUNK: 0, AUCTION: 1, PERMANENT: 2, MODERN: 3 };
const FLAG = { LABEL_UNKNOWN: 1, RECOVERED: 2, CONTINUOUS: 4, AIRDROP: 8 };
const CUTOFF_PREPUNK = 1498176000; // 2017-06-23 (illustrative; dry-run will pin exact)

const labelhash = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

function mkLeaf(label, ts, rank, era, flags, version = 1) {
  return [labelhash(label), ts, rank, era, flags, version];
}
const asStruct = (l) => ({
  labelhash: l[0],
  registrationTimestamp: l[1],
  ordinalRank: l[2],
  era: l[3],
  flags: l[4],
  leafVersion: l[5],
});

describe("LibAttestation", () => {
  let h, tree, leaves;

  before(async () => {
    h = await (await ethers.getContractFactory("AttestationHarness")).deploy();
    // A miniature prepunk-style corpus, rank 1 = rilxxlir per the real ranking
    leaves = [
      mkLeaf("rilxxlir", CUTOFF_PREPUNK - 3888000, 1, ERA.PREPUNK, FLAG.CONTINUOUS | FLAG.AIRDROP),
      mkLeaf("king", CUTOFF_PREPUNK - 3000000, 42, ERA.PREPUNK, FLAG.AIRDROP),
      mkLeaf("dao", CUTOFF_PREPUNK - 2000000, 101, ERA.PREPUNK, FLAG.AIRDROP),
      mkLeaf("vault", CUTOFF_PREPUNK - 1000000, 1001, ERA.PREPUNK, FLAG.AIRDROP),
      mkLeaf("later", CUTOFF_PREPUNK + 5000000, 20000, ERA.AUCTION, FLAG.AIRDROP),
      // a hash-only blank: era-0 with LABEL_UNKNOWN — era 0 is REAL data
      [ethers.hexlify(ethers.randomBytes(32)), CUTOFF_PREPUNK - 500000, 77, ERA.PREPUNK, FLAG.LABEL_UNKNOWN, 1],
    ];
    tree = StandardMerkleTree.of(leaves, LEAF_TYPES);
  });

  it("leafHash matches OZ StandardMerkleTree leaf hashing exactly", async () => {
    for (const [i, l] of tree.entries()) {
      expect(await h.leafHash(asStruct(l))).to.equal(tree.leafHash(l));
    }
  });

  it("verifies every leaf of an OZ-built tree against its root", async () => {
    for (const [i, l] of tree.entries()) {
      const proof = tree.getProof(i);
      expect(await h.verify(proof, tree.root, asStruct(l))).to.equal(true);
    }
  });

  it("rejects tampered leaves and wrong proofs", async () => {
    const [i, l] = [...tree.entries()][0];
    const proof = tree.getProof(i);
    const tampered = asStruct(l);
    tampered.ordinalRank = 2; // claim a different rank
    expect(await h.verify(proof, tree.root, tampered)).to.equal(false);
    const wrongProof = tree.getProof(1);
    expect(await h.verify(wrongProof, tree.root, asStruct(l))).to.equal(false);
    expect(await h.verify(proof, ethers.hexlify(ethers.randomBytes(32)), asStruct(l))).to.equal(false);
  });

  it("era 0 (Prepunk) verifies as real data — never an unset sentinel (LNR era-0 lesson)", async () => {
    const blankIdx = leaves.length - 1;
    const l = [...tree.entries()].find(([, v]) => v[4] === FLAG.LABEL_UNKNOWN);
    const proof = tree.getProof(l[0]);
    const s = asStruct(l[1]);
    expect(s.era).to.equal(0);
    expect(await h.verify(proof, tree.root, s)).to.equal(true);
    expect(await h.hasFlag(s, FLAG.LABEL_UNKNOWN)).to.equal(true);
    expect(await h.hasFlag(s, FLAG.RECOVERED)).to.equal(false);
  });

  it("rejects structurally invalid eras", async () => {
    const l = asStruct(leaves[0]);
    l.era = 4;
    await expect(h.verify([], ethers.ZeroHash, l)).to.be.revertedWithCustomError(
      { interface: (await ethers.getContractFactory("AttestationHarness")).interface },
      "InvalidEra"
    );
  });

  it("rank tiers derive at read time with exact boundaries (D5)", async () => {
    expect(await h.rankTier(0)).to.equal(0);       // unranked
    expect(await h.rankTier(1)).to.equal(3);       // top100
    expect(await h.rankTier(100)).to.equal(3);
    expect(await h.rankTier(101)).to.equal(2);     // top1k
    expect(await h.rankTier(1000)).to.equal(2);
    expect(await h.rankTier(1001)).to.equal(1);    // top10k
    expect(await h.rankTier(10000)).to.equal(1);
    expect(await h.rankTier(10001)).to.equal(0);
    expect(await h.rankTier(79720)).to.equal(0);   // full prepunk corpus tail
  });
});
