#!/usr/bin/env node
/**
 * ENSPLUS Adoption & Threshold Model
 * ----------------------------------
 * Answers the go/no-go question Rocky posed: "only small holders would join, so
 * can we do anything against Nick + Labs?" It converts wrapped-ENS levels into
 * governance-impact tiers, using the fact established in the design review:
 *
 *   The internal quadratic/cap math governs the bloc's DIRECTION.
 *   The bloc's EXTERNAL firepower = the raw SUM of wrapped ENS (1 token = 1 vote
 *   at the ENS governor), undiminished by the internal fairness rules.
 *
 * So impact scales with TOTAL ENS WRAPPED, not with holder count — a thousand
 * small holders wrapping N tokens cast N votes as one delegate.
 *
 * IMPORTANT (post-2026-07 reframe): the ENS DAO is itself moving to rate-limit
 * its Endowment (intent-free ~5%/yr cap). If that passes, the treasury-DRAIN
 * risk that motivated part of ENSPLUS is ~95% mitigated BY THE DAO. This model
 * therefore weights the surviving value props: vote concentration, participation
 * apathy, and (above all) name-level protection — NOT treasury drain.
 *
 * All figures are ESTIMATES with sources noted; override via --flags or edit
 * ASSUMPTIONS. This is a planning instrument, not a promise. Re-run with live
 * delegation data before genesis.
 *
 * Usage:
 *   node adoption_model.mjs
 *   node adoption_model.mjs --nick 3260000 --active 6500000 --supply 100000000
 *   node adoption_model.mjs --wrapped 2000000        # evaluate a single level
 */

// ---------------------------------------------------------------- assumptions
const ASSUMPTIONS = {
  // ENS total supply (fixed, on-chain fact).
  supply: 100_000_000,
  // Nick's effective controlled/aligned voting weight on a contested vote.
  // Source: 2026 governance crisis reporting (~3.26M ENS ~= 80% of a contested
  // vote, ~50% of delegated supply). Treat as the "opposition wall" to clear.
  nick: 3_260_000,
  // Actively-delegated/participating ENS (the real battlefield; << supply).
  // Source: design-context figure ~6.5M actively delegated of 100M.
  active: 6_500_000,
  // Typical winning margin on a NON-crisis proposal (turnout is low, so a few
  // hundred K routinely decides ordinary votes). Used for the "swing ordinary
  // votes" line.
  ordinarySwing: 400_000,
  // Quorum for ENS executable proposals is 1% of supply = 1,000,000 ENS.
  // Source: ENS governor GovernorVotesQuorumFraction (~1%). Being ABLE to
  // single-handedly satisfy quorum is itself a governance capability.
  quorum: 1_000_000,
};

// --------------------------------------------------------------------- parse
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val !== undefined && !val.startsWith("--")) { out[key] = Number(val.replace(/_/g, "")); i++; }
      else out[key] = true;
    }
  }
  return out;
}
const args = parseArgs(process.argv);
const A = {
  supply: args.supply ?? ASSUMPTIONS.supply,
  nick: args.nick ?? ASSUMPTIONS.nick,
  active: args.active ?? ASSUMPTIONS.active,
  ordinarySwing: args.ordinarySwing ?? ASSUMPTIONS.ordinarySwing,
  quorum: args.quorum ?? ASSUMPTIONS.quorum,
};

const fmt = (n) => Math.round(n).toLocaleString("en-US");
const pctOfSupply = (n) => ((n / A.supply) * 100).toFixed(2) + "% of supply";
const pctOfActive = (n) => ((n / A.active) * 100).toFixed(1) + "% of active";

// ------------------------------------------------------------------ thresholds
// Each tier: the wrapped-ENS level at which a NEW governance capability unlocks,
// plus what it does and does NOT let ENSPLUS do. Ordered ascending.
function thresholds() {
  return [
    {
      name: "Seedling — a real delegate",
      level: 100_000,
      unlocks: "Enters the top tier of ENS delegates (many active delegates sit in the 100K-range). A visible, credible voice with a public voting record.",
      cannot: "Cannot swing contested votes or block anything alone.",
    },
    {
      name: "Quorum-maker",
      level: A.quorum,
      unlocks: `Can single-handedly satisfy the ~1% executable quorum (${fmt(A.quorum)}). ENSPLUS can force proposals to a real count and guarantee turnout on protective measures — a structural role even without a majority.`,
      cannot: "Cannot defeat Nick head-to-head; he still out-weighs the bloc.",
    },
    {
      name: "Swing bloc — ordinary votes",
      level: A.nick - A.ordinarySwing, // enough that, with normal opposition, ordinary votes flip
      unlocks: "On normal (non-crisis) proposals where Nick is not maximally mobilized, the bloc's coordinated weight plus ambient opposition decides outcomes. ENSPLUS becomes the pivotal vote most of the time.",
      cannot: "On a maximally-contested vote with Nick fully mobilized, still short.",
    },
    {
      name: "Blocking counterweight",
      level: A.nick,
      unlocks: `Matches Nick's contested-vote weight (${fmt(A.nick)}). ENSPLUS can deadlock or defeat a unilateral move, especially on actions needing broad consensus or supermajority. The capture calculus changes: nothing passes over organized objection.`,
      cannot: "Parity, not dominance — outcomes become contests, not foregone.",
    },
    {
      name: "Decisive majority",
      level: A.nick * 1.6, // clear Nick + typical aligned weight with margin
      unlocks: "Exceeds Nick + typically-aligned weight with margin. ENSPLUS can drive outcomes affirmatively, not just block. The bloc is the DAO's center of gravity.",
      cannot: "Requires aggregating several million ENS from a dispersed long tail — a hard, long-game adoption target.",
    },
  ];
}

