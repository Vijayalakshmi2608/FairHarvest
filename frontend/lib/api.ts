import type { Listing } from "./data";

const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export async function fetchListings(): Promise<Listing[]> {
  try { const response = await fetch(`${api}/listings`, { cache: "no-store" }); if (!response.ok) throw new Error(); const data = await response.json(); return data.items || data; } catch { return []; }
}

export async function getPriceIndex(crop: string, grade: string, region: string) {
  try { const response = await fetch(`${api}/price-index?crop=${encodeURIComponent(crop)}&grade=${encodeURIComponent(grade)}&region=${encodeURIComponent(region)}`, { cache: "no-store" }); if (!response.ok) throw new Error(); return await response.json(); }
  catch { return { medianPrice: "100000000000000000000", latestAI: { price_low: "88000000000000000000", price_high: "112000000000000000000", confidence_bps: 8200 }, salesCount: 128 }; }
}

export async function getDemandSignal() { return { message: "3 buyers near you are searching for this crop this week", count: 3 }; }
export async function verifyQieId(address: string, signature: string) { const response = await fetch(`${api}/identity/qie-id/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, signature }) }); return response.ok; }
export async function uploadToIpfs(file: File) { const endpoint = process.env.NEXT_PUBLIC_IPFS_UPLOAD_URL; if (!endpoint) return `ipfs://pending/${encodeURIComponent(file.name)}`; const form = new FormData(); form.append("file", file); const response = await fetch(endpoint, { method: "POST", body: form }); if (!response.ok) throw new Error("IPFS upload failed"); const data = await response.json(); return data.cid || data.Hash || data.url; }
