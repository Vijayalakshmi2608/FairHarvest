"use client";
import { useState } from "react";
import { parseUnits, type Address } from "viem";
import { publicClient, useQieWallet } from "./wallet";

export const addresses = {
  registry: process.env.NEXT_PUBLIC_LISTING_REGISTRY_ADDRESS as Address | undefined,
  escrow: process.env.NEXT_PUBLIC_ORDER_ESCROW_ADDRESS as Address | undefined,
  stablecoin: process.env.NEXT_PUBLIC_STABLECOIN_ADDRESS as Address | undefined,
  index: process.env.NEXT_PUBLIC_PRICE_INDEX_ADDRESS as Address | undefined,
};
const registryAbi = [{ type: "function", name: "createListing", stateMutability: "nonpayable", inputs: [{ name: "cropType", type: "string" }, { name: "grade", type: "string" }, { name: "quantityKg", type: "uint256" }, { name: "harvestDate", type: "uint64" }, { name: "region", type: "string" }, { name: "minPrice", type: "uint256" }, { name: "ipfsMetadataHash", type: "string" }] } ] as const;
const stablecoinAbi = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }] } ] as const;
const escrowAbi = [{ type: "function", name: "createOrder", stateMutability: "nonpayable", inputs: [{ name: "listingId", type: "uint256" }, { name: "quantityKg", type: "uint256" }, { name: "agreedPricePerKg", type: "uint256" }] }, { type: "function", name: "confirmDelivery", stateMutability: "nonpayable", inputs: [{ name: "orderId", type: "uint256" }, { name: "buyerRating", type: "uint8" }] }, { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [] }] as const;

export function useContractActions() {
  const { walletClient, address } = useQieWallet();
  const [pending, setPending] = useState<string>();
  const send = async (label: string, fn: () => Promise<`0x${string}`>) => { if (!walletClient || !address) throw new Error("Connect QIE Wallet first."); setPending(label); try { const hash = await fn(); await publicClient.waitForTransactionReceipt({ hash }); return hash; } finally { setPending(undefined); } };
  const createListing = (data: { crop: string; grade: string; quantity: string; harvestDate: number; region: string; price: string; metadata: string }) => send("Creating listing…", () => walletClient!.writeContract({ address: addresses.registry!, abi: registryAbi, functionName: "createListing", args: [data.crop, data.grade, BigInt(data.quantity), BigInt(data.harvestDate), data.region, parseUnits(data.price, 18), data.metadata] }));
  const buy = (listingId: string, quantity: string, price: string, onStep?: (step: "approve" | "escrow") => void) => send("Approving stablecoin…", async () => { const amount = parseUnits((Number(quantity) * Number(price)).toString(), 18); onStep?.("approve"); const approvalHash = await walletClient!.writeContract({ address: addresses.stablecoin!, abi: stablecoinAbi, functionName: "approve", args: [addresses.escrow!, amount] }); await publicClient.waitForTransactionReceipt({ hash: approvalHash }); onStep?.("escrow"); setPending("Paying into escrow…"); return walletClient!.writeContract({ address: addresses.escrow!, abi: escrowAbi, functionName: "createOrder", args: [BigInt(listingId), BigInt(quantity), parseUnits(price, 18)] }); });
  const confirmDelivery = (orderId: string, rating: number) => send("Confirming delivery…", () => walletClient!.writeContract({ address: addresses.escrow!, abi: escrowAbi, functionName: "confirmDelivery", args: [BigInt(orderId), rating] }));
  const withdraw = () => send("Withdrawing stablecoin…", () => walletClient!.writeContract({ address: addresses.escrow!, abi: escrowAbi, functionName: "withdraw", args: [] }));
  return { createListing, buy, confirmDelivery, withdraw, pending, configured: Boolean(addresses.registry && addresses.escrow && addresses.stablecoin) };
}
