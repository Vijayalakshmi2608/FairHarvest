import { Wallet } from "ethers";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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

function isValidPrivateKey(value: string | undefined): value is string {
  return Boolean(value && /^0x[0-9a-fA-F]{64}$/.test(value));
}

let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : (existsSync(examplePath) ? readFileSync(examplePath, "utf8") : "");
const existingKey = getValue(content, "PRIVATE_KEY");
let wallet: { address: string; privateKey: string };
let preserved = false;

if (isValidPrivateKey(existingKey) && !force) {
  wallet = new Wallet(existingKey);
  preserved = true;
} else {
  if (force && existingKey) console.warn("WARNING: --force requested; replacing the existing deployer key.");
  wallet = Wallet.createRandom();
}

content = setValue(content, "PRIVATE_KEY", wallet.privateKey);
content = setValue(content, "DEPLOYER_ADDRESS", wallet.address);
writeFileSync(envPath, content, { mode: 0o600 });
chmodSync(envPath, 0o600);

if (preserved) console.log("existing deployer key detected, preserving");
console.log(`Deployer address: ${wallet.address}`);
console.log("Key written to .env — not displayed.");
