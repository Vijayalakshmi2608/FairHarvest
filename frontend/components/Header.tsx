"use client";
import Link from "next/link";
import { useQieWallet, shortAddress } from "../lib/wallet";

const links = [{ href: "/fair-price-index", label: "Fair Price Index" }, { href: "/dashboard", label: "Dashboard" }, { href: "/agent", label: "Auto-Restock Agent" }];

export function Header() {
  const { address, connect, connecting, isWrongNetwork } = useQieWallet();
  return <header className="sticky top-0 z-20 border-b border-ink/10 bg-cream/95 backdrop-blur"><div className="shell flex min-h-20 items-center justify-between gap-4"><Link href="/" className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-leaf text-xl text-white">✦</span><span><strong className="block text-lg leading-none">FairHarvest</strong><span className="text-xs text-ink/55">clear trade, fairer harvests</span></span></Link><nav className="hidden items-center gap-5 text-sm font-bold lg:flex">{links.map((link) => <Link key={link.href} href={link.href} className="hover:text-leaf">{link.label}</Link>)}</nav><div className="flex items-center gap-2">{isWrongNetwork && <span className="hidden text-xs font-bold text-rust sm:inline">Switch to QIE Mainnet</span>}<button className="btn-primary min-h-11 px-4 text-sm" onClick={() => connect().catch((error) => alert(error instanceof Error ? error.message : "Wallet connection failed"))}>{connecting ? "Connecting…" : address ? shortAddress(address) : "Connect QIE Wallet"}</button></div></div><nav className="shell flex gap-5 overflow-x-auto py-3 text-xs font-bold lg:hidden">{links.map((link) => <Link key={link.href} href={link.href} className="shrink-0 hover:text-leaf">{link.label}</Link>)}</nav></header>;
}
