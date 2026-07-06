// smoke tests: SDK surface + pure re-exports (no RPC).
import assert from "node:assert";
import { efp, profile, trust, createEnsplusClient } from "./index.mjs";

let passed = 0;
const test = (n, f) => { f(); console.log(`  ok  ${n}`); passed++; };

test("re-exports the three tool namespaces", () => {
  assert.equal(typeof efp.parseListStorageLocation, "function");
  assert.equal(typeof profile.renderProfileCard, "function");
  assert.equal(typeof trust.reputation, "function");
});

test("pure trust mirror composes through the SDK", () => {
  const t = { provenanceWad: 4n * 10n ** 18n, rank: 1n, tenureSecs: 0n, bankedYears: 0n, epochsActive: 0n, epochsSinceJoin: 0n, credits: 0n, categoryBits: 0n, verifiedHuman: true };
  const rep = trust.reputation(t);
  assert.ok(rep > 0n && rep <= 10000n);
  assert.equal(trust.trustMultiplierWad(t), 10n ** 18n + (rep * (10n ** 18n / 4n)) / 10000n);
});

test("pure profile card renders and is injection-safe through the SDK", () => {
  const svg = profile.renderProfileCard({ address: "0x1111111111111111111111111111111111111111", name: "x</text><script>bad</script>", records: {}, efp: { following: 0 } });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(!svg.includes("<script>"));
});

test("createEnsplusClient builds without RPC and guards missing addresses", async () => {
  const fakeEthers = { toUtf8Bytes: (s) => new Uint8Array(Buffer.from(s)) };
  const c = createEnsplusClient({ ethers: fakeEthers, providers: {}, addresses: {} });
  assert.equal(typeof c.reputationOf, "function");
  await assert.rejects(() => c.reputationOf("0x0", "alice"), /trustOracle address not configured/);
});

console.log(`\n${passed} passing`);
