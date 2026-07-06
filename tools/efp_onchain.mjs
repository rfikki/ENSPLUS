// efp_onchain.mjs
// -----------------------------------------------------------------------------
// ENSPLUS on-chain EFP reader.
//
// Reads the Ethereum Follow Protocol social graph DIRECTLY from its on-chain
// contracts (Base / OP / Ethereum), with NO dependency on the hosted
// api.ethfollow.xyz indexer. This exists because ethid.org is winding down its
// hosted services (2026-07): the EFP *protocol* and its data live on-chain and
// survive that sunset — only the convenience API goes away — so ENSPLUS reads
// the source of truth itself.
//
// WHY OUTBOUND READS SUFFICE FOR THE TRUST GRAPH
// The ENSPLUS trust score only counts follows FROM provenance-anchored citizens
// (a bounded, known set). "Who does address X follow" (outbound) is cheap to
// read from a single list slot. "Who follows X" (inbound) would need a global
// index — but we never need the global inbound set: we iterate the KNOWN
// anchored members, read each one's outbound following, and intersect. So the
// whole trust graph is computable from O(members) cheap reads. No indexer.
//
// DATA FLOW (per docs.efp.app):
//   address --getValue(addr,'primary-list')--> tokenId            [AccountMetadata, Base]
//   tokenId --getListStorageLocation(tokenId)--> LSL bytes         [ListRegistry, Base]
//   LSL = version|type|chainId(32)|recordsContract(20)|slot(32)
//   slot  --getListOps(slot,...)--> raw ops                         [ListRecords, LSL.chain]
//   reduce ops (0x01 Follow add / 0x02 Unfollow remove) -> following set
//
// The pure decode/reduce/graph functions below are RPC-free and unit-tested
// against the vectors published in the EFP docs. The async functions take an
// ethers v6 provider (Rocky supplies a Base RPC; sandbox has no Base egress).
// -----------------------------------------------------------------------------

// ---- EFP deployments (docs.efp.app/production/deployments) -------------------
export const EFP = {
  8453: { // Base — the follow graph's primary home
    accountMetadata: "0x5289fE5daBC021D02FDDf23d4a4DF96F4E0F17EF",
    listRegistry: "0x0E688f5DCa4a0a4729946ACbC44C792341714e08",
    listRecords: "0x41Aa48Ef3c0446b46a5b1cc6337FF3d3716E2A33",
  },
  10: { listRecords: "0x4Ca00413d850DcFa3516E14d21DAE2772F2aCb85" }, // OP Mainnet
  1: { listRecords: "0x5289fE5daBC021D02FDDf23d4a4DF96F4E0F17EF" },  // Ethereum
};

// op codes and record types (docs.efp.app/design/list-ops, /list-records)
export const OP = { FOLLOW: 0x01, UNFOLLOW: 0x02, TAG: 0x03, UNTAG: 0x04 };
export const RECORD_TYPE_ADDRESS = 0x01;

// ---- pure hex helpers (no deps) ---------------------------------------------
function strip0x(h) { return h.startsWith("0x") ? h.slice(2) : h; }
function bytesLen(h) { return strip0x(h).length / 2; }
function sliceHex(h, startByte, endByte) {
  const s = strip0x(h);
  return "0x" + s.slice(startByte * 2, endByte * 2);
}
function lc(addr) { return addr.toLowerCase(); }

/**
 * Parse a List Storage Location bytes value.
 * Layout: version(1) type(1) chainId(32) recordsContract(20) slot(32) = 86 bytes.
 */
export function parseListStorageLocation(hex) {
  const n = bytesLen(hex);
  if (n !== 86) throw new Error(`bad LSL length ${n}, expected 86`);
  const version = parseInt(sliceHex(hex, 0, 1), 16);
  const type = parseInt(sliceHex(hex, 1, 2), 16);
  const chainId = BigInt(sliceHex(hex, 2, 34));
  const recordsContract = sliceHex(hex, 34, 54);
  const slot = BigInt(sliceHex(hex, 54, 86));
  return { version, type, chainId, recordsContract: lc(recordsContract), slot };
}

