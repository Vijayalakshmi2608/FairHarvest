"use client";
import { useCallback, useEffect, useState } from "react";
import { useQieWallet } from "./wallet";
import { parseUnits, type Address } from "viem";
import { publicClient } from "./wallet";

const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const explorer = process.env.NEXT_PUBLIC_EXPLORER_URL || "https://mainnet.qie.digital";

export type RestockRule = { crop: string; thresholdKg: number; buyUpToKg: number; maxPricePerKg: number; maxSpend: number; expiresAt: number; executor?: string; signer?: string; signature?: string; enabled?: boolean };
export type AgentAction = { id: string; crop: string; reason: string; status: "skipped" | "ready" | "submitted"; farmer?: string; quantityKg?: number; pricePerKg?: number; total?: number; txHash?: string; createdAt: number; text: string };

const qieDexRouter = process.env.NEXT_PUBLIC_QIEDEX_ROUTER_ADDRESS as Address | undefined;
const stablecoinAddress = process.env.NEXT_PUBLIC_STABLECOIN_ADDRESS as Address | undefined;
const qiePerQusdc = process.env.NEXT_PUBLIC_QIEDEX_QIE_PER_QUSDC || "1";
const qieDexSlippageBps = BigInt(process.env.NEXT_PUBLIC_QIEDEX_SLIPPAGE_BPS || "100");
const qieDexAbi = [{ type: "function", name: "quoteExactOutput", stateMutability: "view", inputs: [{ name: "amountOut", type: "uint256" }, { name: "tokenOut", type: "address" }], outputs: [{ name: "amountIn", type: "uint256" }] }, { type: "function", name: "swapExactQIEForTokens", stateMutability: "payable", inputs: [{ name: "amountOut", type: "uint256" }, { name: "tokenOut", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [{ name: "amountIn", type: "uint256" }] }] as const;

function canonicalRule(rule: RestockRule, signer: string) {
  return JSON.stringify({ crop: rule.crop, thresholdKg: rule.thresholdKg, buyUpToKg: rule.buyUpToKg, maxPricePerKg: rule.maxPricePerKg, maxSpend: rule.maxSpend, expiresAt: rule.expiresAt, executor: rule.executor || signer });
}

async function authenticatedHeaders(address: string, signMessage: (message: string) => Promise<`0x${string}`>) {
  const nonceResponse = await fetch(`${api}/auth/nonce?address=${encodeURIComponent(address)}`, { cache: "no-store" });
  if (!nonceResponse.ok) throw new Error("Could not obtain a wallet login nonce.");
  const nonce = await nonceResponse.json() as { message: string };
  const signature = await signMessage(nonce.message);
  return { "content-type": "application/json", "x-qie-address": address, "x-qie-message": nonce.message, "x-qie-signature": signature };
}

function actionText(action: Omit<AgentAction, "text">) {
  if (action.status === "submitted") return `Agent detected low stock. Bought ${action.quantityKg ?? ""}kg ${action.crop} from Farmer ${action.farmer || "unknown"} for ${action.pricePerKg ?? ""} QUSDC/kg. Tx: ${action.txHash}`;
  if (action.status === "ready") return `Agent found an eligible ${action.crop} listing but did not submit because the scoped executor is not configured.`;
  return `Agent checked ${action.crop}: ${action.reason}.`;
}

export function useQieDex() {
  const { address, walletClient } = useQieWallet();
  const [pending, setPending] = useState(false);
  const previewQieAmount = (stableAmount: bigint) => {
    const rateBase = parseUnits(qiePerQusdc, 18);
    return (stableAmount * rateBase + 10n ** 18n - 1n) / 10n ** 18n;
  };
  const quoteQieAmount = async (stableAmount: bigint) => {
    if (!stablecoinAddress) throw new Error("QIE Stable Coin address is not configured.");
    if (qieDexRouter) {
      try {
        const amountIn = await publicClient.readContract({ address: qieDexRouter, abi: qieDexAbi, functionName: "quoteExactOutput", args: [stableAmount, stablecoinAddress] });
        return { qieAmount: amountIn, source: "live QIEDex quote" as const };
      } catch {
        // Keep the UI usable with the documented fallback rate until the router's quote endpoint is configured.
      }
    }
    return { qieAmount: previewQieAmount(stableAmount), source: "configured mock rate" as const };
  };
  const swapQieToStablecoin = async (stableAmount: bigint) => {
    if (!address || !walletClient) throw new Error("Connect QIE Wallet first.");
    if (!qieDexRouter || !stablecoinAddress) throw new Error("QIEDex router and QIE Stable Coin addresses must be configured for live QIE checkout.");
    setPending(true);
    try {
      const quote = await quoteQieAmount(stableAmount);
      const minOut = stableAmount * (10_000n - qieDexSlippageBps) / 10_000n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
      const hash = await walletClient.writeContract({ address: qieDexRouter, abi: qieDexAbi, functionName: "swapExactQIEForTokens", args: [minOut, stablecoinAddress, deadline], value: quote.qieAmount });
      await publicClient.waitForTransactionReceipt({ hash });
      return { ...quote, stableAmount, txHash: hash };
    } finally { setPending(false); }
  };
  return { swapQieToStablecoin, quoteQieAmount, previewQieAmount, pending, configured: Boolean(qieDexRouter && stablecoinAddress), quoteSource: qieDexRouter ? "live QIEDex quote" : "configured mock rate", qiePerQusdc };
}

export function useAutoRestockAgent() {
  const { address, walletClient } = useQieWallet();
  const [rule, setRule] = useState<RestockRule>();
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const refreshActions = useCallback(async () => {
    if (!address) { setActions([]); return; }
    const response = await fetch(`${api}/agent/actions?merchant=${encodeURIComponent(address)}`, { cache: "no-store" });
    if (!response.ok) return;
    const rows = await response.json() as Array<Omit<AgentAction, "text">>;
    setActions(rows.map((item) => ({ ...item, text: actionText(item) })));
  }, [address]);

  useEffect(() => { void refreshActions(); if (!address) return; const timer = window.setInterval(() => void refreshActions(), 10_000); return () => window.clearInterval(timer); }, [address, refreshActions]);

  const saveRule = async (next: RestockRule) => {
    if (!address || !walletClient) throw new Error("Connect QIE Wallet first.");
    if (next.maxSpend <= 0 || next.buyUpToKg <= 0 || next.maxPricePerKg <= 0 || next.buyUpToKg * next.maxPricePerKg > next.maxSpend) throw new Error("The signed maximum spend must cover no more than the configured quantity × price.");
    setLoading(true); setError(undefined);
    try {
      const signer = address;
      const executor = next.executor || address;
      const signature = await walletClient.signMessage({ message: canonicalRule({ ...next, executor }, signer) });
      const headers = await authenticatedHeaders(address, (message) => walletClient.signMessage({ message }));
      const response = await fetch(`${api}/agent/rules`, { method: "POST", headers, body: JSON.stringify({ ...next, executor, signer, signature }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save signed rule.");
      setRule(body); await refreshActions();
      return body;
    } catch (cause) { const message = cause instanceof Error ? cause.message : "Could not save signed rule."; setError(message); throw new Error(message); } finally { setLoading(false); }
  };

  const updateInventory = async (crop: string, stockKg: number) => {
    if (!address || !walletClient) throw new Error("Connect QIE Wallet first.");
    const headers = await authenticatedHeaders(address, (message) => walletClient.signMessage({ message }));
    const response = await fetch(`${api}/agent/inventory`, { method: "PUT", headers, body: JSON.stringify({ crop, stockKg }) });
    if (!response.ok) throw new Error("Could not update stock level.");
  };

  const runNow = async () => {
    if (!address || !walletClient) throw new Error("Connect QIE Wallet first.");
    const headers = await authenticatedHeaders(address, (message) => walletClient.signMessage({ message }));
    const response = await fetch(`${api}/agent/run`, { method: "POST", headers, body: "{}" });
    if (!response.ok) throw new Error("Could not run the agent.");
    await refreshActions();
  };

  return { address, rule, actions, saveRule, updateInventory, runNow, refreshActions, loading, error, configured: Boolean(process.env.NEXT_PUBLIC_API_URL) && Boolean(address), explorer };
}
