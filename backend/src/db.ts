import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));
export const db = (config: AppConfig) => {
  const filename = config.DATABASE_URL.startsWith("/") ? config.DATABASE_URL : resolve(here, "..", config.DATABASE_URL);
  const database = new Database(filename);
  database.pragma("journal_mode = WAL");
  database.exec(readFileSync(resolve(here, "..", "schema.sql"), "utf8"));
  return database;
};

export type Store = ReturnType<typeof db>;
export const now = () => Math.floor(Date.now() / 1000);

export function upsertReputation(store: Store, address: string, completedOrders: number, disputes: number, ratingTotal = 0, ratingCount = 0) {
  store.prepare(`INSERT INTO reputation(address, completed_orders, disputes, rating_total, rating_count, updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(address) DO UPDATE SET completed_orders=excluded.completed_orders, disputes=excluded.disputes, rating_total=excluded.rating_total, rating_count=excluded.rating_count, updated_at=excluded.updated_at`).run(address.toLowerCase(), completedOrders, disputes, ratingTotal, ratingCount, now());
}
