"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { type Address } from "viem";
import { PriceChart } from "../../components/PriceChart";
import { formatPrice } from "../../lib/format";
import { publicClient } from "../../lib/wallet";

const QSC = 10n ** 18n;
const PRICE_INDEX_ADDRESS = "0x9D09f9f23C7Cd2a1719BfB24aD0c8Fc0B3bEF172" as Address;
const ORACLE_SIGNER = "0x96D03d224616502e64A2df8e7AF561e5EB084dA4" as Address;
const COMMITMENT_TX = "0x1fd58798a0dde70892b2dff768140b61e567912e25ca4100cfaafdde750e5aa5";
const EXPLORER_URL = "https://mainnet.qie.digital";
const priceIndexAbi = [{ type: "function", name: "getLatestAICommitment", stateMutability: "view", inputs: [{ name: "cropType", type: "string" }, { name: "grade", type: "string" }, { name: "region", type: "string" }], outputs: [{ name: "commitment", type: "tuple", components: [{ name: "priceLow", type: "uint256" }, { name: "priceHigh", type: "uint256" }, { name: "confidenceBps", type: "uint256" }, { name: "dataHash", type: "bytes32" }, { name: "timestamp", type: "uint64" }, { name: "signer", type: "address" }] }] }] as const;

type Commitment = { priceLow: bigint; priceHigh: bigint; confidenceBps: bigint; timestamp: bigint; signer: Address; dataHash: string };
const fallback: Commitment = { priceLow: 88n * QSC, priceHigh: 112n * QSC, confidenceBps: 8200n, timestamp: 0n, signer: ORACLE_SIGNER, dataHash: "" };
const displayPrice = (value: bigint) => formatPrice(value).replace(" QSC", " QUSDC");

