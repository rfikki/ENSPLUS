#!/usr/bin/env node
/**
 * ENSPLUS trust-graph scoring prototype (social module v1, threat row T7 reference)
 * ---------------------------------------------------------------------------------
 * Computes provenance-seeded trust scores over the EFP social graph.
 *
 * Core property: ONLY edges rooted in the SEED SET (provenance-anchored citizens,
 * e.g. attested prepunk holders) confer trust. Raw follower counts are worthless
 * by construction; a million purchased followers score exactly zero.
 *
 * Model (parameters mirror the on-chain stub in the social charter):
 *   hop-1:  t1(a) = SUM over seeds s following a of  w(s) / sqrt(outdeg(s))
 *   hop-2:  t2(a) = SUM over hop-1-trusted b (t1(b) >= THETA, non-seed) following a
 *                   of  min(t1(b),1) * BETA / sqrt(outdeg(b))
 *   raw    = t1 + t2
 *   multiplier = 1 + BONUS_CAP * (1 - exp(-raw / LAMBDA))   // smooth, hard-capped
 *
 * Design notes:
 *  - sqrt out-degree damping: a seed following 5,000 accounts confers ~1/70th the
 *    per-edge trust of a seed following 1. Prevents trust spraying.
 *  - blocked/muted edges are excluded entirely (EFP semantics).
 *  - BONUS_CAP = 0.25: the score can NEVER exceed a +25% multiplier — it is a
 *    bonus signal layered on provenance weighting, never a substitute (charter
 *    rule: inactive in governance until a separate T2 activation vote).
 *
 * Modes:
 *   node efp_trustgraph.mjs --demo
 *       Runs against a built-in synthetic graph (organic citizens + a sybil ring
 *       + a bought-followers attacker) to demonstrate the security properties.
 *       Works offline. Run this first.
 *
 *   node efp_trustgraph.mjs --live --seeds seeds.json [--hops 2] [--out scores.json]
 *       Crawls the public EFP API (api.ethfollow.xyz) from your machine.
 *       seeds.json: [{"address":"0x...","weight":1.0,"label":"optional"}, ...]
 *       In production the seed set derives from the attestation data: every
 *       Citizen whose provenance weight clears a threshold, weights normalized.
 *       Be polite to the public API: this script caches to ./efp_cache/ and
 *       rate-limits to ~4 req/s. For big seed sets, self-host the indexer
 *       (EFP Railway template) and pass --api <your-url>.
 *
 * Verified response shape (live fetch, 2026-07-04):
 *   GET {API}/users/{addressOrName}/following  -> { following: [ {address|data, tags, ...} ] }
 *   GET {API}/users/{addressOrName}/followers  -> { followers: [ {address, tags, is_blocked, is_muted, ...} ] }
 * Pagination via ?limit=&offset= ; confirm field names against your API version --
 * some deployments return the followed target under `data` rather than `address`
 * on /following records (the script handles both).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

// ---------------------------------------------------------------- parameters
const P = {
  ALPHA: 0.5,      // out-degree damping exponent (sqrt)
  BETA: 0.30,      // hop-2 attenuation
  THETA: 0.15,     // hop-1 trust threshold to qualify as a hop-2 propagator
  LAMBDA: 2.0,     // saturation constant
  BONUS_CAP: 0.25, // hard cap on governance bonus (+25% max) -- charter constant
  PAGE: 500,       // API page size
  RPS: 4,          // polite crawl rate
};

// ---------------------------------------------------------------- scoring core
// graph: Map(follower -> Set(followed))   (blocked/muted edges pre-excluded)
export function scoreGraph(graph, seeds) {
  const seedW = new Map(seeds.map((s) => [s.address.toLowerCase(), s.weight]));
  const outdeg = new Map();
  for (const [f, set] of graph) outdeg.set(f, set.size);
  const damp = (a) => Math.pow(Math.max(outdeg.get(a) ?? 1, 1), P.ALPHA);

  const t1 = new Map();
  for (const [f, set] of graph) {
    const w = seedW.get(f);
    if (w === undefined) continue;
    for (const target of set) {
      if (seedW.has(target)) continue; // seeds don't need scores
      t1.set(target, (t1.get(target) ?? 0) + w / damp(f));
    }
  }

  const t2 = new Map();
  for (const [f, set] of graph) {
    if (seedW.has(f)) continue;
    const tb = t1.get(f) ?? 0;
    if (tb < P.THETA) continue;
    const conf = (Math.min(tb, 1) * P.BETA) / damp(f);
    for (const target of set) {
      if (seedW.has(target) || target === f) continue;
      t2.set(target, (t2.get(target) ?? 0) + conf);
    }
  }

  const scores = new Map();
  const all = new Set([...t1.keys(), ...t2.keys()]);
  for (const a of all) {
    const raw = (t1.get(a) ?? 0) + (t2.get(a) ?? 0);
    const multiplier = 1 + P.BONUS_CAP * (1 - Math.exp(-raw / P.LAMBDA));
    scores.set(a, {
      t1: +(t1.get(a) ?? 0).toFixed(4),
      t2: +(t2.get(a) ?? 0).toFixed(4),
      raw: +raw.toFixed(4),
      multiplier: +multiplier.toFixed(4),
    });
  }
  return scores;
}

// ---------------------------------------------------------------- demo mode
function demoGraph() {
  const graph = new Map();
  const follow = (a, b) => {
    a = a.toLowerCase(); b = b.toLowerCase();
    if (!graph.has(a)) graph.set(a, new Set());
    graph.get(a).add(b);
  };
  const seeds = Array.from({ length: 8 }, (_, i) => ({
    address: `0xseed${String(i).padStart(2, "0")}`,
    weight: i < 3 ? 1.0 : 0.6, // 3 prepunk-tier, 5 auction-tier
    label: i < 3 ? `prepunk-citizen-${i}` : `auction-citizen-${i}`,
  }));
  const citizens = Array.from({ length: 40 }, (_, i) => `0xcitizen${String(i).padStart(2, "0")}`);
  const sybils = Array.from({ length: 30 }, (_, i) => `0xsybil${String(i).padStart(2, "0")}`);
  const attacker = "0xattacker00";
  const bots = Array.from({ length: 500 }, (_, i) => `0xbot${String(i).padStart(3, "0")}`);

  // organic: each seed follows 6-14 citizens (deterministic pseudo-random)
  let x = 42;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (const s of seeds) {
    const n = 6 + Math.floor(rnd() * 9);
    const picked = new Set();
    while (picked.size < n) picked.add(citizens[Math.floor(rnd() * citizens.length)]);
    for (const c of picked) follow(s.address, c);
    // seeds also follow a couple of other seeds (no effect on scores)
    follow(s.address, seeds[Math.floor(rnd() * seeds.length)].address);
  }
  // citizens follow each other a bit (hop-2 substrate)
  for (const c of citizens) {
    const n = 2 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) follow(c, citizens[Math.floor(rnd() * citizens.length)]);
  }
  // sybil ring: 30 wallets all follow each other and the attacker; zero seed edges
  for (const s1 of sybils) {
    for (const s2 of sybils) if (s1 !== s2) follow(s1, s2);
    follow(s1, attacker);
  }
  // bought followers: 500 fresh wallets follow the attacker
  for (const b of bots) follow(b, attacker);

  return { graph, seeds, cohorts: { citizens, sybils, attacker } };
}

function runDemo() {
  const { graph, seeds, cohorts } = demoGraph();
  const scores = scoreGraph(graph, seeds);
  const get = (a) => scores.get(a.toLowerCase()) ?? { t1: 0, t2: 0, raw: 0, multiplier: 1 };

  const cite = cohorts.citizens.map((c) => ({ a: c, ...get(c) })).sort((p, q) => q.raw - p.raw);
  const syb = cohorts.sybils.map((c) => ({ a: c, ...get(c) }));
  const atk = get(cohorts.attacker);

  console.log("=== ENSPLUS trust-graph demo ===\n");
  console.log("Seed set: 8 provenance-anchored citizens (3 prepunk w=1.0, 5 auction w=0.6)\n");
  console.log("Top 10 organic citizens (seed-rooted trust):");
  console.log("  address          t1      t2      raw     multiplier");
  for (const r of cite.slice(0, 10))
    console.log(`  ${r.a.padEnd(14)} ${String(r.t1).padEnd(7)} ${String(r.t2).padEnd(7)} ${String(r.raw).padEnd(7)} ${r.multiplier}x`);

  const sybMax = Math.max(...syb.map((r) => r.multiplier));
  console.log(`\nSybil ring (30 wallets, 870 intra-ring follows, 0 seed edges):`);
  console.log(`  max multiplier in ring: ${sybMax}x   (expected: 1.0 -- no seed-rooted path)`);
  console.log(`\nAttacker with 500 bought followers + sybil ring backing:`);
  console.log(`  t1=${atk.t1} t2=${atk.t2} multiplier=${atk.multiplier}x   (expected: 1.0)`);
  const floor = cite[cite.length - 1];
  console.log(`\nLowest-scored organic citizen: ${floor.multiplier}x (raw=${floor.raw})`);
  console.log(`Hard cap check: no multiplier may exceed ${1 + P.BONUS_CAP}x ->`,
    Math.max(...[...scores.values()].map((s) => s.multiplier)) <= 1 + P.BONUS_CAP ? "PASS" : "FAIL");
  console.log("\nProperty demonstrated: trust flows ONLY from provenance-anchored seeds.");
  console.log("Follower volume without seed-rooted paths scores exactly zero.\n");
}

// ---------------------------------------------------------------- live mode
async function fetchJSON(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function following(api, addr, cacheDir) {
  const key = `${cacheDir}/following_${addr.toLowerCase()}.json`;
  if (existsSync(key)) return JSON.parse(readFileSync(key, "utf8"));
  const out = [];
  for (let offset = 0; ; offset += P.PAGE) {
    const j = await fetchJSON(`${api}/users/${addr}/following?limit=${P.PAGE}&offset=${offset}`);
    const rows = j.following ?? [];
    for (const r of rows) {
      if (r.is_blocked || r.is_muted) continue;
      const target = (r.address ?? r.data ?? "").toLowerCase();
      if (target.startsWith("0x")) out.push(target);
    }
    if (rows.length < P.PAGE) break;
    await new Promise((r) => setTimeout(r, 1000 / P.RPS));
  }
  writeFileSync(key, JSON.stringify(out));
  return out;
}

async function runLive(args) {
  const api = args.api ?? "https://api.ethfollow.xyz/api/v1";
  const hops = Number(args.hops ?? 2);
  const seeds = JSON.parse(readFileSync(args.seeds, "utf8"));
  const cacheDir = "./efp_cache";
  mkdirSync(cacheDir, { recursive: true });

  const graph = new Map();
  console.log(`Crawling hop-1: ${seeds.length} seeds ...`);
  const hop1Targets = new Set();
  for (const s of seeds) {
    const f = await following(api, s.address, cacheDir);
    graph.set(s.address.toLowerCase(), new Set(f));
    f.forEach((t) => hop1Targets.add(t));
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1000 / P.RPS));
  }
  console.log(`\nhop-1 frontier: ${hop1Targets.size} accounts`);

  if (hops >= 2) {
    // provisional t1 to pick qualified propagators before crawling their lists
    const prelim = scoreGraph(graph, seeds);
    const propagators = [...hop1Targets].filter((a) => (prelim.get(a)?.t1 ?? 0) >= P.THETA);
    console.log(`Crawling hop-2: ${propagators.length} qualified propagators ...`);
    for (const a of propagators) {
      graph.set(a, new Set(await following(api, a, cacheDir)));
      process.stdout.write(".");
      await new Promise((r) => setTimeout(r, 1000 / P.RPS));
    }
    console.log();
  }

  const scores = scoreGraph(graph, seeds);
  const ranked = [...scores.entries()].sort((a, b) => b[1].raw - a[1].raw);
  const outFile = args.out ?? "scores.json";
  writeFileSync(outFile, JSON.stringify(Object.fromEntries(ranked), null, 2));
  console.log(`\nScored ${ranked.length} accounts -> ${outFile}\nTop 15:`);
  for (const [a, s] of ranked.slice(0, 15))
    console.log(`  ${a}  raw=${s.raw}  x${s.multiplier}`);
}

// ---------------------------------------------------------------- entry
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++)
  if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? true : argv[++i];

if (args.demo) runDemo();
else if (args.live) runLive(args).catch((e) => { console.error(e); process.exit(1); });
else console.log("usage: node efp_trustgraph.mjs --demo | --live --seeds seeds.json [--hops 2] [--api URL] [--out scores.json]");
