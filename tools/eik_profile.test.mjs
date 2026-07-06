// eik_profile.test.mjs — RPC-free unit tests for the EIK profile fallback.
import assert from "node:assert";
import {
  escapeXml,
  truncateAddress,
  generateIdenticon,
  renderProfileCard,
} from "./eik_profile.mjs";

let passed = 0;
const test = (name, fn) => { fn(); console.log(`  ok  ${name}`); passed++; };

test("escapeXml neutralizes all five dangerous characters", () => {
  assert.equal(escapeXml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(escapeXml(null), "");
});

test("truncateAddress shortens long addresses, leaves short ones", () => {
  assert.equal(truncateAddress("0x983110309620d911731ac0932219af06091b6744"), "0x9831…6744");
  assert.equal(truncateAddress("short"), "short");
});

test("generateIdenticon is deterministic per address and differs across addresses", () => {
  const a = generateIdenticon("0x983110309620d911731ac0932219af06091b6744");
  const a2 = generateIdenticon("0x983110309620d911731ac0932219af06091b6744");
  const b = generateIdenticon("0x1111111111111111111111111111111111111111");
  assert.equal(a.svg, a2.svg); // deterministic
  assert.equal(a.fg, a2.fg);
  assert.notEqual(a.svg, b.svg); // address-dependent
  assert.match(a.svg, /^<g>/); // valid fragment
});

test("identicon is horizontally symmetric (mirrored columns)", () => {
  const { svg } = generateIdenticon("0xabcdef0000000000000000000000000000001234", { cell: 10, grid: 5 });
  // count rects at x=0 and x=40 (col 0 and mirrored col 4) — should match
  const at = (x) => (svg.match(new RegExp(`x="${x}"`, "g")) || []).length;
  assert.equal(at(0), at(40));
});

test("renderProfileCard produces a standalone SVG with the identity fields", () => {
  const svg = renderProfileCard({
    address: "0x983110309620d911731ac0932219af06091b6744",
    name: "vitalik.eth",
    nameVerified: true,
    records: { description: "hello world", "com.twitter": "VitalikButerin" },
    efp: { following: 137 },
  });
  assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
  assert.match(svg, /vitalik\.eth/);
  assert.match(svg, /VitalikButerin/);
  assert.match(svg, /following/);
  assert.match(svg, /137/);
  assert.match(svg, /resolved on-chain · ENSPLUS/);
});

test("INJECTION: a hostile ENS record cannot break out of the SVG", () => {
  const evil = 'x</text><script>alert(document.cookie)</script><text>';
  const svg = renderProfileCard({
    address: "0x1111111111111111111111111111111111111111",
    name: evil,
    records: { description: evil, "com.twitter": evil },
    efp: { following: 0 },
  });
  // no raw executable/markup-breaking payload survives
  assert.ok(!svg.includes("<script>"), "raw <script> must not appear");
  assert.ok(!svg.includes("</text><script>"), "must not break out of text");
  assert.ok(svg.includes("&lt;script&gt;"), "payload must be escaped");
});

test("unnamed address falls back to a truncated-address title and identicon", () => {
  const svg = renderProfileCard({
    address: "0xabcdef0000000000000000000000000000001234",
    name: null,
    records: {},
    efp: { following: 0 },
  });
  assert.match(svg, /0xabcd…1234/);
  assert.ok(!svg.includes("<image"), "no external avatar image when unnamed (identicon used)");
});

test("anchoredFollowers stat renders only when present", () => {
  const withA = renderProfileCard({ address: "0x1111111111111111111111111111111111111111", records: {}, efp: { following: 3, anchoredFollowers: 7 } });
  const without = renderProfileCard({ address: "0x1111111111111111111111111111111111111111", records: {}, efp: { following: 3 } });
  assert.match(withA, /anchored followers/);
  assert.ok(!without.includes("anchored followers"));
});

console.log(`\n${passed} passing`);
