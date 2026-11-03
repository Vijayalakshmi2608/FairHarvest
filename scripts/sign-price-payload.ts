import "dotenv/config";
import { AbiCoder, Wallet, getBytes, keccak256, getAddress } from "ethers";

/** Signs the exact domain-separated payload expected by PriceOracleAdapter. */
async function main() {
  const privateKey = process.env.AI_ORACLE_PRIVATE_KEY;
  const adapterAddress = process.env.PRICE_ORACLE_ADAPTER_ADDRESS;
  if (!privateKey || !adapterAddress) throw new Error("Set AI_ORACLE_PRIVATE_KEY and PRICE_ORACLE_ADAPTER_ADDRESS");

  const wallet = new Wallet(privateKey);
  const chainId = BigInt(process.env.CHAIN_ID || "1990");
  const timestamp = BigInt(process.env.PRICE_TIMESTAMP || Math.floor(Date.now() / 1000));
  const nonce = BigInt(process.env.PRICE_NONCE || "1");
  const cropType = process.env.PRICE_CROP || "wheat";
  const grade = process.env.PRICE_GRADE || "A";
  const region = process.env.PRICE_REGION || "pilot";
  const priceLow = BigInt(process.env.PRICE_LOW || "80000000000000000000");
  const priceHigh = BigInt(process.env.PRICE_HIGH || "120000000000000000000");
  const confidenceBps = BigInt(process.env.PRICE_CONFIDENCE_BPS || "8500");
  const digest = keccak256(new AbiCoder().encode(["address", "uint256", "string", "string", "string", "uint256", "uint256", "uint256", "uint256", "uint256"], [getAddress(adapterAddress), chainId, cropType, grade, region, priceLow, priceHigh, confidenceBps, timestamp, nonce]));
  const signature = await wallet.signMessage(getBytes(digest));
  console.log(`Oracle signer address: ${wallet.address}`);
  console.log(JSON.stringify({ cropType, grade, region, priceLow: priceLow.toString(), priceHigh: priceHigh.toString(), confidenceBps: confidenceBps.toString(), timestamp: timestamp.toString(), nonce: nonce.toString(), signer: wallet.address, digest, signature }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
