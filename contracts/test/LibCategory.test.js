const { expect } = require("chai");
const { ethers } = require("hardhat");

// Bit constants mirroring LibCategory
const BIT = {
  CLUB_999: 1n << 0n,
  CLUB_10K: 1n << 1n,
  CLUB_100K: 1n << 2n,
  LETTERS_3: 1n << 3n,
  PALINDROME: 1n << 4n,
  REPEATED: 1n << 5n,
};

describe("LibCategory", () => {
  let h;
  before(async () => {
    h = await (await ethers.getContractFactory("CategoryHarness")).deploy();
  });

  const bits = async (s) => h.categoryBits(ethers.toUtf8Bytes(s));

  it("999 club", async () => {
    expect(await bits("000")).to.equal(BIT.CLUB_999 | BIT.PALINDROME | BIT.REPEATED);
    expect(await bits("007")).to.equal(BIT.CLUB_999);
    expect(await bits("123")).to.equal(BIT.CLUB_999);
    expect(await bits("999")).to.equal(BIT.CLUB_999 | BIT.PALINDROME | BIT.REPEATED);
  });

  it("10k and 100k clubs", async () => {
    expect(await bits("1234")).to.equal(BIT.CLUB_10K);
    expect(await bits("0001")).to.equal(BIT.CLUB_10K);
    expect(await bits("12321")).to.equal(BIT.CLUB_100K | BIT.PALINDROME);
    expect(await bits("00100")).to.equal(BIT.CLUB_100K | BIT.PALINDROME);
  });

  it("3-letter club", async () => {
    expect(await bits("abc")).to.equal(BIT.LETTERS_3);
    expect(await bits("aaa")).to.equal(BIT.LETTERS_3 | BIT.PALINDROME | BIT.REPEATED);
    expect(await bits("aba")).to.equal(BIT.LETTERS_3 | BIT.PALINDROME);
    // uppercase is NOT lowercase a-z (raw-label semantics, D6)
    expect(await bits("ABC")).to.equal(0n);
  });

  it("palindromes require length >= 3; repeated requires >= 2", async () => {
    expect(await bits("aa")).to.equal(BIT.REPEATED); // len 2: repeated but not palindrome bit
    expect(await bits("racecar")).to.equal(BIT.PALINDROME);
    expect(await bits("ab")).to.equal(0n);
    expect(await bits("a")).to.equal(0n);
  });

  it("digits mixed with letters are neither club nor letters", async () => {
    expect(await bits("a1b")).to.equal(0n);
    expect(await bits("12a")).to.equal(0n);
  });

  it("non-ASCII labels return zero algorithmic bits (unicode is attested/curated scope)", async () => {
    expect(await bits("única")).to.equal(0n);
    expect(await bits("🔥🔥🔥")).to.equal(0n);
    expect(await bits("999\u00e9")).to.equal(0n);
  });

  it("empty and oversized labels return zero", async () => {
    expect(await h.categoryBits("0x")).to.equal(0n);
    expect(await bits("x".repeat(256))).to.equal(0n);
    // 255 is still in scope
    expect(await bits("x".repeat(255))).to.equal(BIT.PALINDROME | BIT.REPEATED);
  });

  it("hyphens/punctuation block letter and digit clubs but can palindrome", async () => {
    expect(await bits("a-a")).to.equal(BIT.PALINDROME);
    expect(await bits("1-1")).to.equal(BIT.PALINDROME);
  });
});
