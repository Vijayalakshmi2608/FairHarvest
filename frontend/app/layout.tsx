import type { Metadata } from "next";
import "./globals.css";
import { Header } from "../components/Header";
export const metadata: Metadata = { title: "FairHarvest | trade with clarity", description: "A public farmer-to-consumer marketplace on QIE." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><Header /><main>{children}</main></body></html>; }
