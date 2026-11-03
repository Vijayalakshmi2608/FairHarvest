PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS auth_nonces (
  address TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  farmer_address TEXT NOT NULL,
  crop_type TEXT NOT NULL,
  grade TEXT NOT NULL,
  quantity_kg TEXT NOT NULL,
  harvest_date INTEGER NOT NULL,
  region TEXT NOT NULL,
  min_price TEXT NOT NULL,
  metadata_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listings_market ON listings(crop_type, grade, region);
CREATE INDEX IF NOT EXISTS idx_listings_farmer ON listings(farmer_address);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  buyer_address TEXT NOT NULL,
  farmer_address TEXT NOT NULL,
  quantity_kg TEXT NOT NULL,
  price_per_kg TEXT NOT NULL,
  total_amount TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'Created',
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_address);
CREATE INDEX IF NOT EXISTS idx_orders_farmer ON orders(farmer_address);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  crop_type TEXT NOT NULL,
  grade TEXT NOT NULL,
  region TEXT NOT NULL,
  price_per_kg TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  order_id TEXT
);

CREATE TABLE IF NOT EXISTS reputation (
  address TEXT PRIMARY KEY,
  completed_orders INTEGER NOT NULL DEFAULT 0,
  disputes INTEGER NOT NULL DEFAULT 0,
  rating_total INTEGER NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crop_type TEXT NOT NULL,
  grade TEXT NOT NULL,
  region TEXT NOT NULL,
  median_price TEXT,
  ai_low TEXT,
  ai_high TEXT,
  confidence_bps INTEGER,
  data_hash TEXT,
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_rules (
  id TEXT PRIMARY KEY,
  merchant_address TEXT NOT NULL,
  crop TEXT NOT NULL,
  threshold_kg REAL NOT NULL,
  buy_up_to_kg REAL NOT NULL,
  max_price_per_kg REAL NOT NULL,
  max_spend REAL NOT NULL,
  expires_at INTEGER NOT NULL,
  signer TEXT NOT NULL,
  executor_address TEXT,
  signature TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_rules_active ON agent_rules(enabled, expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_rules_merchant ON agent_rules(merchant_address);

CREATE TABLE IF NOT EXISTS agent_inventory (
  merchant_address TEXT NOT NULL,
  crop TEXT NOT NULL,
  stock_kg REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (merchant_address, crop)
);

CREATE TABLE IF NOT EXISTS agent_actions (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  merchant_address TEXT NOT NULL,
  crop TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  farmer_address TEXT,
  listing_id TEXT,
  quantity_kg REAL,
  price_per_kg REAL,
  total_amount REAL,
  tx_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_actions_merchant ON agent_actions(merchant_address, created_at DESC);
