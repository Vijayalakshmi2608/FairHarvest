from __future__ import annotations

import os
from decimal import Decimal

from web3 import Web3

from schemas import SignPriceResponse

ADAPTER_ABI = [{
    "inputs": [
        {"name": "cropType", "type": "string"}, {"name": "grade", "type": "string"}, {"name": "region", "type": "string"},
        {"name": "priceLow", "type": "uint256"}, {"name": "priceHigh", "type": "uint256"}, {"name": "confidenceBps", "type": "uint256"},
        {"name": "timestamp", "type": "uint256"}, {"name": "nonce", "type": "uint256"}, {"name": "signature", "type": "bytes"}
    ],
    "name": "submitPriceRange", "outputs": [], "stateMutability": "nonpayable", "type": "function"
}]


def price_units(value: float) -> int:
    decimals = int(os.getenv("STABLECOIN_DECIMALS", "18"))
    return int(Decimal(str(value)) * (Decimal(10) ** decimals))


def publish_commitment(commitment: SignPriceResponse) -> str:
    rpc_url = os.getenv("RPC_URL")
    private_key = os.getenv("AI_ORACLE_PRIVATE_KEY")
    adapter_address = os.getenv("PRICE_ORACLE_ADAPTER_ADDRESS")
    if not rpc_url or not private_key or not adapter_address:
        raise RuntimeError("RPC_URL, AI_ORACLE_PRIVATE_KEY, and PRICE_ORACLE_ADAPTER_ADDRESS are required for on-chain publishing")
    web3 = Web3(Web3.HTTPProvider(rpc_url))
    account = web3.eth.account.from_key(private_key)
    contract = web3.eth.contract(address=Web3.to_checksum_address(adapter_address), abi=ADAPTER_ABI)
    tx = contract.functions.submitPriceRange(
        commitment.cropType, commitment.grade, commitment.region,
        price_units(commitment.priceLow), price_units(commitment.priceHigh), commitment.confidenceBps,
        commitment.timestamp, commitment.nonce, bytes.fromhex(commitment.signature.removeprefix("0x")),
    ).build_transaction({
        "from": account.address,
        "nonce": web3.eth.get_transaction_count(account.address, "pending"),
        "chainId": web3.eth.chain_id,
        "gas": int(os.getenv("ORACLE_GAS_LIMIT", "500000")),
        "maxFeePerGas": web3.to_wei(os.getenv("MAX_FEE_GWEI", "2"), "gwei"),
        "maxPriorityFeePerGas": web3.to_wei(os.getenv("MAX_PRIORITY_FEE_GWEI", "1"), "gwei"),
    })
    signed = account.sign_transaction(tx)
    tx_hash = web3.eth.send_raw_transaction(signed.raw_transaction)
    return tx_hash.hex()
