import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pino from "pino";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { db, now } from "./db.js";
import { issueNonce, requireWallet } from "./auth.js";
import { startIndexer } from "./indexer.js";
import { restockRuleSchema, runActiveRestockRules, runRestockOnce, verifyRestockRule, type RestockRule } from "./agentRunner.js";

const logger = pino({ level: config.LOG_LEVEL, base: { service: "fairharvest-backend" } });
const store = db(config);
const app = express();
app.use(cors());
app.use(express.json({ limit: "64kb" }));
app.use(rateLimit({ windowMs: config.RATE_LIMIT_WINDOW_MS, limit: config.RATE_LIMIT_MAX, standardHeaders: true, legacyHeaders: false }));
const wallet = requireWallet(store);

const listingSchema = z.object({ cropType: z.string().min(1).max(80), grade: z.string().min(1).max(40), quantityKg: z.string().regex(/^\d+$/), harvestDate: z.number().int().nonnegative(), region: z.string().min(1).max(80), minPrice: z.string().regex(/^\d+$/), metadataHash: z.string().min(1).max(200) });
const orderSchema = z.object({ listingId: z.string().min(1), quantityKg: z.string().regex(/^\d+$/), pricePerKg: z.string().regex(/^\d+$/) });
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const inventorySchema = z.object({ crop: z.string().min(1).max(80), stockKg: z.number().nonnegative() });

app.get("/health", (_req, res) => res.json({ service: "fairharvest-backend", status: "ok", time: now() }));
app.get("/auth/nonce", (req, res) => {
  const parsed = addressSchema.safeParse(req.query.address);
  if (!parsed.success) return res.status(400).json({ error: "valid address query parameter required" });
  return res.json(issueNonce(store, config, parsed.data));
});

