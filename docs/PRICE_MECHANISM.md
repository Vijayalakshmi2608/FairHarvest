# FairHarvest Price Mechanism

## Flow

1. The AgriPrice Engine produces an advisory range for one `(cropType, grade, region)` market. The payload contains `priceLow`, `priceHigh`, `confidenceBps`, a Unix `timestamp`, and a monotonically managed `nonce`.
2. The AI service signs the domain-separated payload with the private key corresponding to the configured oracle signer address. The domain includes the adapter address and QIE chain ID, so a signature cannot be reused on another adapter or chain.
3. `PriceOracleAdapter` recovers the signer with EIP-191, checks the signer role, rejects timestamps in the future or older than 24 hours, and marks the signer/nonce pair as used before forwarding the commitment to `PriceIndex`.
4. `PriceIndex` stores the range, confidence, source hash, timestamp, and signer. The frontend can call `getFairPriceRange` for the latest advisory value and can independently inspect the `AICommitmentAccepted` event.

## Why AI cannot secretly manipulate prices

The AI service cannot directly move funds, change a listing, or set a buyer's order price. Its only on-chain capability is to publish a signed, time-bounded advisory commitment through an allow-listed adapter. Invalid signatures, stale payloads, future timestamps, and replayed nonces are rejected. The commitment retains the signer and timestamp, making the provenance auditable.

The farmer's listing price is never replaced with the AI output. `ListingRegistry` uses only the realized-sale median from `PriceIndex` for an optional sanity check: a listing price must be between 0.3x and 3x the median when historical data exists. The first listing for a market is allowed when there is no realized-sale median yet. This rule prevents obvious data-entry mistakes or abusive outliers without forcing a farmer to accept an AI recommendation.

The buyer and farmer still agree on the order price, and `OrderEscrow` settles only the explicit order amount. A future governance process may rotate the oracle signer or disable an adapter, but neither the AI service nor its signature can secretly alter completed sales or escrow balances.

## Canonical price unit and decimals

All on-chain `pricePerKg` values are integers in `STABLECOIN_DECIMALS` base units, with `STABLECOIN_DECIMALS=18`. AI, backend, and frontend must read the same constant. The contracts use integer-only math and do not need to know the value.

The human-facing unit is price per kilogram in QIE Stable Coin. The AI signer and chain publisher convert human model values into 18-decimal base units; the backend stores and returns raw integer strings; and the frontend divides base units by `10**STABLECOIN_DECIMALS` only for display. This keeps signing, escrow totals, index medians, and receipts on one unit convention without changing Solidity or requiring a redeploy.
