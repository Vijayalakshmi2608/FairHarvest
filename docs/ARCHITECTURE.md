# FairHarvest QIE Architecture

FairHarvest has two cooperating layers.

## 1. AgriPrice Engine

The off-chain AI service ingests the pilot crop's reference data, produces a price range (`priceLow`, `priceHigh`) and a confidence score in basis points, and records a content-addressed `dataHash`. An authorized oracle signer signs the commitment. The signed commitment is submitted to `PriceIndex`, which verifies the signer and stores the latest commitment by crop, grade, and region. The chain stores the commitment and provenance, not the model's private features or weights.

## 2. DirectMarket contracts

`ListingRegistry` records farmer listings and their lifecycle. `OrderEscrow` accepts QIE Stable Coin, tracks delivery and confirmation, applies the capped platform fee, and uses pull payments for withdrawals. `Reputation` records completed orders, disputes, and ratings. `PriceIndex` records completed sale prices and exposes median historical prices alongside the AI commitment.

QIE Wallet supplies authentication and transaction signing. QIE ID can be checked by the application and/or added as a future verification gate. QIE Stable Coin is the settlement asset. QIEDex is optional for future conversion, and the QIE oracle or signed feed supplies reference data.
