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
const store = await db(config);
const app = express();
const allowedOrigins = config.ALLOWED_ORIGINS === "*" ? true : config.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "64kb" }));
app.use(rateLimit({ windowMs: config.RATE_LIMIT_WINDOW_MS, limit: config.RATE_LIMIT_MAX, standardHeaders: true, legacyHeaders: false }));
const wallet = requireWallet(store);

const listingSchema = z.object({ cropType: z.string().min(1).max(80), grade: z.string().min(1).max(40), quantityKg: z.string().regex(/^\d+$/), harvestDate: z.number().int().nonnegative(), region: z.string().min(1).max(80), minPrice: z.string().regex(/^\d+$/), metadataHash: z.string().min(1).max(200) });
const orderSchema = z.object({ listingId: z.string().min(1), quantityKg: z.string().regex(/^\d+$/), pricePerKg: z.string().regex(/^\d+$/) });
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const inventorySchema = z.object({ crop: z.string().min(1).max(80), stockKg: z.number().nonnegative() });

app.get("/health", (_req, res) => res.json({ service: "fairharvest-backend", status: "ok", time: now() }));
app.get("/auth/nonce", async (req, res) => { const parsed = addressSchema.safeParse(req.query.address); if (!parsed.success) return res.status(400).json({ error: "valid address query parameter required" }); return res.json(await issueNonce(store, config, parsed.data)); });

