import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default("./fairharvest.sqlite"),
  CHAIN_ID: z.coerce.number().int().default(1990),
  STABLECOIN_DECIMALS: z.coerce.number().int().min(0).max(36).default(18),
  RPC_URL: z.string().optional(),
  REGISTRY_ADDRESS: z.string().optional(),
  ESCROW_ADDRESS: z.string().optional(),
  STABLECOIN_ADDRESS: z.string().optional(),
  PRICE_INDEX_ADDRESS: z.string().optional(),
  REPUTATION_ADDRESS: z.string().optional(),
  AGENT_EXECUTOR_PRIVATE_KEY: z.string().optional(),
  AGENT_ENABLED: z.coerce.boolean().default(false),
  AGENT_POLL_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),
  INDEXER_START_BLOCK: z.coerce.number().default(0),
  AUTH_NONCE_TTL_SECONDS: z.coerce.number().default(600),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().default(120),
  LOG_LEVEL: z.string().default("info")
});

export const config = EnvSchema.parse(process.env);
export type AppConfig = typeof config;
