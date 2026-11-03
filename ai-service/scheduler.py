from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from chain import publish_commitment
from data import load_markets, market_request
from model import suggest_price
from signer import sign_price
from schemas import SignPriceRequest

logger = logging.getLogger("fairharvest.ai.scheduler")


def _nonce_path() -> Path:
    return Path(os.getenv("NONCE_FILE", str(Path(__file__).parent / "data" / "nonce_state.json")))


def _read_nonce() -> int:
    path = _nonce_path()
    if not path.exists():
        return 0
    payload = json.loads(path.read_text())
    if isinstance(payload, int):
        return payload
    # Migrate the old per-market format safely by continuing after its maximum.
    if isinstance(payload, dict):
        return max((int(value) for value in payload.values()), default=0)
    return 0


def _next_nonce() -> int:
    path = _nonce_path()
    nonce = _read_nonce() + 1
    path.write_text(json.dumps({"global": nonce}, indent=2) + "\n")
    return nonce


def run_nightly_once() -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    publish_enabled = os.getenv("ENABLE_ONCHAIN_PUBLISH", "false").lower() == "true"
    for item in load_markets():
        request = market_request(item)
        result = suggest_price(request)
        key = f"{request.cropType}|{request.grade}|{request.region}"
        if result.status != "ok":
            results.append({"market": key, "status": "insufficient_data"})
            continue
        nonce = _next_nonce()
        commitment = sign_price(SignPriceRequest(**request.model_dump(), nonce=nonce))
        tx_hash = publish_commitment(commitment) if publish_enabled else "disabled"
        results.append({"market": key, "status": "published" if publish_enabled else "signed_only", "txHash": tx_hash})
        logger.info("nightly commitment %s: %s", key, results[-1]["status"])
    return results


async def nightly_loop() -> None:
    if os.getenv("ENABLE_NIGHTLY_JOB", "true").lower() != "true":
        logger.info("nightly job disabled")
        return
    if os.getenv("NIGHTLY_RUN_ON_START", "false").lower() == "true":
        try:
            run_nightly_once()
        except Exception:
            logger.exception("initial nightly run failed")
    while True:
        now = datetime.now(timezone.utc)
        next_midnight = (now + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
        await asyncio.sleep(max(60, (next_midnight - now).total_seconds()))
        try:
            run_nightly_once()
        except Exception:
            logger.exception("nightly run failed")
