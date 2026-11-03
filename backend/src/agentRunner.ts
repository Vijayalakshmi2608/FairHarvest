import { randomUUID } from "node:crypto";
import { Contract, JsonRpcProvider, Wallet, parseUnits } from "ethers";
import { verifyMessage } from "ethers";
import { z } from "zod";
import type { Store } from "./db.js";
import type { AppConfig } from "./config.js";
import { now } from "./db.js";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const restockRuleSchema = z.object({
  crop: z.string().min(1).max(80),
  thresholdKg: z.number().positive(),
  buyUpToKg: z.number().positive(),
  maxPricePerKg: z.number().positive(),
  maxSpend: z.number().positive(),
  expiresAt: z.number().int().positive(),
  signer: addressSchema,
  executor: addressSchema.optional(),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
});
export type RestockRule = z.infer<typeof restockRuleSchema>;

function canonicalRule(rule: RestockRule) {
  return JSON.stringify({
    crop: rule.crop,
    thresholdKg: rule.thresholdKg,
    buyUpToKg: rule.buyUpToKg,
    maxPricePerKg: rule.maxPricePerKg,
    maxSpend: rule.maxSpend,
    expiresAt: rule.expiresAt,
    executor: rule.executor || rule.signer,
  });
}

export type AgentAction = {
  status: "skipped" | "ready" | "submitted";
  reason: string;
  farmer?: string;
  listingId?: string;
  quantityKg?: number;
  pricePerKg?: number;
  total?: number;
  txHash?: string;
};

type Candidate = { id: bigint; farmer: string; quantityKg: bigint; price: bigint; score: number };

const registryAbi = [
  "function nextListingId() view returns (uint256)",
  "function getListing(uint256) view returns (uint256 id,address farmer,string cropType,string grade,uint256 quantityKg,uint64 harvestDate,string region,uint256 minPrice,uint8 status)",
];
const stablecoinAbi = [
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
];
const escrowAbi = [
  "function createOrder(uint256 listingId,uint256 quantityKg,uint256 agreedPricePerKg) returns (uint256 orderId)",
];

export function verifyRestockRule(rule: RestockRule, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parsed = restockRuleSchema.parse(rule);
  if (parsed.expiresAt <= nowSeconds) throw new Error("restock rule expired");
  if (parsed.buyUpToKg * parsed.maxPricePerKg > parsed.maxSpend) throw new Error("restock rule exceeds its maximum spend cap");
  const recovered = verifyMessage(canonicalRule(parsed), parsed.signature);
  if (recovered.toLowerCase() !== parsed.signer.toLowerCase()) throw new Error("restock rule signature does not match signer");
  return parsed;
}