app.post("/listings", wallet, async (req, res) => {
  const parsed = listingSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "invalid listing", details: parsed.error.flatten() });
  const body = parsed.data; const id = `local-${randomUUID()}`; const timestamp = now();
  await store.query(`INSERT INTO listings(id,farmer_address,crop_type,grade,quantity_kg,harvest_date,region,min_price,metadata_hash,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id, res.locals.walletAddress.toLowerCase(), body.cropType, body.grade, body.quantityKg, body.harvestDate, body.region, body.minPrice, body.metadataHash, "Active", timestamp, timestamp]);
  logger.info({ event: "listing_created", listingId: id, farmer: res.locals.walletAddress }, "listing persisted");
  return res.status(201).json((await store.query("SELECT * FROM listings WHERE id=$1", [id])).rows[0]);
});

app.get("/listings", async (req, res) => { const status = typeof req.query.status === "string" ? req.query.status : "Active"; return res.json((await store.query("SELECT * FROM listings WHERE status=$1 ORDER BY created_at DESC", [status])).rows); });
app.get("/listings/:id", async (req, res) => { const listing = (await store.query("SELECT * FROM listings WHERE id=$1", [req.params.id])).rows[0]; return listing ? res.json(listing) : res.status(404).json({ error: "listing not found" }); });

app.post("/orders", wallet, async (req, res) => {
  const parsed = orderSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "invalid order", details: parsed.error.flatten() });
  const listing = (await store.query<{ farmer_address: string }>("SELECT farmer_address FROM listings WHERE id=$1 AND status='Active'", [parsed.data.listingId])).rows[0];
  if (!listing) return res.status(404).json({ error: "active listing not found" });
  const id = `local-${randomUUID()}`; const total = (BigInt(parsed.data.quantityKg) * BigInt(parsed.data.pricePerKg)).toString();
  await store.query("INSERT INTO orders(id,listing_id,buyer_address,farmer_address,quantity_kg,price_per_kg,total_amount,state,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, parsed.data.listingId, res.locals.walletAddress.toLowerCase(), listing.farmer_address, parsed.data.quantityKg, parsed.data.pricePerKg, total, "Created", now()]);
  return res.status(201).json((await store.query("SELECT * FROM orders WHERE id=$1", [id])).rows[0]);
});

app.post("/orders/:id/confirm", wallet, async (req, res) => { const order = (await store.query<{ state: string }>("SELECT * FROM orders WHERE id=$1 AND buyer_address=$2", [req.params.id, res.locals.walletAddress.toLowerCase()])).rows[0]; if (!order) return res.status(404).json({ error: "order not found" }); if (order.state !== "Created" && order.state !== "Delivered") return res.status(409).json({ error: "order cannot be confirmed" }); await store.query("UPDATE orders SET state='Confirmed', completed_at=$1 WHERE id=$2", [now(), req.params.id]); return res.json((await store.query("SELECT * FROM orders WHERE id=$1", [req.params.id])).rows[0]); });
app.post("/orders/:id/dispute", wallet, async (req, res) => { const address = res.locals.walletAddress.toLowerCase(); const order = (await store.query("SELECT * FROM orders WHERE id=$1 AND (buyer_address=$2 OR farmer_address=$2)", [req.params.id, address])).rows[0]; if (!order) return res.status(404).json({ error: "order not found" }); await store.query("UPDATE orders SET state='Disputed' WHERE id=$1", [req.params.id]); await store.query(`INSERT INTO reputation(address,completed_orders,disputes,rating_total,rating_count,updated_at) VALUES($1,0,1,0,0,$2) ON CONFLICT(address) DO UPDATE SET disputes=reputation.disputes+1,updated_at=EXCLUDED.updated_at`, [address, now()]); return res.json((await store.query("SELECT * FROM orders WHERE id=$1", [req.params.id])).rows[0]); });

app.get("/price-index", async (req, res) => { const parsed = z.object({ crop: z.string().min(1), grade: z.string().min(1), region: z.string().min(1) }).safeParse(req.query); if (!parsed.success) return res.status(400).json({ error: "crop, grade, and region are required" }); const rows = (await store.query<{ price_per_kg: string }>("SELECT price_per_kg FROM sales WHERE crop_type=$1 AND grade=$2 AND region=$3 ORDER BY price_per_kg::numeric", [parsed.data.crop, parsed.data.grade, parsed.data.region])).rows; const prices = rows.map((row) => BigInt(row.price_per_kg)); const median = prices.length ? (prices.length % 2 ? prices[Math.floor(prices.length / 2)] : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2n) : null; const ai = (await store.query("SELECT * FROM price_snapshots WHERE crop_type=$1 AND grade=$2 AND region=$3 ORDER BY timestamp DESC LIMIT 1", [parsed.data.crop, parsed.data.grade, parsed.data.region])).rows[0] || null; return res.json({ crop: parsed.data.crop, grade: parsed.data.grade, region: parsed.data.region, medianPrice: median?.toString() ?? null, salesCount: prices.length, latestAI: ai }); });
app.get("/reputation/:address", async (req, res) => { const parsed = addressSchema.safeParse(req.params.address); if (!parsed.success) return res.status(400).json({ error: "invalid address" }); const address = parsed.data.toLowerCase(); const profile = (await store.query("SELECT * FROM reputation WHERE address=$1", [address])).rows[0] || { address, completed_orders: 0, disputes: 0, rating_total: 0, rating_count: 0 }; return res.json(profile); });

app.post("/agent/rules", wallet, async (req, res) => { const parsed = restockRuleSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "invalid signed restock rule", details: parsed.error.flatten() }); try { const verified = verifyRestockRule(parsed.data); if (verified.signer.toLowerCase() !== String(res.locals.walletAddress).toLowerCase()) return res.status(403).json({ error: "rule signer must match authenticated merchant" }); const id = randomUUID(); const timestamp = now(); await store.query(`INSERT INTO agent_rules(id,merchant_address,crop,threshold_kg,buy_up_to_kg,max_price_per_kg,max_spend,expires_at,signer,executor_address,signature,enabled,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,$13)`, [id, verified.signer.toLowerCase(), verified.crop, verified.thresholdKg, verified.buyUpToKg, verified.maxPricePerKg, verified.maxSpend, verified.expiresAt, verified.signer.toLowerCase(), (verified.executor || verified.signer).toLowerCase(), verified.signature, timestamp, timestamp]); return res.status(201).json({ id, ...verified, executor: verified.executor || verified.signer, enabled: true, createdAt: timestamp }); } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "invalid restock rule" }); } });
app.get("/agent/rules", async (req, res) => { const merchant = addressSchema.safeParse(req.query.merchant); if (!merchant.success) return res.status(400).json({ error: "valid merchant query parameter required" }); return res.json((await store.query("SELECT * FROM agent_rules WHERE merchant_address=$1 ORDER BY created_at DESC", [merchant.data.toLowerCase()])).rows); });
app.put("/agent/inventory", wallet, async (req, res) => { const parsed = inventorySchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "invalid inventory", details: parsed.error.flatten() }); const merchant = String(res.locals.walletAddress).toLowerCase(); await store.query("INSERT INTO agent_inventory(merchant_address,crop,stock_kg,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(merchant_address,crop) DO UPDATE SET stock_kg=EXCLUDED.stock_kg,updated_at=EXCLUDED.updated_at", [merchant, parsed.data.crop, parsed.data.stockKg, now()]); return res.json({ merchant, ...parsed.data }); });
app.get("/agent/inventory", async (req, res) => { const merchant = addressSchema.safeParse(req.query.merchant); if (!merchant.success) return res.status(400).json({ error: "valid merchant query parameter required" }); return res.json((await store.query("SELECT crop,stock_kg AS \"stockKg\",updated_at AS \"updatedAt\" FROM agent_inventory WHERE merchant_address=$1 ORDER BY crop", [merchant.data.toLowerCase()])).rows); });
app.get("/agent/actions", async (req, res) => { const merchant = addressSchema.safeParse(req.query.merchant); if (!merchant.success) return res.status(400).json({ error: "valid merchant query parameter required" }); const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200); return res.json((await store.query("SELECT id,rule_id AS \"ruleId\",merchant_address AS merchant,crop,status,reason,farmer_address AS farmer,listing_id AS \"listingId\",quantity_kg AS \"quantityKg\",price_per_kg AS \"pricePerKg\",total_amount AS total,tx_hash AS \"txHash\",created_at AS \"createdAt\" FROM agent_actions WHERE merchant_address=$1 ORDER BY created_at DESC LIMIT $2", [merchant.data.toLowerCase(), limit])).rows); });

app.post("/agent/run", wallet, async (req, res) => { const merchant = String(res.locals.walletAddress).toLowerCase(); const rows = (await store.query<{ crop: string; threshold_kg: number; buy_up_to_kg: number; max_price_per_kg: number; max_spend: number; expires_at: string; signer: string; executor_address: string | null; signature: string }>("SELECT * FROM agent_rules WHERE merchant_address=$1 AND enabled=TRUE AND expires_at>$2 ORDER BY created_at ASC", [merchant, now()])).rows; const results = []; for (const row of rows) { const rule: RestockRule = { crop: row.crop, thresholdKg: Number(row.threshold_kg), buyUpToKg: Number(row.buy_up_to_kg), maxPricePerKg: Number(row.max_price_per_kg), maxSpend: Number(row.max_spend), expiresAt: Number(row.expires_at), signer: row.signer, executor: row.executor_address || undefined, signature: row.signature }; try { results.push(await runRestockOnce(store, config, rule)); } catch (error) { results.push({ status: "skipped", reason: error instanceof Error ? error.message : "agent execution failed" }); } } return res.json({ results }); });

app.get("/metrics", async (_req, res) => { const [listings, orders, farmers, buyers, gmv] = await Promise.all([store.query("SELECT COUNT(*)::int AS count FROM listings"), store.query("SELECT COUNT(*)::int AS count FROM orders WHERE state='Confirmed'"), store.query("SELECT COUNT(DISTINCT farmer_address)::int AS count FROM listings"), store.query("SELECT COUNT(DISTINCT buyer_address)::int AS count FROM orders"), store.query("SELECT COALESCE(SUM(total_amount::numeric),0)::text AS total FROM orders WHERE state='Confirmed'")]); return res.json({ totalListings: listings.rows[0].count, completedOrders: orders.rows[0].count, uniqueFarmers: farmers.rows[0].count, uniqueBuyers: buyers.rows[0].count, gmvStablecoin: String(gmv.rows[0].total) }); });

const stopIndexer = startIndexer(store, config, logger);
let agentTimer: NodeJS.Timeout | undefined;
if (config.AGENT_ENABLED) { void runActiveRestockRules(store, config).catch((error) => logger.error({ error }, "initial agent run failed")); agentTimer = setInterval(() => { void runActiveRestockRules(store, config).catch((error) => logger.error({ error }, "scheduled agent run failed")); }, config.AGENT_POLL_INTERVAL_MS); logger.info({ intervalMs: config.AGENT_POLL_INTERVAL_MS, chainId: config.CHAIN_ID }, "Auto-Restock Agent scheduler enabled"); }
const server = app.listen(config.PORT, "0.0.0.0", () => logger.info({ port: config.PORT }, "FairHarvest backend listening"));
const shutdown = async () => { if (agentTimer) clearInterval(agentTimer); stopIndexer(); server.close(async () => { await store.close(); process.exit(0); }); };
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
export { app, store };
