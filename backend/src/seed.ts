import { config } from "./config.js";
import { db, now } from "./db.js";

/** DEMO ONLY: populates a local SQLite database with fictional pilot data. */
const store = db(config);
const timestamp = now();
store.prepare(`INSERT OR REPLACE INTO listings(id,farmer_address,crop_type,grade,quantity_kg,harvest_date,region,min_price,metadata_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run("demo-listing-1", "0x0000000000000000000000000000000000000001", "wheat", "A", "1000", timestamp - 7 * 86400, "pilot", "100000000000000000000", "ipfs://demo-fairharvest", "Active", timestamp, timestamp);
store.prepare(`INSERT OR REPLACE INTO orders(id,listing_id,buyer_address,farmer_address,quantity_kg,price_per_kg,total_amount,state,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run("demo-order-1", "demo-listing-1", "0x0000000000000000000000000000000000000002", "0x0000000000000000000000000000000000000001", "100", "100000000000000000000", "10000000000000000000000", "Confirmed", timestamp - 3600, timestamp - 1800);
store.prepare("INSERT OR REPLACE INTO sales(id,crop_type,grade,region,price_per_kg,timestamp,order_id) VALUES(?,?,?,?,?,?,?)").run("demo-sale-1", "wheat", "A", "pilot", "100000000000000000000", timestamp - 1800, "demo-order-1");
store.prepare("INSERT OR REPLACE INTO reputation(address,completed_orders,disputes,rating_total,rating_count,updated_at) VALUES(?,?,?,?,?,?)").run("0x0000000000000000000000000000000000000001", 1, 0, 5, 1, timestamp);
console.log("DEMO ONLY: seeded fictional FairHarvest records into", config.DATABASE_URL);
store.close();
