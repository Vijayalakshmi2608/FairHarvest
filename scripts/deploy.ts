import "dotenv/config";
import { ethers } from "hardhat";
import { getAddress } from "ethers";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const oracleAddress = process.env.AI_ORACLE_ADDRESS;
  const stablecoin = process.env.QIE_STABLECOIN_ADDRESS;
  if (!oracleAddress || oracleAddress.includes("replace_with") || !stablecoin || /^0x0{40}$/i.test(stablecoin)) {
    throw new Error("Set AI_ORACLE_ADDRESS and deployed QIE_STABLECOIN_ADDRESS before deployment");
  }
  const arbiter = process.env.ARBITER_ADDRESS || deployer.address;
  const feeBps = Number(process.env.PLATFORM_FEE_BPS || 100);

  const Index = await ethers.getContractFactory("PriceIndex");
  const index = await Index.deploy(deployer.address, oracleAddress);
  await index.waitForDeployment();
  const Registry = await ethers.getContractFactory("ListingRegistry");
  const registry = await Registry.deploy(deployer.address);
  await registry.waitForDeployment();
  const Reputation = await ethers.getContractFactory("Reputation");
  const reputation = await Reputation.deploy(deployer.address);
  await reputation.waitForDeployment();
  const Adapter = await ethers.getContractFactory("PriceOracleAdapter");
  const adapter = await Adapter.deploy(deployer.address, oracleAddress, index.target);
  await adapter.waitForDeployment();
  const Escrow = await ethers.getContractFactory("OrderEscrow");
  const escrow = await Escrow.deploy(deployer.address, arbiter, stablecoin, registry.target, reputation.target, index.target, feeBps);
  await escrow.waitForDeployment();

  await (await registry.setOrderEscrow(escrow.target)).wait();
  await (await registry.setPriceIndex(index.target)).wait();
  await (await index.setEscrow(escrow.target)).wait();
  await (await index.setAdapter(adapter.target)).wait();
  await (await reputation.setEscrow(escrow.target)).wait();

  const signerRole = await adapter.ORACLE_SIGNER_ROLE();
  await (await adapter.grantRole(signerRole, oracleAddress)).wait();
  const authorized = getAddress(await adapter.oracleSigner());
  const configured = getAddress(oracleAddress);
  if (authorized !== configured) throw new Error(`Oracle authorization mismatch: configured ${configured}, authorized ${authorized}`);

  const network = await ethers.provider.getNetwork();
  const deployment = {
    chainId: network.chainId.toString(),
    deployer: deployer.address,
    oracleAddress: configured,
    priceIndex: index.target,
    listingRegistry: registry.target,
    reputation: reputation.target,
    priceOracleAdapter: adapter.target,
    orderEscrow: escrow.target,
    stablecoin,
    authorizedOracleSigner: authorized,
  };
  writeFileSync(resolve(process.cwd(), "../deployment.json"), JSON.stringify(deployment, null, 2) + "\n");
  console.log(`Deployment verified; oracle signer authorized: ${authorized}`);
  console.log("Wrote deployment.json");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "deployment failed"); process.exitCode = 1; });
