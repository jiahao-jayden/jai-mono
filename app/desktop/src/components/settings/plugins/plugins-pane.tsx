import type { PluginListItem } from "@jayden/jai-gateway";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon, XIcon } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { gateway } from "@/services/gateway";
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
		<section className="mx-auto max-w-170 px-8 pt-2 pb-16">
			<header className="pb-6 mb-6 border-b border-border/30">
				<p className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-widest">Plugins</p>
				<h2 className="mt-2 font-serif text-[22px] leading-tight tracking-tight text-foreground">已安装的插件</h2>
				<p className="mt-1.5 text-[13px] text-muted-foreground/70 leading-relaxed max-w-[60ch]">
					插件来自 <code className="font-mono text-[12px]">~/.jai/plugins/</code>。
					点击条目展开以编辑环境变量和配置。
				</p>

				{hasPlugins && (
					<SearchField
						query={query}
						onChange={setQuery}
						hint={deferredQuery ? `${visible.length} / ${plugins.length}` : `共 ${plugins.length} 个`}
					/>
				)}
			</header>

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
		</section>
	);
}

function SearchField({ query, onChange, hint }: { query: string; onChange: (v: string) => void; hint: string }) {
	return (
		<div className="mt-5 flex items-center gap-3 border-b border-border/40 focus-within:border-border/70 transition-colors pb-2">
			<SearchIcon className="size-3.5 shrink-0 text-muted-foreground/50" strokeWidth={1.5} />
			<input
				type="search"
				value={query}
				onChange={(e) => onChange(e.target.value)}
				placeholder="搜索插件名、描述…"
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
					<XIcon className="size-3.5" strokeWidth={1.5} />
				</button>
			)}
			<span className="text-[11px] tabular-nums text-muted-foreground/50">{hint}</span>
		</div>
	);
}

function NoMatches({ query }: { query: string }) {
	return (
		<div className="rounded-2xl border border-border/40 bg-card/30 px-6 py-7 text-center">
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
				<li key={i} className="rounded-2xl border border-border/40 bg-card/30 px-5 py-4">
					<div className="h-4 w-40 rounded bg-muted/50 animate-pulse" />
					<div className="mt-2.5 h-3 w-64 rounded bg-muted/30 animate-pulse" />
				</li>
			))}
		</ul>
	);
}

function PluginsError({ message }: { message: string }) {
	return (
		<div className="rounded-2xl border border-border/40 bg-card/30 px-5 py-5">
			<p className="text-[13px] text-foreground/80">无法加载插件列表</p>
			<p className="mt-1.5 font-serif italic text-[12.5px] text-muted-foreground/70">{message}</p>
		</div>
	);
}
