from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException

from data import supported_markets
from model import suggest_price
from schemas import PriceRequest, PriceResponse, SignPriceRequest, SignPriceResponse
from scheduler import nightly_loop
from signer import sign_price

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
nightly_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global nightly_task
    nightly_task = asyncio.create_task(nightly_loop())
    yield
    if nightly_task:
        nightly_task.cancel()
        try:
            await nightly_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="FairHarvest AgriPrice Engine",
    description="A transparent advisory range model. It never sets or enforces farmer prices.",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "ai-service", "status": "ok"}


@app.get("/supported-markets")
def markets():
    return supported_markets()


@app.post("/suggest-price", response_model=PriceResponse)
def suggest(request: PriceRequest) -> PriceResponse:
    return suggest_price(request)


@app.post("/sign-price", response_model=SignPriceResponse)
def sign(request: SignPriceRequest) -> SignPriceResponse:
    try:
        return sign_price(request)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/model-policy")
def model_policy() -> dict:
    return {
        "advisory_only": True,
        "minimumDataPoints": 10,
        "method": "median + 10th/90th percentile band + 2.5*MAD robust band + bounded seasonality/weather factor",
        "priceAuthority": "ListingRegistry and buyer/farmer order agreement, never this service",
    }
