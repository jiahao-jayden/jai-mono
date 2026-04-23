import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { ChatMessagePart } from "@/types/chat";

type ToolCallData = NonNullable<ChatMessagePart["toolCall"]>;

interface PreviewProps {
	tool: ToolCallData;
}

interface SearchResult {
	title: string;
	url: string;
}

/**
 * Parses the markdown emitted by the web-search plugin. Format (deterministic,
 * we own both sides):
 *
 *   # Search Results
 *
 *   ## 1. Title
 *   - URL: https://example.com
 *   - Score: 0.85          (optional)
 *
 *   snippet...
 *
 *   ## 2. ...
 *
 * The snippet body is intentionally ignored — we only show title + domain.
 */
function parseSearchResults(text: string): SearchResult[] {
	const blocks = text.split(/\n##\s+\d+\.\s+/);
	blocks.shift();
	const results: SearchResult[] = [];
	for (const block of blocks) {
		const firstLineEnd = block.indexOf("\n");
		const title = (firstLineEnd === -1 ? block : block.slice(0, firstLineEnd)).trim();
		const urlMatch = block.match(/^-\s*URL:\s*(.+)$/m);
		if (!title || !urlMatch) continue;
		results.push({ title, url: urlMatch[1].trim() });
	}
	return results;
}

function faviconUrl(url: string): string | null {
	try {
		const host = new URL(url).hostname;
		return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
	} catch {
		return null;
	}
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

function openExternal(url: string) {
	window.open(url, "_blank", "noopener,noreferrer");
}

function tryParseQuery(argsRaw: string | undefined): string | null {
	if (!argsRaw) return null;
	try {
		const parsed = JSON.parse(argsRaw) as Record<string, unknown>;
		return typeof parsed.query === "string" ? parsed.query : null;
	} catch {
		return null;
	}
}

function tryParseUrl(argsRaw: string | undefined): string | null {
	if (!argsRaw) return null;
	try {
		const parsed = JSON.parse(argsRaw) as Record<string, unknown>;
		return typeof parsed.url === "string" ? parsed.url : null;
	} catch {
		return null;
	}
}

export function WebSearchPreview({ tool }: PreviewProps) {
	const query = tryParseQuery(tool.args);
	const results = useMemo(() => (tool.result ? parseSearchResults(tool.result) : []), [tool.result]);

	if (tool.status === "running") {
		return (
			<div className="ml-5 mt-0.5 mb-1 flex items-center gap-2 text-[11.5px] text-muted-foreground/60">
				<span className="inline-flex gap-0.5" aria-hidden>
					<span className="size-1 rounded-full bg-muted-foreground/50 animate-[pulse_1.1s_ease-in-out_infinite]" />
					<span className="size-1 rounded-full bg-muted-foreground/50 animate-[pulse_1.1s_ease-in-out_0.15s_infinite]" />
					<span className="size-1 rounded-full bg-muted-foreground/50 animate-[pulse_1.1s_ease-in-out_0.3s_infinite]" />
				</span>
				<span>Searching{query ? ` for "${query}"` : "…"}</span>
			</div>
		);
	}

	if (tool.status === "error") {
		return (
			<div className="ml-5 mt-0.5 mb-1 rounded-md bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive/75 leading-relaxed">
				{tool.result ?? "Search failed"}
			</div>
		);
	}

	if (results.length === 0) {
		return (
			<div className="ml-5 mt-0.5 mb-1 text-[11.5px] text-muted-foreground/55 italic">
				No results{query ? ` for "${query}"` : ""}
			</div>
		);
	}

	return (
		<ul className="ml-5 mt-0.5 mb-1 flex flex-col gap-0.5">
			{results.map((r) => {
				const icon = faviconUrl(r.url);
				const host = hostOf(r.url);
				return (
					<li key={r.url}>
						<button
							type="button"
							onClick={() => openExternal(r.url)}
							className={cn(
								"group flex items-center gap-2 w-full py-1 px-1.5 -mx-1.5 rounded-md text-left",
								"transition-colors hover:bg-muted/40",
							)}
						>
							{icon ? (
								<img
									src={icon}
									alt=""
									loading="lazy"
									className="size-3.5 shrink-0 rounded-sm opacity-80 group-hover:opacity-100"
									onError={(e) => {
										(e.currentTarget as HTMLImageElement).style.visibility = "hidden";
									}}
								/>
							) : (
								<span className="size-3.5 shrink-0 rounded-sm bg-muted-foreground/15" />
							)}
							<span
								className="truncate text-[12px] text-foreground/80 group-hover:text-foreground"
								title={r.title}
							>
								{r.title}
							</span>
							<span className="truncate font-mono text-[10.5px] text-muted-foreground/50 shrink-0 max-w-[40%]">
								{host}
							</span>
						</button>
					</li>
				);
			})}
		</ul>
	);
}

export function WebFetchPreview({ tool }: PreviewProps) {
	const url = tryParseUrl(tool.args);

	if (!url) return <DefaultPreview tool={tool} />;

	const icon = faviconUrl(url);
	const host = hostOf(url);
	const path = (() => {
		try {
			const u = new URL(url);
			return `${u.pathname}${u.search}` || "/";
		} catch {
			return "";
		}
	})();

	if (tool.status === "running") {
		return (
			<div className="ml-5 mt-0.5 mb-1 flex items-center gap-2 text-[11.5px] text-muted-foreground/60">
				{icon ? (
					<img src={icon} alt="" loading="lazy" className="size-3.5 shrink-0 rounded-sm opacity-80" />
				) : (
					<span className="size-3.5 shrink-0 rounded-sm bg-muted-foreground/15" />
				)}
				<span className="truncate">
					<span className="font-medium text-foreground/70">{host}</span>
					<span className="text-muted-foreground/45 font-mono text-[10.5px] ml-1">{path}</span>
				</span>
			</div>
		);
	}

	if (tool.status === "error") {
		return (
			<div className="ml-5 mt-0.5 mb-1 rounded-md bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive/75 leading-relaxed">
				{tool.result ?? "Fetch failed"}
			</div>
		);
	}

	return (
		<button
			type="button"
			onClick={() => openExternal(url)}
			className="group ml-5 mt-0.5 mb-1 flex items-center gap-2 py-1 px-1.5 -mx-1.5 rounded-md transition-colors hover:bg-muted/40 text-left w-fit max-w-full"
		>
			{icon ? (
				<img
					src={icon}
					alt=""
					loading="lazy"
					className="size-3.5 shrink-0 rounded-sm opacity-80 group-hover:opacity-100"
				/>
			) : (
				<span className="size-3.5 shrink-0 rounded-sm bg-muted-foreground/15" />
			)}
			<span className="truncate text-[12px] text-foreground/75 group-hover:text-foreground font-medium">{host}</span>
			<span className="truncate font-mono text-[10.5px] text-muted-foreground/50">{path}</span>
		</button>
	);
}

function tryFormatJson(str: string): string {
	try {
		return JSON.stringify(JSON.parse(str), null, 2);
	} catch {
		return str;
	}
}

export function DefaultPreview({ tool }: PreviewProps) {
	if (!tool.args && !tool.result) return null;
	return (
		<div className="ml-5 mt-0.5 mb-1 rounded-md bg-muted/30 px-3 py-2 space-y-1.5 text-[11px] font-mono text-muted-foreground/55 leading-relaxed">
			{tool.args && (
				<pre className="whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{tryFormatJson(tool.args)}</pre>
			)}
			{tool.args && tool.result && <div className="border-t border-muted-foreground/8" />}
			{tool.result && <pre className="whitespace-pre-wrap break-all max-h-40 overflow-y-auto">{tool.result}</pre>}
		</div>
	);
}

export function pickPreview(toolName: string) {
	switch (toolName) {
		case "WebSearch":
			return WebSearchPreview;
		case "WebFetch":
			return WebFetchPreview;
		default:
			return DefaultPreview;
	}
}
