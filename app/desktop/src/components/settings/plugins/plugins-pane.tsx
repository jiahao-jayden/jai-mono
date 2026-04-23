import { CancelCircleIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { PluginListItem } from "@jayden/jai-gateway";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import { gateway } from "@/services/gateway";
import { SettingsHeader, SettingsPage } from "../common/settings-layout";
import { PluginCard } from "./plugin-card";
import { PluginsEmpty } from "./plugins-empty";

function filterPlugins(plugins: PluginListItem[], query: string): PluginListItem[] {
	const q = query.trim().toLowerCase();
	if (!q) return plugins;
	return plugins.filter((p) => {
		const haystack = [p.name, p.description ?? "", p.version ?? "", p.loadError ?? ""].join(" ").toLowerCase();
		return haystack.includes(q);
	});
}

export function PluginsPane() {
	const { data, isLoading, isError, error } = useQuery({
		queryKey: ["plugins"],
		queryFn: () => gateway.plugins.list(),
	});

	const [query, setQuery] = useState("");
	const deferredQuery = useDeferredValue(query);

	const plugins: PluginListItem[] = data?.plugins ?? [];
	const visible = useMemo(() => filterPlugins(plugins, deferredQuery), [plugins, deferredQuery]);

	const hasPlugins = plugins.length > 0;
	const hasMatches = visible.length > 0;

	return (
		<SettingsPage>
			<SettingsHeader
				title="Plugins"
				description={
					<>
						Plugins live under <code className="font-mono text-[12px] text-foreground/80">~/.jai/plugins/</code>.
						Expand an entry to tweak its environment and configuration.
					</>
				}
				action={
					hasPlugins ? (
						<span className="font-serif text-[12.5px] italic text-muted-foreground/60 tabular-nums">
							{deferredQuery ? `${visible.length} / ${plugins.length}` : `${plugins.length} installed`}
						</span>
					) : undefined
				}
			/>

			{hasPlugins && <SearchField query={query} onChange={setQuery} />}

			{isLoading && <PluginsLoading />}
			{isError && <PluginsError message={error instanceof Error ? error.message : String(error)} />}
			{!isLoading && !isError && !hasPlugins && <PluginsEmpty />}
			{!isLoading && !isError && hasPlugins && !hasMatches && <NoMatches query={deferredQuery} />}
			{!isLoading && !isError && hasMatches && (
				<ul className="space-y-2.5">
					{visible.map((p) => (
						<li key={p.rootPath}>
							<PluginCard plugin={p} />
						</li>
					))}
				</ul>
			)}
		</SettingsPage>
	);
}

function SearchField({ query, onChange }: { query: string; onChange: (v: string) => void }) {
	return (
		<div className="flex items-center gap-2.5 border-b border-border/40 pb-2.5 focus-within:border-border/70 transition-colors -mt-4">
			<HugeiconsIcon
				icon={Search01Icon}
				size={14}
				strokeWidth={1.75}
				className="shrink-0 text-muted-foreground/50"
			/>
			<input
				type="search"
				value={query}
				onChange={(e) => onChange(e.target.value)}
				placeholder="Search plugins…"
				spellCheck={false}
				autoComplete="off"
				className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/45 placeholder:font-serif placeholder:italic outline-none"
			/>
			{query && (
				<button
					type="button"
					onClick={() => onChange("")}
					className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground/80 transition-colors"
					aria-label="清除搜索"
				>
					<HugeiconsIcon icon={CancelCircleIcon} size={14} strokeWidth={1.75} />
				</button>
			)}
		</div>
	);
}

function NoMatches({ query }: { query: string }) {
	return (
		<div className="rounded-2xl bg-card/50 ring-1 ring-border/40 px-6 py-7 text-center">
			<p className="font-serif italic text-[13.5px] text-foreground/70">
				没有匹配 <span className="not-italic font-mono text-[12.5px] text-foreground/85">“{query}”</span> 的插件。
			</p>
		</div>
	);
}

function PluginsLoading() {
	return (
		<ul className="space-y-2.5" aria-busy="true">
			{[0, 1, 2].map((i) => (
				<li key={i} className="rounded-2xl bg-card/50 ring-1 ring-border/40 px-5 py-4">
					<div className="h-4 w-40 rounded bg-muted/50 animate-pulse" />
					<div className="mt-2.5 h-3 w-64 rounded bg-muted/30 animate-pulse" />
				</li>
			))}
		</ul>
	);
}

function PluginsError({ message }: { message: string }) {
	return (
		<div className="rounded-2xl bg-card/50 ring-1 ring-border/40 px-5 py-5">
			<p className="text-[13px] text-foreground/80">无法加载插件列表</p>
			<p className="mt-1.5 font-serif italic text-[12.5px] text-muted-foreground/70">{message}</p>
		</div>
	);
}
