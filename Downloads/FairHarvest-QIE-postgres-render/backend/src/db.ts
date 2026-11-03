import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";
import type { AppConfig } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));

export class Store {
  readonly pool: Pool;
  constructor(databaseUrl: string) {
    const options: PoolConfig = { connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 };
    this.pool = new Pool(options);
  }
  query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values);
  }
  async close() { await this.pool.end(); }
}

export async function db(config: AppConfig) {
  if (!config.DATABASE_URL) throw new Error("DATABASE_URL is required for PostgreSQL");
  const store = new Store(config.DATABASE_URL);
  const schema = readFileSync(resolve(here, "..", "schema.sql"), "utf8");
  await store.query(schema);
  return store;
}

export type StoreLike = Store;
export const now = () => Math.floor(Date.now() / 1000);

export async function upsertReputation(store: StoreLike, address: string, completedOrders: number, disputes: number, ratingTotal = 0, ratingCount = 0) {
  await store.query(`INSERT INTO reputation(address, completed_orders, disputes, rating_total, rating_count, updated_at) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(address) DO UPDATE SET completed_orders=EXCLUDED.completed_orders, disputes=EXCLUDED.disputes, rating_total=EXCLUDED.rating_total, rating_count=EXCLUDED.rating_count, updated_at=EXCLUDED.updated_at`,
  [address.toLowerCase(), completedOrders, disputes, ratingTotal, ratingCount, now()]);
}
