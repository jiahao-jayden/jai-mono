import { Instrument_Serif } from "next/font/google";
import type { ReactNode } from "react";
import { projectMetadata } from "@/landing/metadata";
import { RootDocument } from "@/landing/root-document";

const display = Instrument_Serif({
	weight: "400",
	style: ["normal", "italic"],
	subsets: ["latin"],
	variable: "--font-instrument-serif",
});

export const metadata = projectMetadata("en");

export default function EnglishRootLayout({ children }: { children: ReactNode }) {
	return (
		<RootDocument locale="en" fontClassName={display.variable}>
			{children}
		</RootDocument>
	);
}
