import { Contract, JsonRpcProvider } from "ethers";
import type { Store } from "./db.js";
import type { AppConfig } from "./config.js";
import { now, upsertReputation } from "./db.js";
import type { Logger } from "pino";

const registryAbi = [
  "event ListingCreated(uint256 indexed listingId,address indexed farmer,string cropType,uint256 quantityKg,uint256 minPrice)",
  "event ListingUpdated(uint256 indexed listingId,uint256 quantityKg,uint256 minPrice)",
  "event ListingCancelled(uint256 indexed listingId,address indexed farmer)",
  "event ListingSold(uint256 indexed listingId,address indexed farmer)"
];
const escrowAbi = [
  "event OrderCreated(uint256 indexed orderId,uint256 indexed listingId,address indexed buyer,uint256 amount)",
  "event Delivered(uint256 indexed orderId)",
  "event Confirmed(uint256 indexed orderId,uint256 farmerAmount,uint256 fee)",
  "event Disputed(uint256 indexed orderId,address indexed initiator)",
  "event Refunded(uint256 indexed orderId,uint256 buyerAmount)"
];
const indexAbi = [
  "event SaleRecorded(uint256 indexed saleId,bytes32 indexed marketKey,uint256 pricePerKg)",
  "event AICommitmentAccepted(bytes32 indexed marketKey,uint256 priceLow,uint256 priceHigh,uint256 confidenceBps,bytes32 dataHash,uint64 timestamp,address indexed signer)"
];
const reputationAbi = [
  "event CompletedOrderRecorded(address indexed participant,uint8 rating)",
  "event DisputeRecorded(address indexed participant)"
];

/** Starts event listeners only when RPC and contract addresses are configured. */
export function startIndexer(store: Store, config: AppConfig, logger: Logger) {
  if (!config.RPC_URL) { logger.info("Indexer disabled: RPC_URL is not configured"); return () => undefined; }
  const provider = new JsonRpcProvider(config.RPC_URL);
  const listeners: Array<() => void> = [];
  if (config.REGISTRY_ADDRESS) {
    const registry = new Contract(config.REGISTRY_ADDRESS, registryAbi, provider);
    registry.on("ListingCreated", (id, farmer, cropType, quantityKg, minPrice) => {
      const timestamp = now();
      store.prepare(`INSERT OR REPLACE INTO listings(id,farmer_address,crop_type,grade,quantity_kg,harvest_date,region,min_price,metadata_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id.toString(), farmer.toLowerCase(), cropType, "", quantityKg.toString(), 0, "", minPrice.toString(), "", "Active", timestamp, timestamp);
    });
    registry.on("ListingCancelled", (id) => store.prepare("UPDATE listings SET status='Cancelled', updated_at=? WHERE id=?").run(now(), id.toString()));
    registry.on("ListingSold", (id) => store.prepare("UPDATE listings SET status='Sold', updated_at=? WHERE id=?").run(now(), id.toString()));
    listeners.push(() => { registry.removeAllListeners(); });
  }
  if (config.ESCROW_ADDRESS) {
    const escrow = new Contract(config.ESCROW_ADDRESS, escrowAbi, provider);
    escrow.on("OrderCreated", (id, listingId, buyer, amount) => {
      const listing = store.prepare("SELECT farmer_address FROM listings WHERE id=?").get(listingId.toString()) as { farmer_address: string } | undefined;
      store.prepare(`INSERT OR IGNORE INTO orders(id,listing_id,buyer_address,farmer_address,quantity_kg,price_per_kg,total_amount,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(id.toString(), listingId.toString(), buyer.toLowerCase(), listing?.farmer_address || "", "0", "0", amount.toString(), "Created", now());
    });
    escrow.on("Delivered", (id) => store.prepare("UPDATE orders SET state='Delivered' WHERE id=?").run(id.toString()));
    escrow.on("Confirmed", (id) => store.prepare("UPDATE orders SET state='Confirmed', completed_at=? WHERE id=?").run(now(), id.toString()));
    escrow.on("Disputed", (id) => store.prepare("UPDATE orders SET state='Disputed' WHERE id=?").run(id.toString()));
    escrow.on("Refunded", (id) => store.prepare("UPDATE orders SET state='Refunded' WHERE id=?").run(id.toString()));
    listeners.push(() => { escrow.removeAllListeners(); });
  }
  if (config.PRICE_INDEX_ADDRESS) {
    const index = new Contract(config.PRICE_INDEX_ADDRESS, indexAbi, provider);
    index.on("SaleRecorded", (id, _marketKey, pricePerKg) => {
      store.prepare("INSERT OR IGNORE INTO sales(id,crop_type,grade,region,price_per_kg,timestamp) VALUES(?,?,?,?,?,?)").run(id.toString(), "", "", "", pricePerKg.toString(), now());
    });
    index.on("AICommitmentAccepted", (_marketKey, low, high, confidenceBps, dataHash, timestamp) => {
      store.prepare("INSERT INTO price_snapshots(crop_type,grade,region,ai_low,ai_high,confidence_bps,data_hash,timestamp) VALUES(?,?,?,?,?,?,?,?)").run("", "", "", low.toString(), high.toString(), Number(confidenceBps), dataHash, Number(timestamp));
    });
    listeners.push(() => { index.removeAllListeners(); });
  }
  if (config.REPUTATION_ADDRESS) {
    const reputation = new Contract(config.REPUTATION_ADDRESS, reputationAbi, provider);
    reputation.on("CompletedOrderRecorded", (participant, rating) => {
      const current = store.prepare("SELECT completed_orders, disputes, rating_total, rating_count FROM reputation WHERE address=?").get(participant.toLowerCase()) as any || { completed_orders: 0, disputes: 0, rating_total: 0, rating_count: 0 };
      upsertReputation(store, participant, Number(current.completed_orders) + 1, Number(current.disputes), Number(current.rating_total) + Number(rating), Number(current.rating_count) + 1);
    });
    reputation.on("DisputeRecorded", (participant) => {
      const current = store.prepare("SELECT completed_orders, disputes, rating_total, rating_count FROM reputation WHERE address=?").get(participant.toLowerCase()) as any || { completed_orders: 0, disputes: 0, rating_total: 0, rating_count: 0 };
      upsertReputation(store, participant, Number(current.completed_orders), Number(current.disputes) + 1, Number(current.rating_total), Number(current.rating_count));
    });
    listeners.push(() => { reputation.removeAllListeners(); });
  }
  logger.info("Indexer listeners started");
  return () => listeners.forEach((stop) => stop());
}
