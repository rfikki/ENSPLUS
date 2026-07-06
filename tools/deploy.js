// Deterministic genesis deploy blueprint.
// Same deployer + same nonces => same CREATE addresses on every chain (the
// gwei-names cross-chain determinism property). Documents the ONE ordering that
// satisfies every circular dependency:
//   * NameVault.sentinel and .migrationAdapter are born empty (Constitutional
//     fill later) — no cycle at deploy.
//   * Citizen needs the ModuleRegistry address; the Registry's genesis manifest
//     must point at LIVE module bytecode -> deploy modules first, predict the
//     Registry (last), Citizen references the predicted Registry.
//   * TrustOracle reads all registries -> deploy it last.
// Run (dry, in-sandbox): npx hardhat run --no-compile tools/deploy.js
const { ethers } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const WAD = 10n ** 18n;

async function main() {
  const [deployer, govSigner, pool] = await ethers.getSigners();
  const from = deployer.address;
  const at = (nonce) => ethers.getCreateAddress({ from, nonce });
  let nonce = await ethers.provider.getTransactionCount(from);
  const log = (name, addr) => console.log(`  ${name.padEnd(20)} ${addr}`);
  console.log("Genesis deploy (deployer nonce start =", nonce, ")\n");

  // 1. revenue + token vault + governor
  const ens = await (await ethers.getContractFactory("MockENS")).deploy(); await ens.waitForDeployment();
  const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy([pool.address], [10000]); await splitter.waitForDeployment();
  const vault = await (await ethers.getContractFactory("ENSPLUSVault")).deploy(
    await ens.getAddress(), govSigner.address, await splitter.getAddress(), 0n, govSigner.address); await vault.waitForDeployment();
  const gov = await (await ethers.getContractFactory("InternalGovernor")).deploy([
    await vault.getAddress(), ethers.ZeroAddress, 5000, 100, 30 * 86400, 10n ** 9n,
    100, 1000, 1000, 10 * 86400, [2, 3, 5], [500, 1000, 1500]]); await gov.waitForDeployment();
  log("RevenueSplitter", await splitter.getAddress());
  log("ENSPLUSVault", await vault.getAddress());
  log("InternalGovernor", await gov.getAddress());

  // 2. name layer
  const registrar = await (await ethers.getContractFactory("MockBaseRegistrar")).deploy(); await registrar.waitForDeployment();
  const wrapper = await (await ethers.getContractFactory("MockNameWrapper")).deploy(); await wrapper.waitForDeployment();
  const nameVault = await (await ethers.getContractFactory("NameVault")).deploy(
    await gov.getAddress(), await registrar.getAddress(), await wrapper.getAddress(), await splitter.getAddress(), 0n); await nameVault.waitForDeployment();
  log("NameVault", await nameVault.getAddress());

  // 3. constitution + provenance
  const constitution = await (await ethers.getContractFactory("ConstitutionRegistry")).deploy(
    await gov.getAddress(), ["I", "II", "III", "IV"]); await constitution.waitForDeployment();
  const attestor = await (await ethers.getContractFactory("AttestorRegistry")).deploy(
    await gov.getAddress(), await registrar.getAddress(), [4n * WAD, 3n * WAD, 2n * WAD, WAD], []); await attestor.waitForDeployment();
  log("ConstitutionRegistry", await constitution.getAddress());
  log("AttestorRegistry", await attestor.getAddress());

  // 4. Citizen + credit module + ModuleRegistry (predict the registry, deploy last)
  nonce = await ethers.provider.getTransactionCount(from);
  const predictedRegistry = at(nonce + 2); // citizen(nonce) -> pcredits(nonce+1) -> registry(nonce+2)
  const citizen = await (await ethers.getContractFactory("Citizen")).deploy(
    await vault.getAddress(), await nameVault.getAddress(), predictedRegistry); await citizen.waitForDeployment();
  const pcredits = await (await ethers.getContractFactory("ParticipationCredits")).deploy(
    await gov.getAddress(), await citizen.getAddress()); await pcredits.waitForDeployment();
  const FORFEIT = ethers.keccak256(ethers.toUtf8Bytes(
    "ENSPLUS-FORFEITURES-V1: no access to vaulted principal outside holder-initiated flows; no mutation of covenants, splitter percentages, attestation roots, or the constitution; no role grants to third parties on member names; no pause, freeze, or gating of unwrap/exit; no external calls outside a named adapter; no interaction with positions mid-migration."));
  const modReg = await (await ethers.getContractFactory("ModuleRegistry")).deploy(
    await gov.getAddress(), await constitution.getAddress(), [{
      moduleId: "participation-credits", implementation: await pcredits.getAddress(),
      permissions: 1 | 2, articleIds: [1], forfeituresHash: FORFEIT, fullManifestHash: ethers.id("m:pc:v1"),
    }]); await modReg.waitForDeployment();
  if ((await modReg.getAddress()) !== predictedRegistry) throw new Error("registry address prediction FAILED");
  log("Citizen", await citizen.getAddress());
  log("ParticipationCredits", await pcredits.getAddress());
  log("ModuleRegistry", await modReg.getAddress() + "  (== predicted ✓)");

  // 5. renewal pool + protection + observation
  const exec = await (await ethers.getContractFactory("MockRenewalExecutor")).deploy(E("0.002")); await exec.waitForDeployment();
  const renewalPool = await (await ethers.getContractFactory("RenewalPool")).deploy(
    await gov.getAddress(), await nameVault.getAddress(), await exec.getAddress(),
    pool.address, E("0.002"), 1000, E("0.01"), 3, 2, 7 * 86400); await renewalPool.waitForDeployment();
  const sentinel = await (await ethers.getContractFactory("SentinelLock")).deploy(await nameVault.getAddress()); await sentinel.waitForDeployment();
  const watchtower = await (await ethers.getContractFactory("Watchtower")).deploy(
    await nameVault.getAddress(), await registrar.getAddress(), await wrapper.getAddress()); await watchtower.waitForDeployment();
  log("RenewalPool", await renewalPool.getAddress());
  log("SentinelLock", await sentinel.getAddress() + "  (fill NameVault.sentinel via Constitutional proposal)");
  log("Watchtower", await watchtower.getAddress());

  // 6. humanity + trust oracle (reads everything)
  const zkHelper = await (await ethers.getContractFactory("MockZKHelper")).deploy(); await zkHelper.waitForDeployment();
  const zkVerifier = await (await ethers.getContractFactory("MockZKVerifier")).deploy(await zkHelper.getAddress()); await zkVerifier.waitForDeployment();
  const humanAttestor = await (await ethers.getContractFactory("HumanAttestor")).deploy(
    await zkVerifier.getAddress(), "ensplus.domains", false); await humanAttestor.waitForDeployment();
  const oracle = await (await ethers.getContractFactory("TrustOracle")).deploy(
    await attestor.getAddress(), await gov.getAddress(), await nameVault.getAddress(),
    await renewalPool.getAddress(), await citizen.getAddress(), await humanAttestor.getAddress()); await oracle.waitForDeployment();
  log("HumanAttestor", await humanAttestor.getAddress());
  log("TrustOracle", await oracle.getAddress());

  console.log("\nGenesis stack deployed. Post-deploy Constitutional proposals:");
  console.log("  - NameVault.setSentinel(sentinel)   - NameVault.setMigrationAdapter(...) when v2 ships");
}
main().catch((e) => { console.error(e); process.exit(1); });
