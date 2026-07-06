// ensplus-utils — the ENSPLUS SDK.
// One import for: EFP follows (on-chain, no hosted API), ENS+EFP profile
// resolution + card rendering, and live L1-native reputation via the on-chain
// TrustOracle. Pure helpers need no RPC; the client wraps an ethers v6 provider.

export * as efp from "../efp_onchain.mjs";
export * as profile from "../eik_profile.mjs";
export * as trust from "../libtrust_mirror.mjs";

import { getFollowing, buildTrustGraph } from "../efp_onchain.mjs";
import { resolveProfile, renderProfileCard } from "../eik_profile.mjs";

// Minimal ABIs for the live on-chain reads.
const ORACLE_ABI = [
  "function reputationOf(address member, bytes label) view returns (uint256)",
  "function multiplierOf(address member, bytes label) view returns (uint256)",
  "function breakdownOf(address member, bytes label) view returns (uint256 provenance, uint256 tenure, uint256 participation, uint256 category, uint256 reputation, uint256 multiplierWad)",
];
const HUMAN_ABI = ["function isVerifiedHuman(address account) view returns (bool)"];

/**
 * createEnsplusClient({ ethers, providers, addresses })
 *   ethers     — the ethers v6 module
 *   providers  — { mainnet|1, base|8453, [10] } ethers providers
 *   addresses  — { trustOracle?, humanAttestor? } deployed addresses
 * Returns a convenience client. All methods are read-only.
 */
export function createEnsplusClient({ ethers, providers, addresses = {} }) {
  const mainnet = providers.mainnet ?? providers[1];
  const base = providers.base ?? providers[8453];
  const efpProviders = { 8453: base, ...(providers[10] ? { 10: providers[10] } : {}), ...(mainnet ? { 1: mainnet } : {}) };
  const utf8 = (s) => (typeof s === "string" ? ethers.toUtf8Bytes(s) : s);

  const oracle = addresses.trustOracle && mainnet
    ? new ethers.Contract(addresses.trustOracle, ORACLE_ABI, mainnet)
    : null;
  const human = addresses.humanAttestor && mainnet
    ? new ethers.Contract(addresses.humanAttestor, HUMAN_ABI, mainnet)
    : null;

  return {
    // --- identity ---
    async getFollowing(address) { return getFollowing(ethers, efpProviders, address); },
    async buildTrustGraph(members, opts) { return buildTrustGraph(ethers, efpProviders, members, opts); },
    async resolveProfile(address, opts) { return resolveProfile(ethers, providers, address, opts); },
    renderProfileCard(profileObj, opts) { return renderProfileCard(profileObj, opts); },

    // --- live reputation (requires trustOracle address) ---
    async reputationOf(member, label) {
      if (!oracle) throw new Error("trustOracle address not configured");
      return oracle.reputationOf(member, utf8(label));
    },
    async multiplierOf(member, label) {
      if (!oracle) throw new Error("trustOracle address not configured");
      return oracle.multiplierOf(member, utf8(label));
    },
    async breakdownOf(member, label) {
      if (!oracle) throw new Error("trustOracle address not configured");
      const b = await oracle.breakdownOf(member, utf8(label));
      return {
        provenance: b.provenance, tenure: b.tenure, participation: b.participation,
        category: b.category, reputation: b.reputation, multiplierWad: b.multiplierWad,
      };
    },
    async isVerifiedHuman(address) {
      if (!human) throw new Error("humanAttestor address not configured");
      return human.isVerifiedHuman(address);
    },

    // --- full profile: identity + live reputation + humanity, one call ---
    async fullProfile(address, label) {
      const p = await resolveProfile(ethers, providers, address, {});
      if (oracle && label) {
        try {
          const b = await oracle.breakdownOf(address, utf8(label));
          p.reputation = { value: b.reputation, multiplierWad: b.multiplierWad };
        } catch { /* not a member's name */ }
      }
      if (human) { try { p.verifiedHuman = await human.isVerifiedHuman(address); } catch {} }
      return p;
    },
  };
}