app.post("/listings", wallet, (req, res) => {
  const parsed = listingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid listing", details: parsed.error.flatten() });
  const body = parsed.data; const id = `local-${randomUUID()}`; const timestamp = now();
  store.prepare(`INSERT INTO listings(id,farmer_address,crop_type,grade,quantity_kg,harvest_date,region,min_price,metadata_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, res.locals.walletAddress.toLowerCase(), body.cropType, body.grade, body.quantityKg, body.harvestDate, body.region, body.minPrice, body.metadataHash, "Active", timestamp, timestamp);
  logger.info({ event: "listing_created", listingId: id, farmer: res.locals.walletAddress }, "listing persisted");
  return res.status(201).json(store.prepare("SELECT * FROM listings WHERE id=?").get(id));
});

app.get("/listings", (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "Active";
  return res.json(store.prepare("SELECT * FROM listings WHERE status=? ORDER BY created_at DESC").all(status));
});
app.get("/listings/:id", (req, res) => {
  const listing = store.prepare("SELECT * FROM listings WHERE id=?").get(req.params.id);
  return listing ? res.json(listing) : res.status(404).json({ error: "listing not found" });
});

app.post("/orders", wallet, (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid order", details: parsed.error.flatten() });
  const listing = store.prepare("SELECT * FROM listings WHERE id=? AND status='Active'").get(parsed.data.listingId) as any;
  if (!listing) return res.status(404).json({ error: "active listing not found" });
  const id = `local-${randomUUID()}`; const total = (BigInt(parsed.data.quantityKg) * BigInt(parsed.data.pricePerKg)).toString();
  store.prepare(`INSERT INTO orders(id,listing_id,buyer_address,farmer_address,quantity_kg,price_per_kg,total_amount,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(id, parsed.data.listingId, res.locals.walletAddress.toLowerCase(), listing.farmer_address, parsed.data.quantityKg, parsed.data.pricePerKg, total, "Created", now());
  return res.status(201).json(store.prepare("SELECT * FROM orders WHERE id=?").get(id));
});

app.post("/orders/:id/confirm", wallet, (req, res) => {
  const order = store.prepare("SELECT * FROM orders WHERE id=? AND buyer_address=?").get(req.params.id, res.locals.walletAddress.toLowerCase()) as any;
  if (!order) return res.status(404).json({ error: "order not found" });
  if (order.state !== "Created" && order.state !== "Delivered") return res.status(409).json({ error: "order cannot be confirmed" });
  store.prepare("UPDATE orders SET state='Confirmed', completed_at=? WHERE id=?").run(now(), order.id);
  return res.json(store.prepare("SELECT * FROM orders WHERE id=?").get(order.id));
});

app.post("/orders/:id/dispute", wallet, (req, res) => {
  const order = store.prepare("SELECT * FROM orders WHERE id=? AND (buyer_address=? OR farmer_address=?)").get(req.params.id, res.locals.walletAddress.toLowerCase(), res.locals.walletAddress.toLowerCase()) as any;
  if (!order) return res.status(404).json({ error: "order not found" });
  store.prepare("UPDATE orders SET state='Disputed' WHERE id=?").run(order.id);
  store.prepare(`INSERT INTO reputation(address,completed_orders,disputes,rating_total,rating_count,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(address) DO UPDATE SET disputes=disputes+1,updated_at=excluded.updated_at`).run(res.locals.walletAddress.toLowerCase(), 0, 1, 0, 0, now());
  return res.json(store.prepare("SELECT * FROM orders WHERE id=?").get(order.id));
});

app.get("/price-index", (req, res) => {
  const parsed = z.object({ crop: z.string().min(1), grade: z.string().min(1), region: z.string().min(1) }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "crop, grade, and region are required" });
  const rows = store.prepare("SELECT price_per_kg FROM sales WHERE crop_type=? AND grade=? AND region=? ORDER BY CAST(price_per_kg AS INTEGER)").all(parsed.data.crop, parsed.data.grade, parsed.data.region) as Array<{ price_per_kg: string }>;
  const prices = rows.map((row) => BigInt(row.price_per_kg));
  const median = prices.length ? (prices.length % 2 ? prices[Math.floor(prices.length / 2)] : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2n) : null;
  const ai = store.prepare("SELECT * FROM price_snapshots WHERE crop_type=? AND grade=? AND region=? ORDER BY timestamp DESC LIMIT 1").get(parsed.data.crop, parsed.data.grade, parsed.data.region) || null;
  return res.json({ crop: parsed.data.crop, grade: parsed.data.grade, region: parsed.data.region, medianPrice: median?.toString() ?? null, salesCount: prices.length, latestAI: ai });
});

app.get("/reputation/:address", (req, res) => {
  const parsed = addressSchema.safeParse(req.params.address);
  if (!parsed.success) return res.status(400).json({ error: "invalid address" });
  const profile = store.prepare("SELECT * FROM reputation WHERE address=?").get(parsed.data.toLowerCase()) || { address: parsed.data.toLowerCase(), completed_orders: 0, disputes: 0, rating_total: 0, rating_count: 0 };
  return res.json(profile);
});

app.post("/agent/rules", wallet, (req, res) => {
  const parsed = restockRuleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid signed restock rule", details: parsed.error.flatten() });
  try {
    const verified = verifyRestockRule(parsed.data);
    if (verified.signer.toLowerCase() !== String(res.locals.walletAddress).toLowerCase()) return res.status(403).json({ error: "rule signer must match authenticated merchant" });
    const id = randomUUID(); const timestamp = now();
    store.prepare(`INSERT INTO agent_rules(id,merchant_address,crop,threshold_kg,buy_up_to_kg,max_price_per_kg,max_spend,expires_at,signer,executor_address,signature,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, verified.signer.toLowerCase(), verified.crop, verified.thresholdKg, verified.buyUpToKg, verified.maxPricePerKg, verified.maxSpend, verified.expiresAt, verified.signer.toLowerCase(), (verified.executor || verified.signer).toLowerCase(), verified.signature, 1, timestamp, timestamp);
    return res.status(201).json({ id, ...verified, executor: verified.executor || verified.signer, enabled: true, createdAt: timestamp });
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "invalid restock rule" }); }
});

app.get("/agent/rules", (req, res) => {
  const merchant = addressSchema.safeParse(req.query.merchant);
  if (!merchant.success) return res.status(400).json({ error: "valid merchant query parameter required" });
  return res.json(store.prepare("SELECT * FROM agent_rules WHERE merchant_address=? ORDER BY created_at DESC").all(merchant.data.toLowerCase()));
});

app.put("/agent/inventory", wallet, (req, res) => {
  const parsed = inventorySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid inventory", details: parsed.error.flatten() });
  const merchant = String(res.locals.walletAddress).toLowerCase();
  store.prepare("INSERT INTO agent_inventory(merchant_address,crop,stock_kg,updated_at) VALUES(?,?,?,?) ON CONFLICT(merchant_address,crop) DO UPDATE SET stock_kg=excluded.stock_kg,updated_at=excluded.updated_at").run(merchant, parsed.data.crop, parsed.data.stockKg, now());
  return res.json({ merchant, ...parsed.data });
});

app.get("/agent/inventory", (req, res) => {
  const merchant = addressSchema.safeParse(req.query.merchant);
  if (!merchant.success) return res.status(400).json({ error: "valid merchant query parameter required" });
  return res.json(store.prepare("SELECT crop,stock_kg AS stockKg,updated_at AS updatedAt FROM agent_inventory WHERE merchant_address=? ORDER BY crop").all(merchant.data.toLowerCase()));
});

app.get("/agent/actions", (req, res) => {
  const merchant = addressSchema.safeParse(req.query.merchant);
  if (!merchant.success) return res.status(400).json({ error: "valid merchant query parameter required" });
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  return res.json(store.prepare("SELECT id,rule_id AS ruleId,merchant_address AS merchant,crop,status,reason,farmer_address AS farmer,listing_id AS listingId,quantity_kg AS quantityKg,price_per_kg AS pricePerKg,total_amount AS total,tx_hash AS txHash,created_at AS createdAt FROM agent_actions WHERE merchant_address=? ORDER BY created_at DESC LIMIT ?").all(merchant.data.toLowerCase(), limit));
});

app.post("/agent/run", wallet, async (req, res) => {
  const merchant = String(res.locals.walletAddress).toLowerCase();
  const rows = store.prepare("SELECT * FROM agent_rules WHERE merchant_address=? AND enabled=1 AND expires_at>? ORDER BY created_at ASC").all(merchant, now()) as Array<{ crop: string; threshold_kg: number; buy_up_to_kg: number; max_price_per_kg: number; max_spend: number; expires_at: number; signer: string; executor_address: string | null; signature: string }>;
  const results = [];
  for (const row of rows) {
    const rule: RestockRule = { crop: row.crop, thresholdKg: row.threshold_kg, buyUpToKg: row.buy_up_to_kg, maxPricePerKg: row.max_price_per_kg, maxSpend: row.max_spend, expiresAt: row.expires_at, signer: row.signer, executor: row.executor_address || undefined, signature: row.signature };
    try { results.push(await runRestockOnce(store, config, rule)); } catch (error) { results.push({ status: "skipped", reason: error instanceof Error ? error.message : "agent execution failed" }); }
  }
  return res.json({ results });
});

app.get("/metrics", (_req, res) => {
  const totalListings = (store.prepare("SELECT COUNT(*) AS count FROM listings").get() as any).count;
  const completedOrders = (store.prepare("SELECT COUNT(*) AS count FROM orders WHERE state='Confirmed'").get() as any).count;
  const uniqueFarmers = (store.prepare("SELECT COUNT(DISTINCT farmer_address) AS count FROM listings").get() as any).count;
  const uniqueBuyers = (store.prepare("SELECT COUNT(DISTINCT buyer_address) AS count FROM orders").get() as any).count;
  const gmv = (store.prepare("SELECT COALESCE(SUM(CAST(total_amount AS INTEGER)),0) AS total FROM orders WHERE state='Confirmed'").get() as any).total;
  return res.json({ totalListings, completedOrders, uniqueFarmers, uniqueBuyers, gmvStablecoin: String(gmv) });
});

const stopIndexer = startIndexer(store, config, logger);
let agentTimer: NodeJS.Timeout | undefined;
if (config.AGENT_ENABLED) {
  void runActiveRestockRules(store, config).catch((error) => logger.error({ error }, "initial agent run failed"));
  agentTimer = setInterval(() => { void runActiveRestockRules(store, config).catch((error) => logger.error({ error }, "scheduled agent run failed")); }, config.AGENT_POLL_INTERVAL_MS);
  logger.info({ intervalMs: config.AGENT_POLL_INTERVAL_MS, chainId: config.CHAIN_ID }, "Auto-Restock Agent scheduler enabled");
}
const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, "FairHarvest backend listening"));
process.on("SIGTERM", () => { if (agentTimer) clearInterval(agentTimer); stopIndexer(); server.close(() => { store.close(); process.exit(0); }); });
export { app, store };
