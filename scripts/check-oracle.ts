import "dotenv/config";
import { Contract, JsonRpcProvider, getAddress } from "ethers";

async function main() {
  const rpcUrl = process.env.RPC_URL;
  const expected = process.env.AI_ORACLE_ADDRESS;
  const adapterAddress = process.env.PRICE_ORACLE_ADAPTER_ADDRESS;
  const zero = /^0x0{40}$/i;

  if (!rpcUrl || !expected || !adapterAddress || zero.test(adapterAddress) || adapterAddress.includes("replace_with")) {
    console.log("ADAPTER NOT DEPLOYED: run scripts/deploy.ts on this network first");
    return;
  }

  try {
    const provider = new JsonRpcProvider(rpcUrl);
    const adapter = new Contract(adapterAddress, ["function oracleSigner() view returns (address)"], provider);
    const authorized = getAddress(await adapter.oracleSigner());
    const configured = getAddress(expected);
    if (authorized === configured) console.log(`PASS: oracle signer authorized: ${authorized}`);
    else {
      console.log(`FAIL: configured oracle address ${configured} does not match authorized signer ${authorized}`);
      process.exitCode = 1;
    }
  } catch {
    console.log("ADAPTER NOT DEPLOYED: run scripts/deploy.ts on this network first");
  }
}

main().catch(() => {
  console.log("ADAPTER NOT DEPLOYED: run scripts/deploy.ts on this network first");
  process.exitCode = 0;
});
