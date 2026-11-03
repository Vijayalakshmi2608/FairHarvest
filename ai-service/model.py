from __future__ import annotations

import hashlib
import json
import math
from statistics import median

from schemas import PriceRequest, PriceResponse

MIN_DATA_POINTS = 10


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * p
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _weather_factor(weather: dict | None) -> float:
    """Use only an explicit bounded weather_factor; raw weather is never silently guessed."""
    if not weather:
        return 1.0
    raw = weather.get("weather_factor", 1.0)
    return min(1.15, max(0.85, float(raw)))


def _data_hash(request: PriceRequest) -> str:
    payload = {
        "cropType": request.cropType,
        "grade": request.grade,
        "region": request.region,
        "prices": sorted(request.recentCompletedSalePrices),
        "seasonality": request.seasonality,
        "weather": request.weather,
    }
    return "0x" + hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def suggest_price(request: PriceRequest) -> PriceResponse:
    prices = request.recentCompletedSalePrices
    count = len(prices)
    if count < MIN_DATA_POINTS:
        return PriceResponse(
            status="insufficient_data",
            explanation=f"Insufficient data: at least {MIN_DATA_POINTS} recent completed sales are required before suggesting a range.",
            factors=["No price range was produced.", "Collect more completed on-chain sales.", "The AI remains advisory and cannot block a listing."],
            dataPoints=count,
            dataHash=_data_hash(request),
        )

    center = median(prices)
    q10 = percentile(prices, 0.10)
    q90 = percentile(prices, 0.90)
    deviations = [abs(value - center) for value in prices]
    mad = median(deviations)
    # Combine a robust MAD band with empirical percentiles. The larger side is retained
    # so a small but real tail is not hidden by a tight MAD estimate.
    robust_low = max(0.0, center - 2.5 * mad)
    robust_high = center + 2.5 * mad
    low = min(q10, robust_low)
    high = max(q90, robust_high)
    seasonal_factor = request.seasonality_factor
    weather_factor = _weather_factor(request.weather)
    adjustment = seasonal_factor * weather_factor
    low *= adjustment
    high *= adjustment

    # Quantity is disclosed as a factor but does not create fake precision.
    spread = (high - low) / max(center * adjustment, 1e-9)
    dispersion_penalty = min(4_000, int(spread * 4_000))
    confidence = max(3_500, min(9_500, 9_500 - dispersion_penalty + min(1_000, count * 25)))
    explanation = (
        f"The suggested range centers on the median of {count} completed sales and uses the wider of a 10th–90th percentile band and a 2.5-MAD robust band. "
        f"It is adjusted by the supplied seasonality factor ({seasonal_factor:.2f}) and an explicit weather factor ({weather_factor:.2f}); it does not set or enforce a price."
    )
    factors = [
        f"Median completed-sale price: {center:.2f}.",
        f"Robust dispersion: MAD {mad:.2f}; empirical band {q10:.2f}–{q90:.2f}.",
        f"Adjustments: seasonality {seasonal_factor:.2f}, weather {weather_factor:.2f}, quantity {request.quantity:g}.",
    ]
    return PriceResponse(
        status="ok",
        priceLow=round(low, 8),
        priceHigh=round(high, 8),
        confidenceBps=confidence,
        explanation=explanation,
        factors=factors,
        dataPoints=count,
        dataHash=_data_hash(request),
    )