// ------------------------------------------------------------------- evaluate
function evaluate(wrapped) {
  const ts = thresholds();
  let reached = null;
  for (const t of ts) if (wrapped >= t.level) reached = t;
  const next = ts.find((t) => wrapped < t.level);
  return { reached, next };
}

// ---------------------------------------------------------------------- render
function line(w = 78) { return "-".repeat(w); }

function printHeader() {
  console.log(line());
  console.log("ENSPLUS ADOPTION & THRESHOLD MODEL");
  console.log(line());
  console.log(`Supply:            ${fmt(A.supply)} ENS`);
  console.log(`Nick (contested):  ${fmt(A.nick)} ENS   (${pctOfSupply(A.nick)})`);
  console.log(`Active delegation: ${fmt(A.active)} ENS   (${pctOfSupply(A.active)})`);
  console.log(`Executable quorum: ${fmt(A.quorum)} ENS   (~1% of supply)`);
  console.log(line());
  console.log("KEY IDENTITY: external firepower = SUM of wrapped ENS (full weight,");
  console.log("1 token = 1 vote). Internal quadratic/cap sets DIRECTION, not size.");
  console.log("So impact scales with TOTAL WRAPPED, independent of holder count.");
  console.log(line());
}

function printLadder() {
  console.log("\nTHRESHOLD LADDER (wrapped ENS -> capability)\n");
  for (const t of thresholds()) {
    console.log(`  ${t.name}`);
    console.log(`    at >= ${fmt(t.level)} ENS  (${pctOfSupply(t.level)}, ${pctOfActive(t.level)})`);
    console.log(`    UNLOCKS: ${t.unlocks}`);
    console.log(`    LIMIT:   ${t.cannot}\n`);
  }
}

function printScenarios() {
  const scenarios = [250_000, 500_000, 1_000_000, 2_000_000, 3_260_000, 5_000_000];
  console.log(line());
  console.log("SCENARIOS\n");
  for (const w of scenarios) {
    const { reached, next } = evaluate(w);
    const cap = reached ? reached.name : "(below the delegate line)";
    const toNext = next ? `${fmt(next.level - w)} more -> ${next.name}` : "at the top tier";
    console.log(`  ${fmt(w).padStart(11)} ENS  |  ${cap}`);
    console.log(`  ${" ".repeat(11)}       |  next: ${toNext}`);
    console.log(`  ${" ".repeat(11)}       |  = ${pctOfActive(w)}, ${pctOfSupply(w)}\n`);
  }
}

function printThesis() {
  console.log(line());
  console.log("READING (honest go/no-go)");
  console.log(line());
  console.log(`
Mattering as a VOICE/FLOOR is achievable at hundreds of thousands of wrapped
ENS. DOMINATING Nick + Labs is a several-million-ENS, long-game target and is
NOT realistic near-term. That gradient is the whole answer to "only small
holders join": the number of holders never caps firepower — the SUM of their
tokens does, and it casts at full weight externally.

The theory of change is therefore NOT "out-hold the founder." It is:
  1. Raise the cost of capture (organized, watching resistance deters and forces
     negotiation; Nick backing down is a win requiring no majority).
  2. Provide a floor, not a throne (Standing Orders defend the few things that
     matter; a coordinated NO + fence-sitters defeats broad-consensus grabs).
  3. Catalyze turnout (bring millions of always-on votes + wake dormant
     delegates; the crisis vote was won on LOW turnout — change the denominator).
  4. Grow via utility (renewal/theft/provenance recruit; governance compounds).

POST-2026-07 REFRAME: with the DAO now moving to rate-limit its own Endowment,
LEAD the pitch with name-level protection + vote concentration + participation.
De-emphasize treasury drain: the DAO is closing that hole itself, which VALIDATES
the ENSPLUS philosophy but removes it as a unique selling point.

THE REAL RISK: if the achievable ceiling is only a few hundred thousand ENS,
ENSPLUS is a utility + protest product, not a governance counterweight. Size the
adoption funnel with LIVE delegation data before genesis and decide the
governance thesis on that number, not on hope.
`);
  console.log(line());
}

// --------------------------------------------------------------------- main
printHeader();
if (args.wrapped) {
  const { reached, next } = evaluate(args.wrapped);
  console.log(`\nEVALUATING ${fmt(args.wrapped)} ENS wrapped (${pctOfActive(args.wrapped)}, ${pctOfSupply(args.wrapped)}):\n`);
  console.log(`  capability: ${reached ? reached.name : "(below the delegate line)"}`);
  if (reached) console.log(`  unlocks:    ${reached.unlocks}`);
  if (next) console.log(`  to next:    ${fmt(next.level - args.wrapped)} more ENS -> ${next.name}`);
  console.log("");
} else {
  printLadder();
  printScenarios();
  printThesis();
}
