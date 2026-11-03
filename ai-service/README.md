# FairHarvest AgriPrice Engine

This is a lightweight, explainable FastAPI service for FairHarvest. It suggests a price range from recent completed sales; it does **not** set prices, approve listings, move escrow funds, or override farmer/buyer choices.

## Model logic

The service requires at least 10 recent completed sale prices. With fewer than 10 points, `/suggest-price` returns `status: insufficient_data`, no range, and an explanation asking for more completed sales.

For a valid sample, the model:

1. Computes the median as the central estimate.
2. Computes the empirical 10th and 90th percentiles.
3. Computes the median absolute deviation (MAD) and constructs a robust `median ± 2.5*MAD` band.
4. Uses the wider lower and upper sides of those two bands.
5. Applies a supplied seasonality factor and, only when explicitly supplied, a bounded `weather_factor` between `0.85` and `1.15`.
6. Derives confidence from sample count and relative range width, bounded to 3,500–9,500 basis points.

The response includes a maximum-two-sentence explanation and exactly three plain-language factor strings. The quantity is disclosed as a factor but does not create false precision or an invented demand model.

## Endpoints

```text
GET  /health
GET  /supported-markets
GET  /model-policy
POST /suggest-price
POST /sign-price
```

Example request:

```json
{
  "cropType": "wheat",
  "grade": "A",
  "region": "pilot",
  "quantity": 100,
  "recentCompletedSalePrices": [98, 101, 103, 97, 100, 105, 99, 102, 96, 104, 101],
  "seasonality": {"label": "harvest", "factor": 1.02},
  "weather": {"label": "normal", "weather_factor": 1.0}
}
```

## Signing flow

`POST /sign-price` first runs the same transparent model, refuses to sign if there are fewer than 10 data points, converts the suggested prices to the configured stablecoin decimals, and signs the exact domain-separated payload expected by `PriceOracleAdapter`:

```text
(adapter address, chain ID, cropType, grade, region,
 priceLow, priceHigh, confidenceBps, timestamp, nonce)
```

The signature is EIP-191 and the response includes the digest, signature, signer, nonce, timestamp, and adapter-compatible `dataHash`. The on-chain adapter still performs the authoritative signature, freshness, and replay checks.

## Nightly commitment job

The FastAPI lifespan starts an application-native scheduler. It runs shortly after UTC midnight, loads every market in `HISTORICAL_DATA_PATH`, signs a fresh commitment with one global monotonically increasing nonce stream for the oracle signer, and submits it through `PriceOracleAdapter` only when `ENABLE_ONCHAIN_PUBLISH=true` and the RPC, oracle key, and adapter address are configured. Set `NIGHTLY_RUN_ON_START=true` for a local smoke run; leave it false in normal operation.

The scheduler is intentionally owned by the service, not by the model. For production reliability, run more than one service replica only with a shared nonce store or a separate single-runner deployment; the included JSON nonce file is suitable for local development only.

## Synthetic data and transparent metadata

`generate_synthetic_data.py` creates clearly labeled fictional data for local development. It must not be presented as market evidence. `train_model.py` writes descriptive metadata—median, percentiles, MAD, and sample count—and explicitly does not fit a black-box estimator.

```bash
python generate_synthetic_data.py
python train_model.py
```

## Run locally

```bash
cd ai-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python generate_synthetic_data.py
uvicorn main:app --reload --port 8000
```

The service remains advisory. The marketplace's on-chain `ListingRegistry` applies the independent 0.3x–3x realized-index sanity bound, and the farmer is never required to accept the AI range.
