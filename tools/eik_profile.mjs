// eik_profile.mjs
// -----------------------------------------------------------------------------
// ENSPLUS EIK (Ethereum Identity Kit) fallback: resolve + render an identity
// profile entirely from on-chain sources, with NO dependency on ethid.org's
// hosted EIK library or API (winding down 2026-07).
//
// TWO HALVES
//   resolveProfile(...)  — async, on-chain: ENS primary name (reverse, forward-
//                          verified), ENS text records (avatar/bio/socials/...),
//                          and EFP following (via efp_onchain.mjs). ENS lives on
//                          Ethereum L1; EFP follows live on Base — both read
//                          directly from chain. Uses ethers v6 (caller-supplied
//                          providers; Rocky runs it live).
//   renderProfileCard(...) — PURE: a resolved profile -> a SELF-CONTAINED SVG
//                          card (no external CSS/JS/fonts, no network fetch).
//                          Avatar defaults to a deterministic on-chain identicon
//                          derived from the address; a real avatar URL can be
//                          embedded if the caller passes one.
//
// SECURITY: ENS names and text records are ATTACKER-CONTROLLED strings. Every
// dynamic value is XML-escaped before it enters the SVG (SVG/HTML-injection
// defense — the "every label is hostile input" rule from the metadata-service
// and Specimen Plate work). Escaping is unit-tested with an injection payload.
// -----------------------------------------------------------------------------

import { getFollowing } from "./efp_onchain.mjs";

// ---- pure helpers -----------------------------------------------------------
/** Strict XML/SVG escape for attacker-controlled strings. */
export function escapeXml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** 0x1234…abcd short form. */
export function truncateAddress(addr, lead = 6, tail = 4) {
  const a = String(addr);
  if (a.length <= lead + tail + 2) return a;
  return `${a.slice(0, lead)}…${a.slice(-tail)}`;
}

function addrBytes(address) {
  const h = String(address).toLowerCase().replace(/^0x/, "").padStart(40, "0");
  const b = [];
  for (let i = 0; i < 40; i += 2) b.push(parseInt(h.slice(i, i + 2), 16));
  return b;
}

/**
 * Deterministic on-chain identicon (blockie-style, horizontally symmetric).
 * Same address -> same art, always; no external data. Returns an SVG <g> plus
 * derived colors so the card can theme itself from the identity.
 */
export function generateIdenticon(address, { cell = 14, grid = 5 } = {}) {
  const b = addrBytes(address);
  const hue = Math.floor((b[0] * 360) / 255);
  const fg = `hsl(${hue} 58% 48%)`;
  const bg = `hsl(${hue} 45% 94%)`;
  const half = Math.ceil(grid / 2);
  let rects = "";
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < half; x++) {
      const idx = y * half + x;
      const on = (b[idx % b.length] >> (idx % 8)) & 1;
      if (!on) continue;
      for (const xx of new Set([x, grid - 1 - x])) {
        rects += `<rect x="${xx * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="${fg}"/>`;
      }
    }
  }
  const dim = grid * cell;
  return { svg: `<g>${rects}</g>`, bg, fg, hue, dim };
}

function wrapLines(text, maxChars, maxLines) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // ellipsize if truncated
  const joined = lines.join(" ");
  if (joined.length < String(text ?? "").trim().length && lines.length) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/.$/, "…");
  }
  return lines;
}

/**
 * Render a resolved profile to a self-contained SVG card string.
 * opts.avatarHref: an http(s)/data URI to embed instead of the identicon.
 */