/**
 * Parse a single List Op (as stored per slot).
 * Layout: opVersion(1) opCode(1) recordVersion(1) recordType(1) recordData(...).
 * For a Follow/Unfollow of an address record, recordData is a 20-byte address.
 */
export function parseListOp(hex) {
  const n = bytesLen(hex);
  if (n < 4) return null;
  const opVersion = parseInt(sliceHex(hex, 0, 1), 16);
  const opCode = parseInt(sliceHex(hex, 1, 2), 16);
  const recordVersion = parseInt(sliceHex(hex, 2, 3), 16);
  const recordType = parseInt(sliceHex(hex, 3, 4), 16);
  let address = null;
  if (recordType === RECORD_TYPE_ADDRESS && n >= 24) {
    address = lc(sliceHex(hex, 4, 24)); // 20-byte address record
  }
  return { opVersion, opCode, recordVersion, recordType, address };
}

/**
 * Reduce a chronological array of raw ops into the current outbound following
 * set. Follow adds, Unfollow removes; Tag/Untag do not change follow membership
 * (a future refinement could honor "block"/"mute" tags to exclude edges).
 */
export function reduceFollowing(ops) {
  const set = new Set();
  for (const opHex of ops) {
    const op = parseListOp(opHex);
    if (!op || op.recordType !== RECORD_TYPE_ADDRESS || !op.address) continue;
    if (op.opCode === OP.FOLLOW) set.add(op.address);
    else if (op.opCode === OP.UNFOLLOW) set.delete(op.address);
  }
  return set;
}

/**
 * Build the intra-member follow graph from a map of each member's outbound
 * following. PURE — this is the core the trust score runs on. Self-follows and
 * follows outside the member set are dropped (only follows among anchored
 * citizens carry trust weight, which is what makes bought/sybil followers
 * worthless: they are not anchored members).
 */
export function graphFromFollowingMap(members, followingMap) {
  const memberSet = new Set(members.map(lc));
  const edges = new Map();
  const inbound = new Map([...memberSet].map((m) => [m, 0]));
  for (const m of memberSet) {
    const raw = followingMap.get(m) || new Set();
    const within = new Set([...raw].map(lc).filter((a) => memberSet.has(a) && a !== m));
    edges.set(m, within);
  }
  for (const [, followed] of edges) {
    for (const f of followed) inbound.set(f, (inbound.get(f) || 0) + 1);
  }
  return { memberSet, edges, inbound };
}

/**
 * Trust multiplier from intra-member inbound follows. Mirrors design decision
 * D11: seed-rooted, capped at +25%. Only follows from anchored members count
 * (enforced upstream in graphFromFollowingMap), so a sybil ring or bought
 * followers score exactly 1.0x.
 */
export function trustMultiplier(inboundCount, { perFollow = 0.05, cap = 0.25 } = {}) {
  return 1 + Math.min(cap, Math.max(0, inboundCount) * perFollow);
}

// ---- async on-chain reads (ethers v6; supplied by caller) -------------------
const ACCOUNT_METADATA_ABI = ["function getValue(address addr, string key) view returns (bytes)"];
const LIST_REGISTRY_ABI = ["function getListStorageLocation(uint256 tokenId) view returns (bytes)"];
const LIST_RECORDS_ABI = [
  "function getListOpCount(uint256 slot) view returns (uint256)",
  "function getListOps(uint256 slot, uint256 start, uint256 end) view returns (bytes[])",
];

/** Resolve an address to its primary EFP list tokenId (or null). */
export async function resolvePrimaryList(ethers, baseProvider, address) {
  const am = new ethers.Contract(EFP[8453].accountMetadata, ACCOUNT_METADATA_ABI, baseProvider);
  const val = await am.getValue(address, "primary-list");
  if (!val || val === "0x" || bytesLen(val) < 32) return null;
  return BigInt(bytesLen(val) === 32 ? val : "0x" + strip0x(val).slice(-64));
}

/** Read a list's storage location (chain, records contract, slot). */
export async function getListStorageLocation(ethers, baseProvider, tokenId) {
  const reg = new ethers.Contract(EFP[8453].listRegistry, LIST_REGISTRY_ABI, baseProvider);
  return parseListStorageLocation(await reg.getListStorageLocation(tokenId));
}

