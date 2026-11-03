"use client";

import { useMemo, useState } from "react";
import { useAutoRestockAgent } from "../../lib/integrations";
import { StatusPanel } from "../../components/StatusPanel";
import { baseUnitsFromHuman, formatPrice } from "../../lib/format";

const stable = (value: string | number) => formatPrice(baseUnitsFromHuman(value)).replace(" QSC", " QUSDC");

export default function AgentPage() {
  const { address, rule, actions, saveRule, updateInventory, runNow, loading, error, configured, explorer } = useAutoRestockAgent();
  const [crop, setCrop] = useState("Wheat");
  const [stock, setStock] = useState(0);
  const [threshold, setThreshold] = useState(50);
  const [buyUpTo, setBuyUpTo] = useState(100);
  const [price, setPrice] = useState(105);
  const [cap, setCap] = useState(10500);
  const [expiresDays, setExpiresDays] = useState(30);
  const [message, setMessage] = useState<string>();

  const computedSpend = useMemo(() => buyUpTo * price, [buyUpTo, price]);
  const capValid = buyUpTo > 0 && price > 0 && cap > 0 && computedSpend <= cap;

  const submit = async () => {
    setMessage(undefined);
    if (!address) { setMessage("Connect QIE Wallet before signing a rule."); return; }
    if (!capValid) { setMessage("The maximum spend must cover no more than buy-up-to quantity × max price."); return; }
    try {
      await updateInventory(crop, stock);
      await saveRule({ crop, thresholdKg: threshold, buyUpToKg: buyUpTo, maxPricePerKg: price, maxSpend: cap, expiresAt: Math.floor(Date.now() / 1000) + expiresDays * 86400, executor: address, enabled: true });
      setMessage("Rule signed by your QIE Wallet and saved. The backend will monitor mainnet listings.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not save the signed rule."); }
  };

  const manualRun = async () => { try { await runNow(); setMessage("Agent run requested. The Live Agent Log will update when the backend finishes."); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not run the agent."); } };

  return <section className="shell py-10 sm:py-12">
    <div className="max-w-4xl">
      <p className="eyebrow">Merchant automation · QIE Mainnet</p>
      <h1 className="mt-3 text-4xl font-bold sm:text-5xl">Auto-Restock Agent</h1>
      <p className="mt-4 max-w-3xl text-lg leading-8 text-ink/65">A capped, wallet-signed rule watches mainnet farmer listings. It can buy only the crop, quantity, price, and maximum spend you approve.</p>
    </div>

    <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">1 · Set the guardrails</p><h2 className="mt-1 text-2xl font-bold">Signed purchase rule</h2></div><span className="rounded-full bg-leaf/10 px-3 py-1 text-xs font-bold text-leaf">Merchant-controlled cap</span></div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-bold">Crop<select className="field" value={crop} onChange={(event) => setCrop(event.target.value)}><option>Wheat</option><option>Maize</option><option>Chickpea</option><option>Rice</option></select></label>
          <label className="text-sm font-bold">Current stock (kg)<input className="field" min="0" type="number" value={stock} onChange={(event) => setStock(Number(event.target.value))} /></label>
          <label className="text-sm font-bold">Buy when stock is below (kg)<input className="field" min="1" type="number" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} /></label>
          <label className="text-sm font-bold">Buy up to (kg)<input className="field" min="1" type="number" value={buyUpTo} onChange={(event) => setBuyUpTo(Number(event.target.value))} /></label>
          <label className="text-sm font-bold">Max price per kg (QUSDC)<input className="field" min="0.0001" step="0.01" type="number" value={price} onChange={(event) => setPrice(Number(event.target.value))} /></label>
          <label className="text-sm font-bold">Rule expiry (days)<input className="field" min="1" max="365" type="number" value={expiresDays} onChange={(event) => setExpiresDays(Number(event.target.value))} /></label>
        </div>
        <label className="mt-5 block text-sm font-bold">Maximum spend per run (QUSDC)<input className="field text-xl" min="0.01" step="0.01" type="number" value={cap} onChange={(event) => setCap(Number(event.target.value))} /></label>
        <div className={`mt-5 rounded-2xl p-4 text-sm ${capValid ? "bg-sun/20" : "bg-rust/10 text-rust"}`}><strong>Hard cap preview</strong><p className="mt-1">Maximum attempted purchase: {buyUpTo} kg × {stable(price)} = {stable(computedSpend)}. The signed cap is {stable(cap)}.</p>{!capValid && <p className="mt-2 font-bold">Reduce quantity or price, or increase the cap.</p>}</div>
        {message && <StatusPanel tone={message.includes("saved") ? "success" : "warn"}><p>{message}</p></StatusPanel>}
        {error && <StatusPanel tone="warn"><p>{error}</p></StatusPanel>}
        {!configured && <StatusPanel tone="warn"><strong>Connect the backend API before live use.</strong><p className="mt-1">Set NEXT_PUBLIC_API_URL and connect QIE Wallet. Rules are never treated as active until the backend verifies the wallet signature.</p></StatusPanel>}
        <button className="btn-primary mt-6 w-full" disabled={loading || !capValid} onClick={submit}>{loading ? "Waiting for wallet…" : "Sign rule with QIE Wallet and save"}</button>
        <p className="mt-3 text-center text-xs text-ink/50">Your wallet signs the rule. The agent cannot increase its quantity, price, expiry, or spend cap.</p>
      </div>

      <div className="space-y-6">
        <div className="card"><p className="eyebrow">2 · Execution scope</p><h2 className="mt-1 text-2xl font-bold">Merchant wallet only</h2><p className="mt-3 text-sm leading-6 text-ink/60">The backend accepts a transaction only from the merchant’s wallet or a separately configured scoped executor whose address is included in the signed rule. It never uses the oracle key.</p><div className="mt-4 rounded-2xl bg-cream p-4 text-sm"><p className="text-ink/55">Connected wallet</p><p className="mt-1 break-all font-mono text-xs">{address || "Not connected"}</p>{rule && <p className="mt-3 text-leaf">✓ Signed rule active until {new Date(rule.expiresAt * 1000).toLocaleDateString()}</p>}</div><button className="btn-secondary mt-4 w-full" disabled={!address || loading} onClick={manualRun}>Run agent check now</button></div>
        <div className="card"><div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Live Agent Log</p><h2 className="mt-1 text-2xl font-bold">Auditable actions</h2></div><span className="inline-flex items-center gap-2 rounded-full bg-leaf/10 px-3 py-1 text-xs font-bold text-leaf"><span className="h-2 w-2 animate-pulse rounded-full bg-leaf" />Polling</span></div><p className="mt-3 text-sm text-ink/55">Updates every 10 seconds from the backend.</p><div className="mt-5 space-y-3">{actions.length === 0 && <p className="rounded-2xl bg-cream p-4 text-sm leading-6 text-ink/55">No agent actions yet. Save a rule and set your current stock below the trigger.</p>}{actions.map((action) => <div key={action.id} className="rounded-2xl border border-ink/10 bg-cream p-4 text-sm"><div className="flex items-center justify-between gap-3"><span className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase ${action.status === "submitted" ? "bg-leaf/10 text-leaf" : action.status === "ready" ? "bg-sun/25 text-ink" : "bg-ink/5 text-ink/55"}`}>{action.status}</span><time className="text-xs text-ink/45">{new Date(action.createdAt * 1000).toLocaleString()}</time></div><p className="mt-3 leading-6">{action.text}</p>{action.txHash && <a className="mt-2 block break-all text-xs font-bold text-leaf underline" href={`${explorer}/tx/${action.txHash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}</div>)}</div></div>
      </div>
    </div>
  </section>;
}
