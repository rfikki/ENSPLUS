#!/usr/bin/env node
/**
 * tools/build.js — compile all contracts with the npm-bundled solc 0.8.26 and
 * emit Hardhat-format artifacts into artifacts/.
 *
 * Why this exists: sandboxed/offline environments can't fetch compilers from
 * binaries.soliditylang.org. This script produces artifacts identical in shape
 * to Hardhat's, so `npx hardhat test --no-compile` runs anywhere.
 * On a normal dev machine you can ignore it and just run `npx hardhat test`
 * (hardhat.config.js pins the same 0.8.26 + settings, so outputs match).
 */
const solc = require("solc");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "contracts");
const OUT = path.join(ROOT, "artifacts");

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".sol")) yield p;
  }
}

const sources = {};
for (const f of walk(SRC)) {
  const rel = path.relative(ROOT, f).split(path.sep).join("/");
  sources[rel] = { content: fs.readFileSync(f, "utf8") };
}

function findImport(importPath) {
  const tryPaths = [
    path.join(ROOT, "node_modules", importPath),
    path.join(ROOT, importPath),
  ];
  for (const p of tryPaths)
    if (fs.existsSync(p)) return { contents: fs.readFileSync(p, "utf8") };
  return { error: `import not found: ${importPath}` };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
const errors = (out.errors ?? []).filter((e) => e.severity === "error");
const warnings = (out.errors ?? []).filter((e) => e.severity === "warning");
for (const w of warnings) console.log("WARN:", w.formattedMessage.split("\n")[0]);
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}

let n = 0;
for (const [sourceName, contracts] of Object.entries(out.contracts)) {
  if (!sourceName.startsWith("contracts/")) continue; // skip node_modules artifacts
  for (const [contractName, c] of Object.entries(contracts)) {
    const dir = path.join(OUT, sourceName);
    fs.mkdirSync(dir, { recursive: true });
    const artifact = {
      _format: "hh-sol-artifact-1",
      contractName,
      sourceName,
      abi: c.abi,
      bytecode: "0x" + (c.evm.bytecode.object || ""),
      deployedBytecode: "0x" + (c.evm.deployedBytecode.object || ""),
      linkReferences: {},
      deployedLinkReferences: {},
    };
    fs.writeFileSync(path.join(dir, `${contractName}.json`), JSON.stringify(artifact, null, 2));
    n++;
  }
}
console.log(`compiled ${Object.keys(sources).length} sources -> ${n} artifacts (solc ${solc.version()})`);
