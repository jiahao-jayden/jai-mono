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
		return <SearchSkeleton />;
	}

	if (tool.status === "error") {
		return <ErrorBlock text={tool.result ?? "Search failed"} />;
	}

	if (results.length === 0) {
		return <EmptyResult text={query ? `No results for "${query}"` : "No results"} />;
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
		return <ErrorBlock text={tool.result ?? "Fetch failed"} />;
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

function tryParse<T = Record<string, unknown>>(raw: string | undefined): T | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

function RunningPlaceholder({ text }: { text: string }) {
	return (
		<div className="ml-5 mt-0.5 mb-1 flex items-center gap-2 text-[11.5px] text-muted-foreground/60">
			<span className="inline-flex gap-0.5" aria-hidden>
				<span className="size-1 rounded-full bg-muted-foreground/50 animate-[pulse_1.1s_ease-in-out_infinite]" />
				<span className="size-1 rounded-full bg-muted-foreground/50 animate-[pulse_1.1s_ease-in-out_0.15s_infinite]" />
				<span className="size-1 rounded-full bg-muted-foreground/50 animate-[pulse_1.1s_ease-in-out_0.3s_infinite]" />
			</span>
			<span>{text}</span>
		</div>
	);
}

function EmptyResult({ text }: { text: string }) {
	return <div className="ml-5 mt-0.5 mb-1 text-[11.5px] text-muted-foreground/50 italic">{text}</div>;
}

// Skeleton rows shown while a WebSearch is running — gives a visual promise
// of "results will appear here", shaped like the eventual favicon+title rows.
function SearchSkeleton() {
	const rows = [
		{ id: "a", width: 68 },
		{ id: "b", width: 82 },
		{ id: "c", width: 55 },
	];
	return (
		<ul className="ml-5 mt-0.5 mb-1 flex flex-col gap-1.5" aria-label="searching">
			{rows.map((r, i) => (
				<li key={r.id} className="flex items-center gap-2">
					<div className="size-3.5 shrink-0 rounded-sm bg-muted-foreground/15 animate-pulse" />
					<div
						className="h-2.5 rounded-sm bg-muted-foreground/12 animate-pulse"
						style={{ width: `${r.width}%`, animationDelay: `${i * 120}ms` }}
					/>
				</li>
			))}
		</ul>
	);
}

function ErrorBlock({ text }: { text: string }) {
	return (
		<div className="ml-5 mt-0.5 mb-1 rounded-md bg-destructive/5 px-3 py-2 text-[11.5px] text-destructive/75 leading-relaxed font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
			{text}
		</div>
	);
}

function ResultMono({ text, maxHeight = "max-h-48" }: { text: string; maxHeight?: string }) {
	return (
		<div
			className={cn(
				"ml-5 mt-0.5 mb-1 rounded-md bg-muted/30 px-3 py-2 text-[11px] font-mono text-muted-foreground/70 leading-relaxed",
			)}
		>
			<pre className={cn("whitespace-pre-wrap break-all overflow-y-auto", maxHeight)}>{text}</pre>
		</div>
	);
}

export function BashPreview({ tool }: PreviewProps) {
	const args = tryParse<{ command?: string; cwd?: string }>(tool.args);
	const command = args?.command ?? "";

	if (tool.status === "error") {
		return (
			<div className="ml-5 mt-0.5 mb-1 space-y-1">
				{command && <CommandLine command={command} />}
				<ErrorBlock text={tool.result ?? "Command failed"} />
			</div>
		);
	}

	if (tool.status === "running") {
		return (
			<div className="ml-5 mt-0.5 mb-1 space-y-1">
				{command && <CommandLine command={command} />}
				<div className="flex items-center gap-2 text-[11.5px] text-muted-foreground/55 px-1">
					<span className="inline-flex gap-0.5" aria-hidden>
						<span className="size-1 rounded-full bg-muted-foreground/50 animate-[pulse_1.1s_ease-in-out_infinite]" />
						<span className="size-1 rounded-full bg-muted-foreground/50 animate-[pulse_1.1s_ease-in-out_0.15s_infinite]" />
						<span className="size-1 rounded-full bg-muted-foreground/50 animate-[pulse_1.1s_ease-in-out_0.3s_infinite]" />
					</span>
					<span>Running…</span>
				</div>
			</div>
		);
	}

	return (
		<div className="ml-5 mt-0.5 mb-1 space-y-1">
			{command && <CommandLine command={command} />}
			{tool.result && (
				<div className="rounded-md bg-muted/30 px-3 py-2 text-[11px] font-mono text-muted-foreground/70 leading-relaxed">
					<pre className="whitespace-pre-wrap break-all max-h-48 overflow-y-auto">{tool.result}</pre>
				</div>
			)}
		</div>
	);
}

function CommandLine({ command }: { command: string }) {
	return (
		<div className="rounded-md bg-foreground/[0.035] px-3 py-1.5 text-[11px] font-mono text-foreground/75 leading-relaxed border border-foreground/5">
			<span aria-hidden className="select-none text-muted-foreground/55 mr-2">
				$
			</span>
			<span className="whitespace-pre-wrap break-all">{command}</span>
		</div>
	);
}

export function FileReadPreview({ tool }: PreviewProps) {
	if (tool.status === "running") return <RunningPlaceholder text="Reading…" />;
	if (tool.status === "error") return <ErrorBlock text={tool.result ?? "Read failed"} />;
	if (!tool.result) return null;
	// Strip the synthetic "// File: path (lines X-Y of N)" header line added by the tool,
	// since the path is already shown in the row header.
	const body = tool.result.replace(/^\/\/\s*File:[^\n]*\n?/, "");
	return <ResultMono text={body} />;
}

export function FileWritePreview({ tool }: PreviewProps) {
	if (tool.status === "running") return <RunningPlaceholder text="Writing…" />;
	if (tool.status === "error") return <ErrorBlock text={tool.result ?? "Write failed"} />;
	if (!tool.result) return null;
	return <ResultMono text={tool.result.trim()} maxHeight="max-h-32" />;
}

export function FileEditPreview({ tool }: PreviewProps) {
	if (tool.status === "running") return <RunningPlaceholder text="Editing…" />;
	if (tool.status === "error") return <ErrorBlock text={tool.result ?? "Edit failed"} />;
	if (!tool.result) return null;
	return <ResultMono text={tool.result.trim()} maxHeight="max-h-40" />;
}

export function GrepPreview({ tool }: PreviewProps) {
	if (tool.status === "running") return <RunningPlaceholder text="Searching…" />;
	if (tool.status === "error") return <ErrorBlock text={tool.result ?? "Search failed"} />;
	if (!tool.result?.trim()) return <EmptyResult text="No matches" />;
	return <ResultMono text={tool.result} maxHeight="max-h-56" />;
}

export function GlobPreview({ tool }: PreviewProps) {
	if (tool.status === "running") return <RunningPlaceholder text="Searching files…" />;
	if (tool.status === "error") return <ErrorBlock text={tool.result ?? "Glob failed"} />;
	if (!tool.result?.trim()) return <EmptyResult text="No files matched" />;
	return <ResultMono text={tool.result} maxHeight="max-h-56" />;
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
		case "Bash":
			return BashPreview;
		case "FileRead":
			return FileReadPreview;
		case "FileWrite":
			return FileWritePreview;
		case "FileEdit":
			return FileEditPreview;
		case "Grep":
			return GrepPreview;
		case "Glob":
			return GlobPreview;
		default:
			return DefaultPreview;
	}
}
