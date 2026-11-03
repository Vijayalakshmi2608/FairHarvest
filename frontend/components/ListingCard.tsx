import Link from "next/link";
import type { Listing } from "../lib/data";
import { fairTag } from "../lib/data";
import { formatPrice } from "../lib/format";

export function ListingCard({ listing }: { listing: Listing }) {
  const tag = fairTag(listing);
  return <Link href={`/listings/${listing.id}`} className="card group block transition hover:-translate-y-1 hover:border-leaf">
    <div className="flex items-start justify-between"><span className="grid h-16 w-16 place-items-center rounded-2xl bg-cream text-4xl">{listing.image}</span><span className={`pill ${tag === "Within AI fair range" ? "bg-leaf/10 text-leaf" : tag === "Above fair range" ? "bg-rust/10 text-rust" : "bg-sun/20 text-ink"}`}>{tag}</span></div>
    <div className="mt-5"><div className="flex items-center gap-2"><h3 className="text-xl font-bold group-hover:text-leaf">{listing.cropType}</h3><span className="pill bg-ink/5">Grade {listing.grade}</span></div>
      <p className="mt-1 text-sm text-ink/60">{listing.region} · {listing.quantityKg.toLocaleString()} kg available</p>
      <div className="mt-5 flex items-end justify-between"><div><p className="text-xs uppercase tracking-wider text-ink/50">From</p><p className="text-2xl font-bold">{formatPrice(listing.minPrice)}/kg</p></div><div className="text-right text-sm"><p className="font-bold">★ {listing.reputation.toFixed(1)}</p><p className="text-ink/60">{listing.farmerName}</p></div></div>
      <div className="mt-4 flex flex-wrap gap-2"><span className="pill bg-sun/20 text-ink">★ {listing.reputation.toFixed(1)} reputation</span>{listing.qieVerified && <span className="pill bg-leaf/10 text-leaf">✓ QIE ID verified</span>}</div>
    </div>
  </Link>;
}
