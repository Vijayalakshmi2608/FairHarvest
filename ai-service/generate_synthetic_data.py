"""Generate SYNTHETIC data only; never use this dataset as production market evidence."""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path


def build(seed: int = 42) -> dict:
    rng = random.Random(seed)
    markets = []
    for crop, grade, region, base, seasonal in [
        ("wheat", "A", "pilot", 100.0, 1.02),
        ("wheat", "B", "pilot", 78.0, 0.98),
        ("maize", "A", "pilot", 92.0, 1.04),
    ]:
        prices = [round(base * seasonal * (1 + rng.gauss(0, 0.07)), 2) for _ in range(36)]
        markets.append({
            "cropType": crop,
            "grade": grade,
            "region": region,
            "quantity": 100,
            "prices": prices,
            "seasonality": seasonal,
            "weather": {"label": "synthetic neutral conditions", "weather_factor": 1.0},
        })
    return {"synthetic": True, "warning": "Synthetic data for local development only; not a price oracle.", "seed": seed, "markets": markets}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(Path(__file__).parent / "data" / "synthetic_prices.json"))
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(build(args.seed), indent=2) + "\n")
    print(f"SYNTHETIC ONLY: wrote {len(output.read_text())} bytes to {output}")
