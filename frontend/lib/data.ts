export type Listing = {
  id: string; cropType: string; grade: string; region: string; quantityKg: number; minPrice: bigint;
  farmer: string; farmerName: string; reputation: number; qieVerified: boolean; aiLow: bigint; aiHigh: bigint; image?: string;
};

const QSC = BigInt(10) ** BigInt(18);
export const demoListings: Listing[] = [
  { id: "101", cropType: "Wheat", grade: "A", region: "Punjab pilot", quantityKg: 840, minPrice: BigInt(96) * QSC, farmer: "0x7a4...21F", farmerName: "Meera Farms", reputation: 4.9, qieVerified: true, aiLow: BigInt(88) * QSC, aiHigh: BigInt(112) * QSC, image: "🌾" },
  { id: "102", cropType: "Maize", grade: "A", region: "Nashik", quantityKg: 420, minPrice: BigInt(108) * QSC, farmer: "0x2bd...C12", farmerName: "Green Ridge", reputation: 4.7, qieVerified: true, aiLow: BigInt(90) * QSC, aiHigh: BigInt(104) * QSC, image: "🌽" },
  { id: "103", cropType: "Wheat", grade: "B", region: "Punjab pilot", quantityKg: 1200, minPrice: BigInt(76) * QSC, farmer: "0x93e...A08", farmerName: "Kisan Collective", reputation: 4.6, qieVerified: false, aiLow: BigInt(70) * QSC, aiHigh: BigInt(94) * QSC, image: "🌾" },
  { id: "104", cropType: "Chickpea", grade: "A", region: "Madhya Pradesh", quantityKg: 260, minPrice: BigInt(132) * QSC, farmer: "0x44a...9D0", farmerName: "Sundar Soil", reputation: 4.8, qieVerified: true, aiLow: BigInt(118) * QSC, aiHigh: BigInt(144) * QSC, image: "🫘" },
];

export const fairTag = (listing: Listing) => listing.minPrice < listing.aiLow ? "Below fair range" : listing.minPrice > listing.aiHigh ? "Above fair range" : "Within AI fair range";
