import { cn } from "cn";
import { Instrument_Serif, Noto_Serif_SC } from "next/font/google";
import type { ReactNode } from "react";
import { projectMetadata } from "@/landing/metadata";
import { RootDocument } from "@/landing/root-document";

// Latin glyphs (product names, "PandaWork") keep the English display face.
const display = Instrument_Serif({
	weight: "400",
	subsets: ["latin"],
	variable: "--font-instrument-serif",
});

// CJK faces are split by unicode-range at build time, so the browser only
// downloads the slices the page uses; preloading them all would defeat that.
const displayZh = Noto_Serif_SC({
	weight: "500",
	preload: false,
	variable: "--font-noto-serif-sc",
});

export const metadata = projectMetadata("zh");

export default function ChineseRootLayout({ children }: { children: ReactNode }) {
	return (
		<RootDocument locale="zh" fontClassName={cn(display.variable, displayZh.variable)}>
			{children}
		</RootDocument>
	);
}
