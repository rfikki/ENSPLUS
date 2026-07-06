// Gas snapshot — records deployment + key-call gas so regressions are visible
// (the gwei-names .gas-snapshot practice). Run: npx hardhat run tools/gas_snapshot.js
const { ethers, network } = require("hardhat");
const fs = require("fs");

const E = (n) => ethers.parseEther(String(n));
const rows = [];
async function deployGas(name, factory, args = []) {
  const c = await (await ethers.getContractFactory(factory)).deploy(...args);
  const rc = await c.deploymentTransaction().wait();
  rows.push([`deploy:${name}`, rc.gasUsed]);
  return c;
}

async function main() {
  const [deployer, gov, a, pool] = await ethers.getSigners();
  const ens = await deployGas("MockENS", "MockENS");
  const splitter = await deployGas("RevenueSplitter", "RevenueSplitter", [[pool.address], [10000]]);
  const vault = await deployGas("ENSPLUSVault", "ENSPLUSVault",
    [await ens.getAddress(), gov.address, await splitter.getAddress(), 0n, gov.address]);
  const governor = await deployGas("InternalGovernor", "InternalGovernor", [[
    await vault.getAddress(), ethers.ZeroAddress, 5000, 100, 30 * 86400, 10n ** 9n,
    100, 1000, 1000, 10 * 86400, [2, 3, 5], [500, 1000, 1500],
  ]]);
  const registrar = await deployGas("MockBaseRegistrar", "MockBaseRegistrar");
  const wrapper = await deployGas("MockNameWrapper", "MockNameWrapper");
  const nameVault = await deployGas("NameVault", "NameVault",
    [await governor.getAddress(), await registrar.getAddress(), await wrapper.getAddress(), await splitter.getAddress(), 0n]);
  const helper = await deployGas("MockZKHelper", "MockZKHelper");
  const verifier = await deployGas("MockZKVerifier", "MockZKVerifier", [await helper.getAddress()]);
  await deployGas("HumanAttestor", "HumanAttestor", [await verifier.getAddress(), "ensplus", true]);
  await deployGas("LibTrustHarness", "LibTrustHarness");

  // representative calls
  await ens.mint(a.address, E(1000));
  await ens.connect(a).approve(await vault.getAddress(), ethers.MaxUint256);
  let rc = await (await vault.connect(a).wrap(E(100))).wait();
  rows.push(["call:ENSPLUSVault.wrap", rc.gasUsed]);
  rc = await (await vault.connect(a).unwrap(E(50))).wait();
  rows.push(["call:ENSPLUSVault.unwrap", rc.gasUsed]);

  const out = rows.map(([k, g]) => `${k} ${g}`).join("\n") + "\n";
  fs.writeFileSync(".gas-snapshot", out);
  console.log(out);
  console.log("wrote .gas-snapshot");
}
main().catch((e) => { console.error(e); process.exit(1); });
