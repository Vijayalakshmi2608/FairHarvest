import { config } from "./config.js";
import { db, now } from "./db.js";

/** DEMO ONLY: populates a PostgreSQL database with fictional local pilot data. */
const store = await db(config);
const timestamp = now();
await store.query(`INSERT INTO listings(id,farmer_address,crop_type,grade,quantity_kg,harvest_date,region,min_price,metadata_hash,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO UPDATE SET farmer_address=EXCLUDED.farmer_address,crop_type=EXCLUDED.crop_type,grade=EXCLUDED.grade,quantity_kg=EXCLUDED.quantity_kg,harvest_date=EXCLUDED.harvest_date,region=EXCLUDED.region,min_price=EXCLUDED.min_price,metadata_hash=EXCLUDED.metadata_hash,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`, ["demo-listing-1", "0x0000000000000000000000000000000000000001", "wheat", "A", "1000", timestamp - 7 * 86400, "pilot", "100000000000000000000", "ipfs://demo-fairharvest", "Active", timestamp, timestamp]);
await store.query(`INSERT INTO orders(id,listing_id,buyer_address,farmer_address,quantity_kg,price_per_kg,total_amount,state,created_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,completed_at=EXCLUDED.completed_at`, ["demo-order-1", "demo-listing-1", "0x0000000000000000000000000000000000000002", "0x0000000000000000000000000000000000000001", "100", "100000000000000000000", "10000000000000000000000", "Confirmed", timestamp - 3600, timestamp - 1800]);
await store.query("INSERT INTO sales(id,crop_type,grade,region,price_per_kg,timestamp,order_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET price_per_kg=EXCLUDED.price_per_kg,timestamp=EXCLUDED.timestamp", ["demo-sale-1", "wheat", "A", "pilot", "100000000000000000000", timestamp - 1800, "demo-order-1"]);
await store.query("INSERT INTO reputation(address,completed_orders,disputes,rating_total,rating_count,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(address) DO UPDATE SET completed_orders=EXCLUDED.completed_orders,rating_total=EXCLUDED.rating_total,rating_count=EXCLUDED.rating_count,updated_at=EXCLUDED.updated_at", ["0x0000000000000000000000000000000000000001", 1, 0, 5, 1, timestamp]);
console.log("DEMO ONLY: seeded fictional FairHarvest records into", config.DATABASE_URL.replace(/:\/\/.*@/, "://***@"));
await store.close();
