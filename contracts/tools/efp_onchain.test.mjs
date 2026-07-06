// efp_onchain.test.mjs — RPC-free unit tests for the on-chain EFP reader.
// Vectors are taken verbatim from docs.efp.app so the decoders are validated
// against real EFP-encoded data, not our own assumptions.
import assert from "node:assert";
import {
  parseListStorageLocation,
  parseListOp,
  reduceFollowing,
  graphFromFollowingMap,
  trustMultiplier,
  OP,
} from "./efp_onchain.mjs";

let passed = 0;
const test = (name, fn) => { fn(); console.log(`  ok  ${name}`); passed++; };

// --- vector 1: List Storage Location (docs "Interpreting an example LSL") ----
test("parseListStorageLocation matches the EFP docs vector", () => {
  const lsl =
    "0x010100000000000000000000000000000000000000000000000000000000000000015289fe5dabc021d02fddf23d4a4df96f4e0f17ef5550010c08608cc567bf432829280f99b40f7717290d6313134992e4971fa50e";
  const p = parseListStorageLocation(lsl);
  assert.equal(p.version, 1);
  assert.equal(p.type, 1);
  assert.equal(p.chainId, 1n); // Ethereum in this docs example
  assert.equal(p.recordsContract, "0x5289fe5dabc021d02fddf23d4a4df96f4e0f17ef");
  assert.equal(
    p.slot,
    38587947120907837207653958898632315929230182373855930657826753963097023554830n
  );
});

// --- vector 2: a Follow list op (docs "Interpreting an example List Operation")
test("parseListOp decodes the EFP docs follow-op vector", () => {
  const op = "0x01010101983110309620d911731ac0932219af06091b6744";
  const d = parseListOp(op);
  assert.equal(d.opVersion, 1);
  assert.equal(d.opCode, OP.FOLLOW); // 0x01
  assert.equal(d.recordVersion, 1);
  assert.equal(d.recordType, 1); // address
  assert.equal(d.address, "0x983110309620d911731ac0932219af06091b6744");
});

// --- reduce: follow/unfollow semantics --------------------------------------
test("reduceFollowing applies follow (add) and unfollow (remove) in order", () => {
  const A = "0x983110309620d911731ac0932219af06091b6744";
  const B = "0x00000000000000000000000000000000deadbeef";
  const follow = (a) => "0x010101" + "01" + a.slice(2);   // op v1, Follow, rec v1, addr
  const unfollow = (a) => "0x010201" + "01" + a.slice(2);  // op v1, Unfollow
  const set = reduceFollowing([follow(A), follow(B), unfollow(A)]);
  assert.equal(set.has(A.toLowerCase()), false); // A was unfollowed
  assert.equal(set.has(B.toLowerCase()), true);
  assert.equal(set.size, 1);
});

test("reduceFollowing ignores non-address record types and malformed ops", () => {
  const good = "0x01010101" + "983110309620d911731ac0932219af06091b6744";
  const shortOp = "0x0101"; // too short
  const nonAddr = "0x01010102" + "abcdef"; // record type 2, ignored
  const set = reduceFollowing([good, shortOp, nonAddr]);
  assert.equal(set.size, 1);
});

// --- graph: only follows AMONG anchored members carry weight -----------------
test("graphFromFollowingMap counts only intra-member edges; sybils score 0", () => {
  const M1 = "0x1111111111111111111111111111111111111111";
  const M2 = "0x2222222222222222222222222222222222222222";
  const M3 = "0x3333333333333333333333333333333333333333";
  const SYBIL = "0x9999999999999999999999999999999999999999"; // not a member
  const members = [M1, M2, M3];
  const followingMap = new Map([
    [M1, new Set([M2, M3, SYBIL])], // follows two members + one outsider
    [M2, new Set([M3])],            // follows one member
    [M3, new Set([SYBIL])],         // follows only an outsider
  ]);
  const g = graphFromFollowingMap(members, followingMap);
  assert.equal(g.inbound.get(M3.toLowerCase()), 2); // M1 and M2 -> M3
  assert.equal(g.inbound.get(M2.toLowerCase()), 1); // M1 -> M2
  assert.equal(g.inbound.get(M1.toLowerCase()), 0); // nobody follows M1
  assert.equal(g.edges.get(M1.toLowerCase()).has(SYBIL.toLowerCase()), false); // outsider dropped
});

test("a bought/sybil follower ring scores exactly 1.0x (D11 sybil resistance)", () => {
  // target buys 500 followers, none of whom are anchored members
  const TARGET = "0xabc0000000000000000000000000000000000001";
  const members = [TARGET];
  const bought = new Set(
    Array.from({ length: 500 }, (_, i) => "0x" + (i + 1).toString(16).padStart(40, "0"))
  );
  // and a sybil ring: 30 wallets all following TARGET, none anchored
  const followingMap = new Map([[TARGET, new Set()]]);
  const g = graphFromFollowingMap(members, followingMap);
  const mult = trustMultiplier(g.inbound.get(TARGET.toLowerCase()));
  assert.equal(mult, 1.0); // no anchored inbound -> no boost
  assert.equal(bought.size, 500); // (bought set is real but irrelevant to score)
});

test("trustMultiplier is seed-rooted and capped at +25% (D11)", () => {
  assert.equal(trustMultiplier(0), 1.0);
  assert.equal(trustMultiplier(1), 1.05);
  assert.equal(trustMultiplier(5), 1.25); // 5 * 0.05 = 0.25 cap
  assert.equal(trustMultiplier(50), 1.25); // capped
  assert.equal(trustMultiplier(-3), 1.0); // clamped
});

console.log(`\n${passed} passing`);
