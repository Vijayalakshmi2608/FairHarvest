import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";

dotenv.config({ path: "../.env" });

const privateKey = process.env.PRIVATE_KEY;
const accounts = privateKey && privateKey !== "replace_with_deployer_private_key" ? [privateKey] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true }
  },
  paths: {
    sources: "./src"
  },
  networks: {
    hardhat: {},
    qie: {
      url: process.env.RPC_URL || "https://rpc1mainnet.qie.digital",
      chainId: Number(process.env.CHAIN_ID || 1990),
      accounts
    },
    qieTestnet: {
      url: process.env.TESTNET_RPC_URL || "https://rpc2testnet.qie.digital",
      chainId: 1983,
      accounts
    }
  },
  etherscan: {
    apiKey: process.env.EXPLORER_API_KEY || ""
  }
};

export default config;
