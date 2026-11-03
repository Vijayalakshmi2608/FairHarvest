"""Train the transparent model metadata from historical data.

This intentionally does not fit a black-box model. It records auditable descriptive
statistics used by model.py: median, percentiles, MAD, and sample count.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from statistics import median

from data import load_markets
from model import percentile


def mad(values: list[float], center: float) -> float:
    return median([abs(value - center) for value in values])


def train(input_path: str | None, output_path: str) -> None:
    markets = load_markets(input_path)
    metadata = {
        "model": "median_mad_percentile_band",
        "black_box": False,
        "minimum_data_points": 10,
        "features": ["completed sale prices", "seasonality factor", "explicit bounded weather_factor"],
        "markets": [],
    }
    for item in markets:
        prices = [float(value) for value in item.get("prices", [])]
        if not prices:
            continue
        center = median(prices)
        metadata["markets"].append({
            "cropType": item["cropType"],
            "grade": item["grade"],
            "region": item["region"],
            "dataPoints": len(prices),
            "median": center,
            "p10": percentile(prices, 0.10),
            "p90": percentile(prices, 0.90),
            "mad": mad(prices, center),
        })
    Path(output_path).write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"Wrote transparent model metadata to {output_path}; no black-box estimator was fitted.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=None)
    parser.add_argument("--output", default=str(Path(__file__).parent / "model_metadata.json"))
    args = parser.parse_args()
    train(args.input, args.output)
