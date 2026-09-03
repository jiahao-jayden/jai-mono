"use client";

import { useState } from "react";
import type { DesktopWebSearchResult } from "../../../shared/desktop-rpc";
import { useIcon } from "@/lib/icon-context";

export interface WebSearchResultsProps {
	readonly results: readonly DesktopWebSearchResult[];
}

export function WebSearchResults({ results }: WebSearchResultsProps) {
	return (
		<div data-slot="web-search-results" className="min-w-0 space-y-2">
			<div className="flex min-w-0 flex-col gap-0.5">
				{results.map((result, index) => (
					<WebSearchResultRow key={`${result.url}:${index}`} result={result} />
				))}
			</div>
		</div>
	);
}

function WebSearchResultRow({ result }: { readonly result: DesktopWebSearchResult }) {
	return (
		<a
			className="group flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-start outline-none transition-colors hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-primary-2/45"
			href={result.url}
			target="_blank"
			rel="noopener noreferrer"
			title={result.url}
			aria-label={result.title}
		>
			<WebsiteFavicon url={result.url} />
			<span className="min-w-0 flex-1 truncate text-[13px] text-foreground/80 group-hover:text-foreground">
				{result.title}
			</span>
		</a>
	);
}

function WebsiteFavicon({ url }: { readonly url: string }) {
	const GlobeIcon = useIcon("globe");
	const [failed, setFailed] = useState(false);
	const favicon = faviconUrl(url);

	if (!favicon || failed) {
		return (
			<span className="inline-flex size-4 shrink-0 items-center justify-center text-foreground/40" aria-hidden="true">
				<GlobeIcon size={14} strokeWidth={1.5} />
			</span>
		);
	}

	return (
		<img
			className="size-4 shrink-0 rounded-[3px] object-contain"
			src={favicon}
			alt=""
			loading="lazy"
			referrerPolicy="no-referrer"
			onError={() => setFailed(true)}
		/>
	);
}

function faviconUrl(url: string): string | undefined {
	try {
		return `${new URL(url).origin}/favicon.ico`;
	} catch {
		return undefined;
	}
}
