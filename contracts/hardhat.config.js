require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

/** ENSPLUS — Hardhat config
 *  solc pinned to 0.8.26 (project standard, matches LNR V5 toolchain).
 *  Sandbox note: offline environments compile via `node tools/build.js`
 *  and run `npx hardhat test --no-compile`; normal machines just `npx hardhat test`.
 */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  paths: { sources: "./contracts", tests: "./test", artifacts: "./artifacts" },
  mocha: { timeout: 120000 },
};
