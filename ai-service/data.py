from __future__ import annotations

import json
import os
from pathlib import Path

from schemas import PriceRequest, SupportedMarket


DEFAULT_DATA_PATH = Path(__file__).parent / "data" / "synthetic_prices.json"


def load_markets(path: str | None = None) -> list[dict]:
    data_path = Path(path or os.getenv("HISTORICAL_DATA_PATH", str(DEFAULT_DATA_PATH)))
    if not data_path.exists():
        return []
    with data_path.open() as handle:
        payload = json.load(handle)
    return payload.get("markets", [])


def supported_markets() -> list[SupportedMarket]:
    return [SupportedMarket(cropType=item["cropType"], grade=item["grade"], region=item["region"]) for item in load_markets()]


def market_request(item: dict) -> PriceRequest:
    return PriceRequest(
        cropType=item["cropType"],
        grade=item["grade"],
        region=item["region"],
        quantity=float(item.get("quantity", 1)),
        recentCompletedSalePrices=[float(value) for value in item.get("prices", [])],
        seasonality=item.get("seasonality", 1.0),
        weather=item.get("weather"),
    )
