export function PluginsEmpty() {
	return (
		<div className="rounded-2xl border border-border/40 bg-card/30 px-6 py-8 text-center">
			<p className="font-serif italic text-[14px] text-foreground/70">这里暂时没有已发现的插件。</p>
			<p className="mt-2 text-[12.5px] text-muted-foreground/60 leading-relaxed">
				把插件目录放到 <code className="font-mono text-[11.5px]">~/.jai/plugins/</code> 下，
				<br />
				目录中需包含 <code className="font-mono text-[11.5px]">plugin.json</code>。
			</p>
		</div>
	);
}
