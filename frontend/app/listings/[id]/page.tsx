"use client";
import { useState } from "react";
import Link from "next/link";
import { demoListings, fairTag } from "../../../lib/data";
import { useContractActions } from "../../../lib/contracts";
import { useQieWallet } from "../../../lib/wallet";
import { useQieDex } from "../../../lib/integrations";
import { formatPrice } from "../../../lib/format";
import { StatusPanel } from "../../../components/StatusPanel";

type PaymentStep = "idle" | "swap" | "approve" | "escrow" | "confirmed" | "error";
const qieLabel = (baseUnits: bigint) => `${formatPrice(baseUnits).replace(" QSC", " QIE")} native`;

function StepRow({ label, active, complete }: { label: string; active: boolean; complete: boolean }) {
  return <div className="flex items-center gap-3 text-sm"><span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${complete ? "bg-leaf text-white" : active ? "bg-sun text-ink" : "bg-ink/10 text-ink/45"}`}>{complete ? "✓" : active ? "…" : ""}</span><span className={complete ? "font-bold text-leaf" : active ? "font-bold text-ink" : "text-ink/50"}>{label}</span></div>;
}

export default function ListingPage({ params }: { params: { id: string } }) {
  const listing = demoListings.find((item) => item.id === params.id) || demoListings[0];
  const [quantity, setQuantity] = useState(10);
  const [rating, setRating] = useState(5);
  const [orderId, setOrderId] = useState("");
  const [message, setMessage] = useState("");
  const [payWithQie, setPayWithQie] = useState(false);
  const [paymentStep, setPaymentStep] = useState<PaymentStep>("idle");
  const [swapTxHash, setSwapTxHash] = useState("");
  const { address, connect } = useQieWallet();
  const { buy, confirmDelivery, pending, configured } = useContractActions();
  const dex = useQieDex();
  const totalBaseUnits = BigInt(quantity) * listing.minPrice;
  const qiePreview = dex.previewQieAmount(totalBaseUnits);
  const finalPayment = paymentStep === "confirmed";

  const pay = async () => {
    try {
      if (!address) return connect();
      setMessage(""); setSwapTxHash("");
      if (payWithQie) { setPaymentStep("swap"); const swap = await dex.swapQieToStablecoin(totalBaseUnits); setSwapTxHash(swap.txHash); }
      const hash = await buy(listing.id, String(quantity), (Number(listing.minPrice) / 10 ** 18).toString(), (step) => setPaymentStep(step));
      setOrderId(hash); setPaymentStep("confirmed"); setMessage(payWithQie ? "QIE was swapped to QUSDC and your payment was deposited into OrderEscrow." : "QUSDC payment was deposited into OrderEscrow.");
    } catch (error) { setPaymentStep("error"); setMessage(error instanceof Error ? error.message : "Payment could not be completed."); }
  };
  const confirm = async () => { try { await confirmDelivery(orderId || "1", rating); setMessage("Delivery confirmed and rating recorded on-chain."); } catch (error) { setMessage(error instanceof Error ? error.message : "Confirmation failed."); } };

  return <section className="shell py-10"><Link href="/" className="text-sm font-bold text-leaf">← Back to listings</Link><div className="mt-5 grid gap-6 lg:grid-cols-[1fr_420px]"><div className="card"><div className="grid min-h-72 place-items-center rounded-3xl bg-cream text-8xl">{listing.image}</div><div className="mt-6 flex flex-wrap items-center gap-2"><span className="pill bg-leaf/10 text-leaf">✓ QIE ID verified</span><span className="pill bg-sun/20">★ {listing.reputation.toFixed(1)} farmer reputation</span><span className="pill bg-ink/5">{fairTag(listing)}</span></div><h1 className="mt-5 text-4xl font-bold">{listing.cropType}, grade {listing.grade}</h1><p className="mt-2 text-ink/60">{listing.region} · {listing.quantityKg.toLocaleString()} kg available · Farmer: {listing.farmerName}</p><div className="mt-8 grid gap-4 sm:grid-cols-2"><div className="rounded-2xl bg-cream p-4"><p className="text-xs uppercase tracking-wider text-ink/50">Listed from</p><strong className="mt-1 block text-2xl">{formatPrice(listing.minPrice)}/kg</strong></div><div className="rounded-2xl bg-leaf/10 p-4"><p className="text-xs uppercase tracking-wider text-leaf">AI fair range</p><strong className="mt-1 block text-2xl text-leaf">{formatPrice(listing.aiLow)}–{formatPrice(listing.aiHigh)}</strong></div></div><p className="mt-6 text-sm leading-7 text-ink/65">The fair range is a transparent suggestion based on recent completed sales. The farmer sets the listing price and you agree the order price; the AI never sets either one.</p></div><aside className="card h-fit lg:sticky lg:top-28"><p className="eyebrow">Buy this harvest</p><h2 className="mt-2 text-2xl font-bold">Secure checkout</h2><label className="mt-6 block text-sm font-bold">Quantity (kg)<input className="field" type="number" min="1" max={listing.quantityKg} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label><div className="mt-5 rounded-2xl bg-cream p-4"><div className="flex justify-between text-sm"><span>{quantity} kg × {formatPrice(listing.minPrice)}</span><strong>{formatPrice(totalBaseUnits)}</strong></div><p className="mt-2 text-xs text-ink/55">Final settlement currency: QUSDC in OrderEscrow</p></div>

      <div className="mt-5 grid grid-cols-2 rounded-2xl bg-ink/5 p-1 text-sm font-bold"><button className={`rounded-xl px-3 py-3 ${!payWithQie ? "bg-white shadow-sm" : "text-ink/50"}`} onClick={() => setPayWithQie(false)}>Pay with QUSDC</button><button className={`rounded-xl px-3 py-3 ${payWithQie ? "bg-leaf text-white shadow-sm" : "text-ink/50"}`} onClick={() => setPayWithQie(true)}>Pay with QIE</button></div>
      {payWithQie ? <div className="mt-3 rounded-2xl border border-leaf/20 bg-leaf/5 p-4 text-sm"><p className="font-bold text-leaf">QIEDex native-QIE route</p><p className="mt-1">Estimated input: <strong>{qieLabel(qiePreview)}</strong> for {formatPrice(totalBaseUnits)} QUSDC.</p><p className="mt-2 text-xs text-ink/55">{dex.configured ? "Live router quote is used at checkout; slippage protection applies." : `Demo quote at ${dex.qiePerQusdc} QIE per QUSDC. Configure NEXT_PUBLIC_QIEDEX_ROUTER_ADDRESS for live swap.`}</p></div> : <p className="mt-3 text-xs text-ink/55">Use your QUSDC balance directly. No QIEDex swap is performed.</p>}

      {payWithQie && paymentStep !== "idle" && <div className="mt-5 space-y-3 rounded-2xl border border-ink/10 p-4"><p className="eyebrow">Payment progress</p><StepRow label="Swap native QIE → QUSDC via QIEDex" active={paymentStep === "swap"} complete={paymentStep !== "swap" && paymentStep !== "error"} /><StepRow label="Approve QUSDC for OrderEscrow" active={paymentStep === "approve"} complete={paymentStep === "escrow" || paymentStep === "confirmed"} /><StepRow label="Deposit QUSDC into OrderEscrow" active={paymentStep === "escrow"} complete={paymentStep === "confirmed"} />{swapTxHash && <a className="block break-all text-xs font-bold text-leaf underline" href={`https://mainnet.qie.digital/tx/${swapTxHash}`} target="_blank" rel="noreferrer">View QIEDex swap transaction ↗</a>}</div>}

      <button className="btn-primary mt-6 w-full" onClick={pay} disabled={Boolean(pending || dex.pending || finalPayment)}>{pending || dex.pending ? "Confirm in QIE Wallet…" : finalPayment ? "Payment confirmed" : address ? (payWithQie ? "Swap QIE + deposit into escrow" : "Approve + pay into escrow") : "Connect wallet to buy"}</button>{!configured && <StatusPanel tone="warn"><strong>Demo mode:</strong> contract addresses are not configured. Add the frontend environment values before signing a live transaction.</StatusPanel>}{payWithQie && !dex.configured && <StatusPanel tone="warn"><strong>QIEDex is not configured for live swaps.</strong> The displayed QIE amount is a mock-rate preview; add the router address and ABI-compatible router before enabling live QIE checkout.</StatusPanel>}{message && <StatusPanel tone={paymentStep === "error" ? "warn" : "success"}>{message}</StatusPanel>}{orderId && <div className="mt-5 border-t border-ink/10 pt-5"><p className="eyebrow">Order status</p><p className="mt-2 text-sm">Created → Escrowed → Awaiting delivery</p><label className="mt-4 block text-sm font-bold">Your rating after delivery<div className="mt-2 flex gap-2">{[1,2,3,4,5].map((value) => <button key={value} onClick={() => setRating(value)} className={`text-2xl ${value <= rating ? "text-sun" : "text-ink/20"}`}>★</button>)}</div></label><button className="btn-secondary mt-4 w-full" onClick={confirm}>Confirm delivery + leave rating</button><Link href={`/receipt/${orderId}`} className="mt-3 block text-center text-sm font-bold text-leaf">View QR receipt →</Link></div>}</aside></div></section>;
}