/** Read + reduce all ops for a slot into the outbound following set. */
export async function getFollowingByList(ethers, recordsProvider, recordsContract, slot, page = 1000) {
  const rec = new ethers.Contract(recordsContract, LIST_RECORDS_ABI, recordsProvider);
  const total = Number(await rec.getListOpCount(slot));
  const ops = [];
  for (let i = 0; i < total; i += page) {
    const end = Math.min(i + page, total);
    ops.push(...(await rec.getListOps(slot, i, end)));
  }
  return reduceFollowing(ops);
}

/**
 * Full outbound resolution for one address. `providers` maps chainId -> ethers
 * provider; Base (8453) is required, others optional (most lists live on Base).
 */
export async function getFollowing(ethers, providers, address) {
  const base = providers[8453];
  const tokenId = await resolvePrimaryList(ethers, base, address);
  if (tokenId === null) return { address: lc(address), tokenId: null, following: new Set() };
  const lsl = await getListStorageLocation(ethers, base, tokenId);
  const recProvider = providers[Number(lsl.chainId)] || base;
  const following = await getFollowingByList(ethers, recProvider, lsl.recordsContract, lsl.slot);
  return { address: lc(address), tokenId, storage: lsl, following };
}

/**
 * Build the anchored-member trust graph entirely from outbound reads.
 * `members` is the provenance-anchored citizen address set. Returns the graph
 * plus a per-member trust multiplier. No hosted API, no global index.
 */
export async function buildTrustGraph(ethers, providers, members, opts = {}) {
  const followingMap = new Map();
  for (const m of members) {
    try {
      const { following } = await getFollowing(ethers, providers, m);
      followingMap.set(lc(m), following);
    } catch (e) {
      followingMap.set(lc(m), new Set()); // unresolved member contributes nothing
    }
  }
  const graph = graphFromFollowingMap(members, followingMap);
  const multipliers = new Map(
    [...graph.inbound].map(([m, c]) => [m, trustMultiplier(c, opts)])
  );
  return { ...graph, multipliers };
}

// ---- CLI demo (only runs the RPC path when --rpc is supplied) ----------------
async function main() {
  const args = process.argv.slice(2);
  const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const rpc = get("--rpc");
  const address = get("--address");
  const members = get("--members");

  if (!rpc) {
    console.log(`EFP on-chain reader (no hosted API).

Pure functions (no RPC) are unit-tested in efp_onchain.test.mjs.

Live usage (supply a Base RPC):
  node efp_onchain.mjs --rpc <baseRpcUrl> --address 0xUSER
  node efp_onchain.mjs --rpc <baseRpcUrl> --members 0xA,0xB,0xC

Contracts (Base 8453):
  AccountMetadata ${EFP[8453].accountMetadata}
  ListRegistry    ${EFP[8453].listRegistry}
  ListRecords     ${EFP[8453].listRecords}`);
    return;
  }

  const { ethers } = await import("ethers");
  const providers = { 8453: new ethers.JsonRpcProvider(rpc) };
  const opRpc = get("--rpc-op"), ethRpc = get("--rpc-eth");
  if (opRpc) providers[10] = new ethers.JsonRpcProvider(opRpc);
  if (ethRpc) providers[1] = new ethers.JsonRpcProvider(ethRpc);

  if (members) {
    const set = members.split(",").map((s) => s.trim());
    const g = await buildTrustGraph(ethers, providers, set);
    console.log("Anchored-member trust graph:");
    for (const [m, c] of g.inbound) {
      console.log(`  ${m}  inbound=${c}  x${g.multipliers.get(m).toFixed(2)}`);
    }
  } else if (address) {
    const r = await getFollowing(ethers, providers, address);
    console.log(`${address}: primary list ${r.tokenId ?? "(none)"}, following ${r.following.size} accounts`);
    if (r.storage) console.log(`  storage: chain ${r.storage.chainId}, records ${r.storage.recordsContract}, slot ${r.storage.slot}`);
  } else {
    console.log("provide --address or --members");
  }
}

// run as CLI only (not when imported by the test)
import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
