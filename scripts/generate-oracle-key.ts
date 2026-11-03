import { Wallet } from "ethers";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const envPath = resolve(root, ".env");
const examplePath = resolve(root, ".env.example");
const force = process.argv.includes("--force");

function getValue(content: string, name: string): string | undefined {
  const line = content.split(/\r?\n/).find((item) => item.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || undefined;
}

function setValue(content: string, name: string, value: string): string {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${name}=`));
  if (index >= 0) lines[index] = `${name}=${value}`;
  else lines.push(`${name}=${value}`);
  return lines.join("\n").replace(/\n*$/, "\n");
}

let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : readFileSync(examplePath, "utf8");
const existingKey = getValue(content, "AI_ORACLE_PRIVATE_KEY");
let wallet: { address: string; privateKey: string };
let preserved = false;

if (existingKey && !force) {
  try {
    wallet = new Wallet(existingKey);
    preserved = true;
  } catch {
    wallet = Wallet.createRandom();
  }
} else {
  wallet = Wallet.createRandom();
}

content = setValue(content, "AI_ORACLE_PRIVATE_KEY", wallet.privateKey);
content = setValue(content, "AI_ORACLE_ADDRESS", wallet.address);
writeFileSync(envPath, content, { mode: 0o600 });
if (preserved) console.log("existing oracle key detected, preserving");
console.log(`Oracle address: ${wallet.address}`);
if (!preserved) console.log("private key written to .env — not displayed");
