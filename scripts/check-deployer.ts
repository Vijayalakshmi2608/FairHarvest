import { config as loadDotenv } from "dotenv";
import { JsonRpcProvider, Wallet, formatEther } from "ethers";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const MAINNET_RPC = "https://rpc1mainnet.qie.digital";
const TESTNET_RPC = "https://rpc2testnet.qie.digital";

function rpcFlag(): string | undefined {
  const index = process.argv.indexOf("--rpc");
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--rpc requires a URL");
  return value;
}

function isRetryableRpcError(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string; message?: string }; message?: string };
  const text = [candidate.code, candidate.cause?.code, candidate.message, candidate.cause?.message].filter(Boolean).join(" ").toLowerCase();
  return /tls|socket|econnreset|econnrefused|etimedout|timeout|network|fetch failed|connection/.test(text);
}

function wait(milliseconds: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function readBalance(rpcUrl: string, chainId: number, address: string): Promise<bigint> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
      const balance = await provider.getBalance(address);
      provider.destroy();
      return balance;
    } catch (error) {
      lastError = error;
      if (attempt === 0 && isRetryableRpcError(error)) await wait(2000);
      else break;
    }
  }
  if (isRetryableRpcError(lastError)) throw new Error(`RPC_UNREACHABLE: ${rpcUrl}`);
  throw new Error(`RPC_ERROR: ${rpcUrl}`);
}

async function main() {
  const root = process.cwd();
  const envPath = resolve(root, ".env");
  if (existsSync(envPath)) loadDotenv({ path: envPath });

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("A valid PRIVATE_KEY is required in .env");
  const chainId = Number(process.env.CHAIN_ID || "1990");
  const rpcUrl = rpcFlag() || (chainId === 1983 ? process.env.TESTNET_RPC_URL || TESTNET_RPC : process.env.RPC_URL || MAINNET_RPC);
  const wallet = new Wallet(privateKey);
  const balance = await readBalance(rpcUrl, chainId, wallet.address);

  console.log(`Deployer address: ${wallet.address}`);
  console.log(`Network chain ID: ${chainId}`);
  console.log(`Balance: ${formatEther(balance)} QIE`);
  console.log(balance > 0n ? "READY" : "FUND_NEEDED");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "deployer balance check failed"); process.exitCode = 1; });