export function renderProfileCard(profile, opts = {}) {
  const W = 460, H = 210, PAD = 22;
  const addr = String(profile.address || "");
  const ident = generateIdenticon(addr);
  const name = profile.name ? escapeXml(profile.name) : escapeXml(truncateAddress(addr));
  const verified = !!profile.nameVerified;
  const records = profile.records || {};
  const bioLines = wrapLines(records.description || "", 52, 2).map(escapeXml);
  const following = Number(profile?.efp?.following || 0);
  const anchoredFollowers = profile?.efp?.anchoredFollowers;

  const avatarSize = 96, ax = PAD, ay = PAD;
  const avatar = opts.avatarHref
    ? `<image x="${ax}" y="${ay}" width="${avatarSize}" height="${avatarSize}" href="${escapeXml(opts.avatarHref)}" clip-path="url(#clip)" preserveAspectRatio="xMidYMid slice"/>`
    : `<g transform="translate(${ax},${ay})" clip-path="url(#clip)"><rect width="${avatarSize}" height="${avatarSize}" fill="${ident.bg}"/><g transform="translate(${(avatarSize - ident.dim) / 2},${(avatarSize - ident.dim) / 2})">${ident.svg}</g></g>`;

  const tx = ax + avatarSize + 20;
  const check = verified
    ? `<g transform="translate(${tx + name.length * 11 + 8}, 34)"><circle r="8" fill="${ident.fg}"/><path d="M-3.5 0 L-1 2.5 L3.5 -3" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`
    : "";

  const socials = [];
  if (records["com.twitter"]) socials.push(`𝕏 ${escapeXml(records["com.twitter"])}`);
  if (records["com.github"]) socials.push(`gh ${escapeXml(records["com.github"])}`);
  if (records["url"]) socials.push(escapeXml(records["url"]));
  const socialLine = socials.slice(0, 2).join("   ");

  const stat = (label, val, x) =>
    `<g transform="translate(${x},${H - PAD - 14})"><text font-family="ui-sans-serif,system-ui,sans-serif" font-size="17" font-weight="700" fill="#111">${val}</text><text y="15" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" fill="#777">${label}</text></g>`;

  let bioSvg = "";
  bioLines.forEach((l, i) => {
    bioSvg += `<text x="${tx}" y="${86 + i * 18}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" fill="#555">${l}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="ENS/EFP profile card for ${name}">
  <defs><clipPath id="clip"><rect width="${avatarSize}" height="${avatarSize}" rx="20"/></clipPath></defs>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="#ffffff" stroke="#e6e6e6"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="6" rx="3" fill="${ident.fg}"/>
  ${avatar}
  <text x="${tx}" y="40" font-family="ui-sans-serif,system-ui,sans-serif" font-size="22" font-weight="700" fill="#111">${name}</text>
  ${check}
  <text x="${tx}" y="62" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="12" fill="#999">${escapeXml(truncateAddress(addr, 10, 8))}</text>
  ${bioSvg}
  <text x="${tx}" y="${H - PAD - 30}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="12" fill="#666">${socialLine}</text>
  ${stat("following", following, tx)}
  ${anchoredFollowers !== undefined ? stat("anchored followers", anchoredFollowers, tx + 110) : ""}
  <text x="${W - PAD}" y="${H - PAD - 2}" text-anchor="end" font-family="ui-sans-serif,system-ui,sans-serif" font-size="10" fill="#bbb">resolved on-chain · ENSPLUS</text>
</svg>`;
}

// ---- async on-chain resolver ------------------------------------------------
const DEFAULT_KEYS = [
  "avatar", "description", "display", "header", "url",
  "com.twitter", "com.github", "org.telegram", "email", "location",
];

/**
 * Resolve a full identity profile from chain.
 * providers: { mainnet | 1: <L1 provider>, base | 8453: <Base provider>, ... }
 * ENS (name + records) resolves on L1; EFP following resolves on Base.
 */
export async function resolveProfile(ethers, providers, address, opts = {}) {
  const mainnet = providers.mainnet ?? providers[1];
  const base = providers.base ?? providers[8453];
  const out = {
    address: address.toLowerCase(),
    name: null,
    nameVerified: false,
    records: {},
    avatar: null,
    efp: { primaryList: null, following: 0 },
  };

  if (mainnet) {
    const name = await mainnet.lookupAddress(address).catch(() => null);
    if (name) {
      out.name = name;
      const fwd = await mainnet.resolveName(name).catch(() => null);
      out.nameVerified = !!fwd && fwd.toLowerCase() === address.toLowerCase();
      const resolver = await mainnet.getResolver(name).catch(() => null);
      if (resolver) {
        for (const k of opts.textKeys ?? DEFAULT_KEYS) {
          const v = await resolver.getText(k).catch(() => null);
          if (v) out.records[k] = v;
        }
        out.avatar = out.records.avatar ?? null;
      }
    }
  }

  if (base) {
    const efpProviders = { 8453: base };
    if (providers[10]) efpProviders[10] = providers[10];
    if (mainnet) efpProviders[1] = mainnet;
    const r = await getFollowing(ethers, efpProviders, address).catch(() => null);
    if (r) {
      out.efp.primaryList = r.tokenId ? r.tokenId.toString() : null;
      out.efp.following = r.following.size;
    }
  }

  return out;
}

// ---- CLI --------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const has = (k) => args.includes(k);

  if (has("--demo")) {
    // render a card from a canned profile (no RPC) — for eyeballing the fallback
    const demo = {
      address: "0x983110309620d911731ac0932219af06091b6744",
      name: "vitalik.eth",
      nameVerified: true,
      records: {
        description: "Ethereum. Trying to make the world a bit more free, open, and decentralized.",
        "com.twitter": "VitalikButerin",
        url: "https://vitalik.eth.limo",
      },
      efp: { primaryList: "1", following: 137, anchoredFollowers: 42 },
    };
    process.stdout.write(renderProfileCard(demo));
    return;
  }

  const ethRpc = get("--rpc-eth"), baseRpc = get("--rpc-base"), address = get("--address");
  if (!ethRpc || !address) {
    console.log(`EIK profile fallback (on-chain ENS + EFP; no hosted API).

Demo card (no RPC):
  node eik_profile.mjs --demo > card.svg

Live:
  node eik_profile.mjs --rpc-eth <L1rpc> --rpc-base <BaseRpc> --address 0xUSER > card.svg
  (prints the resolved profile JSON to stderr and the SVG card to stdout)`);
    return;
  }
  const { ethers } = await import("ethers");
  const providers = { mainnet: new ethers.JsonRpcProvider(ethRpc) };
  if (baseRpc) providers.base = new ethers.JsonRpcProvider(baseRpc);
  const profile = await resolveProfile(ethers, providers, address);
  console.error(JSON.stringify(profile, null, 2));
  process.stdout.write(renderProfileCard(profile, { avatarHref: opts_httpAvatar(profile) }));
}

function opts_httpAvatar(profile) {
  const a = profile?.avatar;
  return a && /^https?:\/\//.test(a) ? a : undefined; // only embed safe http(s) avatars
}

import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
