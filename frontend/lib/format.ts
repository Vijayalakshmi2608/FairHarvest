"use client";

export const STABLECOIN_DECIMALS = Number(process.env.NEXT_PUBLIC_STABLECOIN_DECIMALS || "18");
const SCALE = 10 ** STABLECOIN_DECIMALS;

export function toHumanPrice(baseUnits: bigint): number {
  return Number(baseUnits) / SCALE;
}

export function baseUnitsFromHuman(value: string | number): bigint {
  const [whole, fraction = ""] = String(value).trim().split(".");
  const digits = `${fraction}${"0".repeat(STABLECOIN_DECIMALS)}`.slice(0, STABLECOIN_DECIMALS);
  return BigInt(whole || "0") * BigInt(10) ** BigInt(STABLECOIN_DECIMALS) + BigInt(digits || "0");
}

export function formatPrice(baseUnits: bigint): string {
  const human = toHumanPrice(baseUnits);
  if (process.env.NODE_ENV !== "production" && (human < 0.001 || human > 1_000_000)) {
    console.warn(`[FairHarvest] unusual rendered price: ${human} human units`);
  }
  return `${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(human)} QSC`;
}
