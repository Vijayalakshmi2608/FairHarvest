"use client";
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, http, type Address } from "viem";

const network = (process.env.NEXT_PUBLIC_NETWORK || "mainnet").toLowerCase() === "testnet" ? "testnet" : "mainnet";
const mainnetRpcUrls = ["https://rpc1mainnet.qie.digital", "https://rpc2mainnet.qie.digital", "https://rpc3mainnet.qie.digital", "https://rpc4mainnet.qie.digital", "https://rpc5mainnet.qie.digital"] as const;
const testnetRpcUrls = ["https://rpc2testnet.qie.digital"] as const;
export const qieMainnet = { id: 1990, name: "QIE Blockchain Mainnet", nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 }, rpcUrls: { default: { http: mainnetRpcUrls }, public: { http: mainnetRpcUrls } }, blockExplorers: { default: { name: "QIE Explorer", url: "https://mainnet.qie.digital" } } } as const;
export const qieTestnet = { id: 1983, name: "QIE Blockchain Testnet", nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 }, rpcUrls: { default: { http: testnetRpcUrls }, public: { http: testnetRpcUrls } }, blockExplorers: { default: { name: "QIE Testnet Explorer", url: "https://testnet.qie.digital" } } } as const;
export const qieChain = network === "testnet" ? qieTestnet : qieMainnet;
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || qieChain.rpcUrls.default.http[0];
export const publicClient = createPublicClient({ chain: qieChain, transport: http(rpcUrl) });
export const shortAddress = (address?: string) => address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";

declare global { interface Window { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } } }

async function ensureQieNetwork(chainId: string) {
  if (!window.ethereum) throw new Error("Install or open QIE Wallet to continue.");
  const parsedChainId = Number.parseInt(chainId, 16);
  const isQieMainnet = parsedChainId === 1990;
  const isExpectedNetwork = network === "testnet" ? parsedChainId === 1983 : isQieMainnet;
  if (isExpectedNetwork) return;
  const targetChainId = `0x${qieChain.id.toString(16)}`;
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetChainId }] });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: targetChainId, chainName: qieChain.name, nativeCurrency: qieChain.nativeCurrency, rpcUrls: [...qieChain.rpcUrls.default.http], blockExplorerUrls: [qieChain.blockExplorers.default.url] }] });
  }
}

export function useQieWallet() {
  const [address, setAddress] = useState<Address>(); const [chainId, setChainId] = useState<number>(); const [connecting, setConnecting] = useState(false);
  const connect = useCallback(async () => { if (!window.ethereum) throw new Error("Install or open QIE Wallet to continue."); setConnecting(true); try { const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[]; const chain = await window.ethereum.request({ method: "eth_chainId" }) as string; await ensureQieNetwork(chain); const finalChain = await window.ethereum.request({ method: "eth_chainId" }) as string; setAddress(accounts[0] as Address); setChainId(Number.parseInt(finalChain, 16)); } finally { setConnecting(false); } }, []);
  useEffect(() => { if (!window.ethereum) return; window.ethereum.request({ method: "eth_accounts" }).then((a) => { const accounts = a as string[]; if (accounts[0]) setAddress(accounts[0] as Address); }); }, []);
  const walletClient = address && window.ethereum ? createWalletClient({ account: address, chain: qieChain, transport: custom(window.ethereum) }) : undefined;
  return { address, chainId, connecting, connect, walletClient, isWrongNetwork: Boolean(chainId && chainId !== qieChain.id) };
}
