from __future__ import annotations

import os
import time
from decimal import Decimal, ROUND_DOWN

from eth_abi import encode
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak, to_checksum_address

from model import suggest_price
from schemas import PriceRequest, SignPriceRequest, SignPriceResponse


def _units(value: float) -> int:
    decimals = int(os.getenv("STABLECOIN_DECIMALS", "18"))
    return int((Decimal(str(value)) * (Decimal(10) ** decimals)).to_integral_value(rounding=ROUND_DOWN))


def _payload_digest(adapter_address: str, chain_id: int, request: SignPriceRequest, low: int, high: int, confidence: int, timestamp: int) -> bytes:
    encoded = encode(
        ["address", "uint256", "string", "string", "string", "uint256", "uint256", "uint256", "uint256", "uint256"],
        [to_checksum_address(adapter_address), chain_id, request.cropType, request.grade, request.region, low, high, confidence, timestamp, request.nonce],
    )
    return keccak(encoded)


def request_result_confidence(request: SignPriceRequest) -> int:
    result = suggest_price(request)
    if result.status != "ok" or result.confidenceBps <= 0:
        raise ValueError("insufficient data for a signed range")
    return result.confidenceBps


def sign_price(request: SignPriceRequest) -> SignPriceResponse:
    private_key = os.getenv("AI_ORACLE_PRIVATE_KEY")
    adapter_address = os.getenv("PRICE_ORACLE_ADAPTER_ADDRESS")
    if not private_key or not adapter_address:
        raise RuntimeError("AI_ORACLE_PRIVATE_KEY and PRICE_ORACLE_ADAPTER_ADDRESS must be configured")
    chain_id = int(os.getenv("CHAIN_ID", "1990"))
    result = suggest_price(request)
    if result.status != "ok" or result.priceLow is None or result.priceHigh is None:
        raise ValueError("insufficient data for a signed range")
    timestamp = request.timestamp or int(time.time())
    low = _units(result.priceLow)
    high = _units(result.priceHigh)
    confidence = result.confidenceBps
    digest = _payload_digest(adapter_address, chain_id, request, low, high, confidence, timestamp)
    data_hash = keccak(encode(["string", "string", "string", "uint256", "uint256", "uint256", "uint256", "uint256"], [request.cropType, request.grade, request.region, low, high, confidence, timestamp, request.nonce]))
    account = Account.from_key(private_key)
    signed = account.sign_message(encode_defunct(primitive=digest))
    return SignPriceResponse(
        cropType=request.cropType,
        grade=request.grade,
        region=request.region,
        priceLow=result.priceLow,
        priceHigh=result.priceHigh,
        confidenceBps=confidence,
        timestamp=timestamp,
        nonce=request.nonce,
        digest="0x" + digest.hex(),
        signature="0x" + signed.signature.hex(),
        signer=account.address,
        dataHash="0x" + data_hash.hex(),
    )