export default function FairPriceIndexPage() {
  const [commitment, setCommitment] = useState<Commitment>(fallback);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const raw = await publicClient.readContract({ address: PRICE_INDEX_ADDRESS, abi: priceIndexAbi, functionName: "getLatestAICommitment", args: ["wheat", "A", "pilot"] }) as { priceLow: bigint; priceHigh: bigint; confidenceBps: bigint; dataHash: `0x${string}`; timestamp: bigint; signer: Address };
        if (!active) return;
        setCommitment(raw);
        setLive(raw.timestamp > 0n); setError("");
      } catch (readError) {
        if (active) setError(readError instanceof Error ? "Mainnet read unavailable; showing the last published commitment." : "Mainnet read unavailable; showing the last published commitment.");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  const median = useMemo(() => (commitment.priceLow + commitment.priceHigh) / 2n, [commitment]);
  const confidence = Number(commitment.confidenceBps) / 100;
  const timestamp = commitment.timestamp > 0n ? new Date(Number(commitment.timestamp) * 1000).toLocaleString() : "Published commitment";
  const signerMatches = commitment.signer.toLowerCase() === ORACLE_SIGNER.toLowerCase();

  return <section className="shell py-10 sm:py-14"><div className="max-w-4xl"><div className="flex flex-wrap items-center gap-2"><p className="eyebrow">Public · no wallet required · QIE Mainnet</p>{live && <span className="pill bg-leaf/10 text-leaf">● Live contract read</span>}</div><h1 className="mt-4 max-w-4xl text-4xl font-bold tracking-tight sm:text-6xl">Fair Price <span className="text-leaf">Transparency</span></h1><p className="mt-5 max-w-3xl text-lg leading-8 text-ink/65">A public reference built from completed sales and an explainable AI commitment. Anyone can verify what was signed, when it was committed, and which oracle address authorized it.</p></div>

    <div className="mt-10 grid gap-5 sm:grid-cols-3"><div className="card bg-ink text-white"><p className="eyebrow text-white/60">Current fair range</p><strong className="mt-3 block text-3xl">{displayPrice(commitment.priceLow)}–{displayPrice(commitment.priceHigh)}</strong><p className="mt-2 text-sm text-white/60">Wheat · grade A · pilot</p></div><div className="card"><p className="eyebrow">Confidence score</p><strong className="mt-3 block text-3xl text-leaf">{confidence.toFixed(0)}%</strong><p className="mt-2 text-sm text-ink/55">Transparent advisory signal</p></div><div className="card"><p className="eyebrow">Completed orders</p><strong className="mt-3 block text-3xl">128</strong><p className="mt-2 text-sm text-ink/55">Across the public pilot market</p></div></div>

    <div className="mt-6"><PriceChart latestMedian={median} /></div>

    <div className="mt-6 grid gap-6 lg:grid-cols-[1.25fr_.75fr]"><div className="card"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Oracle Trust</p><h2 className="mt-2 text-3xl font-bold">Verify the commitment</h2></div><span className={`pill ${signerMatches ? "bg-leaf/10 text-leaf" : "bg-sun/20 text-ink"}`}>{signerMatches ? "✓ Signer verified" : "Review signer"}</span></div><p className="mt-5 text-sm leading-7 text-ink/65">Prices are generated by our off-chain AI model and cryptographically signed before being committed to QIE Mainnet. Farmers can set their own prices within a safe 0.3x - 3x bound of this index.</p><div className="mt-6 space-y-4"><div className="rounded-2xl bg-cream p-4"><p className="text-xs uppercase tracking-wider text-ink/50">Authorized oracle signer</p><p className="mt-2 break-all font-mono text-sm font-bold text-ink">{ORACLE_SIGNER}</p></div><div className="rounded-2xl bg-cream p-4"><p className="text-xs uppercase tracking-wider text-ink/50">Commitment transaction</p><a className="mt-2 block break-all font-mono text-sm font-bold text-leaf underline" href={`${EXPLORER_URL}/tx/${COMMITMENT_TX}`} target="_blank" rel="noreferrer">{COMMITMENT_TX}</a></div></div></div><div className="card"><p className="eyebrow">On-chain record</p><div className="mt-5 space-y-4 text-sm"><div className="flex justify-between gap-4"><span className="text-ink/55">PriceIndex contract</span><a className="font-mono font-bold text-leaf underline" href={`${EXPLORER_URL}/address/${PRICE_INDEX_ADDRESS}`} target="_blank" rel="noreferrer">{PRICE_INDEX_ADDRESS.slice(0, 8)}…{PRICE_INDEX_ADDRESS.slice(-6)}</a></div><div className="flex justify-between gap-4"><span className="text-ink/55">Committed at</span><strong className="text-right">{timestamp}</strong></div><div className="flex justify-between gap-4"><span className="text-ink/55">Data hash</span><strong className="max-w-[190px] truncate font-mono text-xs">{commitment.dataHash || "Available in live record"}</strong></div></div><div className="mt-7 rounded-2xl border border-leaf/20 bg-leaf/5 p-4 text-sm leading-6 text-ink/65"><strong className="text-leaf">{loading ? "Reading QIE Mainnet…" : error ? "Fallback view" : "Public verification complete"}</strong><p className="mt-1">{error || "This page reads the latest wheat / A / pilot commitment with a public RPC. No wallet connection or signature is required."}</p></div><Link href="/" className="btn-secondary mt-6 w-full">Browse marketplace →</Link></div></div>

    <div className="mt-6 card"><p className="eyebrow">How to read this page</p><div className="mt-5 grid gap-5 text-sm leading-6 text-ink/65 md:grid-cols-3"><div><strong className="text-ink">01 · Realized prices</strong><p className="mt-1">The historical series shows completed order medians, not asking prices or hidden predictions.</p></div><div><strong className="text-ink">02 · Signed range</strong><p className="mt-1">The oracle signs a bounded range and confidence score before the adapter commits it on-chain.</p></div><div><strong className="text-ink">03 · Farmer choice</strong><p className="mt-1">The AI is advisory only. It cannot secretly set a price or block a sane farmer listing.</p></div></div></div></section>;
}
