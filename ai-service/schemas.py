from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field, field_validator


class PriceRequest(BaseModel):
    cropType: str = Field(min_length=1, max_length=80)
    grade: str = Field(min_length=1, max_length=40)
    region: str = Field(min_length=1, max_length=80)
    quantity: float = Field(gt=0)
    recentCompletedSalePrices: list[float] = Field(default_factory=list)
    seasonality: float | dict[str, Any] = 1.0
    weather: dict[str, Any] | None = None

    @field_validator("recentCompletedSalePrices")
    @classmethod
    def prices_are_positive(cls, values: list[float]) -> list[float]:
        if any(value <= 0 for value in values):
            raise ValueError("sale prices must be positive")
        return values

    @property
    def seasonality_factor(self) -> float:
        raw = self.seasonality
        factor = raw if isinstance(raw, (int, float)) else raw.get("factor", 1.0)
        if not 0.5 <= float(factor) <= 1.5:
            raise ValueError("seasonality factor must be between 0.5 and 1.5")
        return float(factor)


class PriceResponse(BaseModel):
    status: str = "ok"
    priceLow: float | None = None
    priceHigh: float | None = None
    confidenceBps: int = 0
    explanation: str
    factors: list[str] = Field(default_factory=list, min_length=3, max_length=3)
    dataPoints: int = 0
    model: str = "median_mad_percentile_band"
    dataHash: str | None = None


class SignPriceRequest(PriceRequest):
    timestamp: int | None = None
    nonce: int = Field(ge=0)


class SignPriceResponse(BaseModel):
    cropType: str
    grade: str
    region: str
    priceLow: float
    priceHigh: float
    confidenceBps: int
    timestamp: int
    nonce: int
    digest: str
    signature: str
    signer: str
    dataHash: str


class SupportedMarket(BaseModel):
    cropType: str
    grade: str
    region: str