function saveAction(store: Store, rule: RestockRule, action: AgentAction) {
  store.prepare(`INSERT INTO agent_actions(id,rule_id,merchant_address,crop,status,reason,farmer_address,listing_id,quantity_kg,price_per_kg,total_amount,tx_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    randomUUID(), rule.signer.toLowerCase(), rule.signer.toLowerCase(), rule.crop, action.status, action.reason, action.farmer?.toLowerCase() || null, action.listingId || null,
    action.quantityKg?.toString() || null, action.pricePerKg?.toString() || null, action.total?.toString() || null, action.txHash || null, now(),
  );
  return action;
}

function stockFor(store: Store, merchant: string, crop: string) {
  return store.prepare("SELECT stock_kg FROM agent_inventory WHERE merchant_address=? AND lower(crop)=lower(?)").get(merchant.toLowerCase(), crop) as { stock_kg: number } | undefined;
}

function reputationScore(store: Store, address: string) {
  const row = store.prepare("SELECT rating_total, rating_count FROM reputation WHERE address=?").get(address.toLowerCase()) as { rating_total: number; rating_count: number } | undefined;
  return row && row.rating_count > 0 ? row.rating_total / row.rating_count : 0;
}

async function findCandidate(store: Store, config: AppConfig, rule: RestockRule, provider: JsonRpcProvider): Promise<Candidate | undefined> {
  if (!config.REGISTRY_ADDRESS) return undefined;
  const registry = new Contract(config.REGISTRY_ADDRESS, registryAbi, provider);
  const nextId = Number(await registry.nextListingId());
  const maxPrice = parseUnits(String(rule.maxPricePerKg), config.STABLECOIN_DECIMALS);
  const candidates: Candidate[] = [];
  for (let id = 1; id < nextId; id += 1) {
    try {
      const listing = await registry.getListing(id);
      if (Number(listing.status) !== 0 || String(listing.cropType).toLowerCase() !== rule.crop.toLowerCase()) continue;
      const quantityKg = BigInt(listing.quantityKg.toString());
      const price = BigInt(listing.minPrice.toString());
      if (quantityKg <= 0n || price > maxPrice) continue;
      candidates.push({ id: BigInt(id), farmer: String(listing.farmer), quantityKg, price, score: reputationScore(store, String(listing.farmer)) });
    } catch {
      // A listing can disappear between nextListingId and getListing; skip it safely.
    }
  }
  return candidates.sort((a, b) => b.score - a.score || Number(a.price - b.price))[0];
}

async function submitCappedOrder(config: AppConfig, rule: RestockRule, candidate: Candidate, quantityKg: number, total: bigint, provider: JsonRpcProvider) {
  const scopedKey = config.AGENT_EXECUTOR_PRIVATE_KEY;
  if (!scopedKey || !config.ESCROW_ADDRESS || !config.STABLECOIN_ADDRESS) return undefined;
  const executor = new Wallet(scopedKey, provider);
  const expectedExecutor = (rule.executor || rule.signer).toLowerCase();
  if (executor.address.toLowerCase() !== expectedExecutor) throw new Error("scoped executor does not match the signed merchant rule");
  const stablecoin = new Contract(config.STABLECOIN_ADDRESS, stablecoinAbi, executor);
  const balance = BigInt((await stablecoin.balanceOf(executor.address)).toString());
  if (balance < total) throw new Error("scoped executor stablecoin balance is below the signed spend cap");
  const allowance = BigInt((await stablecoin.allowance(executor.address, config.ESCROW_ADDRESS)).toString());
  if (allowance < total) {
    const approval = await stablecoin.approve(config.ESCROW_ADDRESS, total);
    await approval.wait();
  }
  const escrow = new Contract(config.ESCROW_ADDRESS, escrowAbi, executor);
  const tx = await escrow.createOrder(candidate.id, quantityKg, candidate.price);
  const receipt = await tx.wait();
  return receipt.hash as string;
}

export async function runRestockOnce(store: Store, config: AppConfig, rule: RestockRule, submitOrder?: (listingId: string, quantityKg: number, pricePerKg: number) => Promise<string>): Promise<AgentAction> {
  const verified = verifyRestockRule(rule);
  const inventory = stockFor(store, verified.signer, verified.crop);
  if (!inventory) return saveAction(store, verified, { status: "skipped", reason: "no inventory record for merchant crop" });
  if (inventory.stock_kg >= verified.thresholdKg) return saveAction(store, verified, { status: "skipped", reason: `stock ${inventory.stock_kg}kg is at or above the ${verified.thresholdKg}kg trigger` });
  if (!config.RPC_URL || !config.REGISTRY_ADDRESS) return saveAction(store, verified, { status: "ready", reason: "mainnet registry/RPC is not configured; no transaction submitted" });

  const provider = new JsonRpcProvider(config.RPC_URL, config.CHAIN_ID, { staticNetwork: true });
  const candidate = await findCandidate(store, config, verified, provider);
  if (!candidate) return saveAction(store, verified, { status: "skipped", reason: "no active eligible farmer listing at or below the signed max price" });
  const quantityKg = Math.min(Math.floor(verified.buyUpToKg), Number(candidate.quantityKg));
  const total = BigInt(quantityKg) * candidate.price;
  const maxSpend = parseUnits(String(verified.maxSpend), config.STABLECOIN_DECIMALS);
  if (quantityKg <= 0 || total > maxSpend) return saveAction(store, verified, { status: "skipped", reason: "candidate exceeds signed quantity or spend cap", farmer: candidate.farmer, listingId: candidate.id.toString() });

  const humanPrice = Number(candidate.price) / 10 ** config.STABLECOIN_DECIMALS;
  const humanTotal = Number(total) / 10 ** config.STABLECOIN_DECIMALS;
  let txHash: string | undefined;
  if (submitOrder) txHash = await submitOrder(candidate.id.toString(), quantityKg, humanPrice);
  else txHash = await submitCappedOrder(config, verified, candidate, quantityKg, total, provider);
  if (!txHash) return saveAction(store, verified, { status: "ready", reason: "eligible listing found; no scoped executor configured, so no transaction was submitted", farmer: candidate.farmer, listingId: candidate.id.toString(), quantityKg, pricePerKg: humanPrice, total: humanTotal });
  return saveAction(store, verified, { status: "submitted", reason: "agent purchased within the signed merchant caps", farmer: candidate.farmer, listingId: candidate.id.toString(), quantityKg, pricePerKg: humanPrice, total: humanTotal, txHash });
}

export async function runActiveRestockRules(store: Store, config: AppConfig) {
  const rows = store.prepare("SELECT * FROM agent_rules WHERE enabled=1 AND expires_at>? ORDER BY created_at ASC").all(now()) as Array<{ crop: string; threshold_kg: number; buy_up_to_kg: number; max_price_per_kg: number; max_spend: number; expires_at: number; signer: string; executor_address: string | null; signature: string }>;
  const results: AgentAction[] = [];
  for (const row of rows) {
    const rule: RestockRule = { crop: row.crop, thresholdKg: row.threshold_kg, buyUpToKg: row.buy_up_to_kg, maxPricePerKg: row.max_price_per_kg, maxSpend: row.max_spend, expiresAt: row.expires_at, signer: row.signer, executor: row.executor_address || undefined, signature: row.signature };
    try { results.push(await runRestockOnce(store, config, rule)); }
    catch (error) { results.push(saveAction(store, rule, { status: "skipped", reason: error instanceof Error ? error.message : "agent execution failed" })); }
  }
  return results;
}

export { canonicalRule };
