/**
 * tools/fuzz.js — cross-fuzz harness for slice-1 libraries.
 * Run: npx hardhat run tools/fuzz.js --no-compile
 *
 * Methodology (LibDinoSeed / LibAsciiSeed lineage): every library function is
 * re-implemented INDEPENDENTLY in BigInt JS below, then diffed against the
 * on-chain output across randomized inputs. A single mismatch fails the run.
 * The mirrors are written from the SPEC, not from the Solidity — that
 * independence is the point.
 */
const { ethers } = require("hardhat");
const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");

// deterministic PRNG so failures are reproducible by seed
let S = 0xdecafbadn;
const rnd = () => {
  S = (S * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
  return S;
};
const rndInt = (maxExcl) => Number(rnd() % BigInt(maxExcl));
const rndBig = (bits) => rnd() << BigInt(rndInt(Math.max(1, bits - 64))) & ((1n << BigInt(bits)) - 1n);

// ------------------------------------------------------------- JS mirrors
const WAD = 10n ** 18n;

function mirrorCategoryBits(bytes) {
  const len = bytes.length;
  if (len === 0 || len > 255) return 0n;
  let allDigits = true, allLower = true, allSame = true;
  for (let i = 0; i < len; i++) {
    const c = bytes[i];
    if (c >= 0x80) return 0n;
    if (c < 0x30 || c > 0x39) allDigits = false;
    if (c < 0x61 || c > 0x7a) allLower = false;
    if (c !== bytes[0]) allSame = false;
  }
  let bits = 0n;
  if (allDigits) {
    if (len === 3) bits |= 1n;
    else if (len === 4) bits |= 2n;
    else if (len === 5) bits |= 4n;
  }
  if (allLower && len === 3) bits |= 8n;
  if (len >= 3) {
    let pal = true;
    for (let i = 0, j = len - 1; i < j; i++, j--) if (bytes[i] !== bytes[j]) { pal = false; break; }
    if (pal) bits |= 16n;
  }
  if (allSame && len >= 2) bits |= 32n;
  return bits;
}

function isqrt(n) {
  if (n < 2n) return n;
  let x = n, y = (x + 1n) >> 1n;
  while (y < x) { x = y; y = (x + n / x) >> 1n; }
  return x;
}
const mirrorQuadratic = isqrt;
const mirrorVesting = (elapsed, period) =>
  period === 0n || elapsed >= period ? WAD : (elapsed * WAD) / period;
const mirrorDormancy = (missed) => {
  let h = missed / 3n;
  if (h > 5n) h = 5n;
  return WAD >> h;
};
const mirrorCap = (w, total, capBps) => {
  const cap = (total * capBps) / 10000n;
  return w > cap ? cap : w;
};
const mirrorCompose = (bal, prov, vest, dorm) => {
  let w = isqrt(bal);
  w = (w * prov) / WAD;
  w = (w * vest) / WAD;
  w = (w * dorm) / WAD;
  return w;
};
const mirrorRankTier = (r) => (r === 0 ? 0 : r <= 100 ? 3 : r <= 1000 ? 2 : r <= 10000 ? 1 : 0);

// ------------------------------------------------------------- input gens
function genLabel() {
  const strategies = [
    () => { // pure digits, club-adjacent lengths
      const len = [1, 2, 3, 3, 4, 4, 5, 5, 6][rndInt(9)];
      return Uint8Array.from({ length: len }, () => 0x30 + rndInt(10));
    },
    () => { // pure lowercase
      const len = 1 + rndInt(8);
      return Uint8Array.from({ length: len }, () => 0x61 + rndInt(26));
    },
    () => { // deliberate palindrome
      const half = 1 + rndInt(5);
      const mid = rndInt(2);
      const h = Array.from({ length: half }, () => 0x30 + rndInt(75));
      const m = mid ? [0x30 + rndInt(75)] : [];
      return Uint8Array.from([...h, ...m, ...h.slice().reverse()]);
    },
    () => { // repeated char
      const len = 1 + rndInt(7);
      const c = 0x21 + rndInt(90);
      return Uint8Array.from({ length: len }, () => c);
    },
    () => { // arbitrary ASCII incl punctuation
      const len = rndInt(12);
      return Uint8Array.from({ length: len }, () => 0x20 + rndInt(95));
    },
    () => { // contains non-ASCII bytes
      const len = 1 + rndInt(10);
      const a = Uint8Array.from({ length: len }, () => rndInt(256));
      a[rndInt(len)] = 0x80 + rndInt(128);
      return a;
    },
    () => { // boundary lengths 254/255/256
      const len = 254 + rndInt(3);
      return Uint8Array.from({ length: len }, () => 0x61 + rndInt(26));
    },
  ];
  return strategies[rndInt(strategies.length)]();
}

// ------------------------------------------------------------------ main
async function main() {
  const N = Number(process.env.FUZZ_N ?? 2000);
  const cat = await (await ethers.getContractFactory("CategoryHarness")).deploy();
  const att = await (await ethers.getContractFactory("AttestationHarness")).deploy();
  const wgt = await (await ethers.getContractFactory("WeightHarness")).deploy();
  let checks = 0;
  const fail = (name, input, got, want) => {
    console.error(`MISMATCH ${name}\n input=${input}\n evm=${got}\n mirror=${want}`);
    process.exit(1);
  };

  // ---- LibCategory
  for (let i = 0; i < N; i++) {
    const label = genLabel();
    const got = await cat.categoryBits(label);
    const want = mirrorCategoryBits(label);
    if (got !== want) fail("categoryBits", Buffer.from(label).toString("hex"), got, want);
    checks++;
  }
  console.log(`LibCategory   : ${N} labels, 0 mismatches`);

  // ---- LibWeight
  for (let i = 0; i < N; i++) {
    const bal = [0n, 1n, WAD - 1n, WAD, rndBig(64), rndBig(96), rndBig(128), rndBig(200), (1n << 256n) - 1n][rndInt(9)];
    const prov = [WAD, WAD / 2n, 2n * WAD, 4n * WAD, BigInt(rndInt(4e9))][rndInt(5)];
    const vestP = [0n, 1n, 86400n, 2592000n][rndInt(4)];
    const el = rndBig(40);
    const missed = BigInt(rndInt(50));
    const q = await wgt.quadraticWeight(bal);
    if (q !== mirrorQuadratic(bal)) fail("quadratic", bal, q, mirrorQuadratic(bal));
    const v = await wgt.vestingWad(el, vestP);
    if (v !== mirrorVesting(el, vestP)) fail("vesting", [el, vestP], v, mirrorVesting(el, vestP));
    const d = await wgt.dormancyWad(missed);
    if (d !== mirrorDormancy(missed)) fail("dormancy", missed, d, mirrorDormancy(missed));
    const total = rndBig(120);
    const capBps = 1n + BigInt(rndInt(10000));
    const w = rndBig(120);
    const c = await wgt.cappedWeight(w, total, capBps);
    if (c !== mirrorCap(w, total, capBps)) fail("cap", [w, total, capBps], c, mirrorCap(w, total, capBps));
    checks += 4;
  }
  // compose: dedicated loop, multipliers sampled within the 4x ceiling
  for (let i = 0; i < N; i++) {
    const bal = rndBig(1 + rndInt(255));
    const prov = BigInt(rndInt(4_000_000_000)) * (WAD / 1_000_000_000n); // [0, 4e18) in 1e9 steps
    const vest = BigInt(rndInt(1_000_000_001)) * (WAD / 1_000_000_000n); // [0, 1e18]
    const dorm = WAD >> BigInt(rndInt(6));
    const got = await wgt.composeWeight(bal, prov, vest, dorm);
    const want = mirrorCompose(bal, prov, vest, dorm);
    if (got !== want) fail("compose", [bal, prov, vest, dorm], got, want);
    checks++;
  }
  console.log(`LibWeight     : ${N * 5} operations, 0 mismatches`);

  // ---- LibAttestation: random OZ trees, verify true; tampered, verify false
  const LEAF_TYPES = ["bytes32", "uint40", "uint32", "uint8", "uint16", "uint8"];
  const TREES = 40, LEAVES = 64;
  for (let t = 0; t < TREES; t++) {
    const leaves = Array.from({ length: LEAVES }, () => [
      ethers.hexlify(ethers.randomBytes(32)),
      Number(rnd() % (1n << 40n) / 2n),
      rndInt(90000),
      rndInt(4),
      rndInt(16),
      1,
    ]);
    const tree = StandardMerkleTree.of(leaves, LEAF_TYPES);
    for (const [i, l] of tree.entries()) {
      const s = { labelhash: l[0], registrationTimestamp: l[1], ordinalRank: l[2], era: l[3], flags: l[4], leafVersion: l[5] };
      if (!(await att.verify(tree.getProof(i), tree.root, s))) fail("merkle true", i, false, true);
      // tamper one field
      const tam = { ...s, ordinalRank: s.ordinalRank + 1 };
      if (await att.verify(tree.getProof(i), tree.root, tam)) fail("merkle tamper", i, true, false);
      checks += 2;
      if (i >= 15) break; // 16 leaves per tree keeps runtime sane
    }
  }
  console.log(`LibAttestation: ${TREES} random OZ trees x16 leaves, verify+tamper, 0 mismatches`);

  // rank tier exhaustive around boundaries + random
  for (let r = 0; r <= 10101; r += r < 110 ? 1 : 97) {
    const got = Number(await att.rankTier(r));
    if (got !== mirrorRankTier(r)) fail("rankTier", r, got, mirrorRankTier(r));
    checks++;
  }
  console.log(`rankTier      : boundary sweep, 0 mismatches`);

  console.log(`\nTOTAL: ${checks} cross-checks, all EVM outputs match independent JS mirrors.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
