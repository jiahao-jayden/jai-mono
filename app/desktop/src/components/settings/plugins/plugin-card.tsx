import type { PluginListItem } from "@jayden/jai-gateway";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ConfigEditor } from "./config-editor";
import { EnvEditor } from "./env-editor";

interface PluginCardProps {
	plugin: PluginListItem;
}

export function PluginCard({ plugin }: PluginCardProps) {
	const [expanded, setExpanded] = useState(false);
	const hasEnv = Object.keys(plugin.env).length > 0;

	return (
		<div
			className={cn(
				"rounded-2xl border bg-card/40 transition-colors",
				expanded ? "border-border/60" : "border-border/30 hover:border-border/55",
			)}
		>
			<button
				type="button"
				onClick={() => setExpanded((v) => !v)}
				className="w-full text-left px-5 py-4 flex items-start gap-4"
				aria-expanded={expanded}
			>
				<StatusMark status={plugin.status} />

				<div className="flex-1 min-w-0">
					<div className="flex items-baseline gap-2.5 flex-wrap">
						<span className="font-serif text-[15.5px] tracking-tight text-foreground truncate">
							{plugin.name}
						</span>
						{plugin.version && (
							<span className="font-mono text-[11px] text-muted-foreground/55">{plugin.version}</span>
						)}
					</div>
					{plugin.description && (
						<p className="mt-1 text-[12.5px] text-muted-foreground/75 leading-snug">{plugin.description}</p>
					)}
					{plugin.status === "error" && plugin.loadError && (
						<p className="mt-2 font-serif italic text-[12.5px] text-destructive/90 leading-snug">
							{plugin.loadError}
						</p>
					)}
				</div>

				<Chevron expanded={expanded} />
			</button>

			<AnimatePresence initial={false}>
				{expanded && (
					<motion.div
						key="panel"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ type: "spring", stiffness: 280, damping: 24 }}
						style={{ overflow: "hidden" }}
					>
						<div className="border-t border-border/30 px-5 py-5 space-y-6">
							{hasEnv && <EnvEditor pluginName={plugin.name} env={plugin.env} />}
							<ConfigEditor pluginName={plugin.name} config={plugin.config} configSchema={plugin.configSchema} />
							<PluginMeta rootPath={plugin.rootPath} />
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

function StatusMark({ status }: { status: "loaded" | "error" }) {
	const label = status === "loaded" ? "已加载" : "加载失败";
	return (
		<span
			role="img"
			aria-label={label}
			title={label}
			className={cn(
				"mt-1.5 size-2 rounded-full shrink-0",
				status === "loaded" ? "bg-primary/80" : "bg-destructive/75",
			)}
		/>
	);
}

function Chevron({ expanded }: { expanded: boolean }) {
	return (
		<motion.span
			className="mt-2 text-muted-foreground/50"
			initial={false}
			animate={{ rotate: expanded ? 90 : 0 }}
			transition={{ type: "spring", stiffness: 320, damping: 22 }}
			aria-hidden
		>
			<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden focusable="false">
				<title>chevron</title>
				<path
					d="M3.5 2L6.5 5L3.5 8"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</motion.span>
	);
}

function PluginMeta({ rootPath }: { rootPath: string }) {
	return (
		<div className="pt-2 text-[11px] text-muted-foreground/50">
			<span className="uppercase tracking-widest mr-2">path</span>
			<code className="font-mono text-[11.5px] text-muted-foreground/65">{rootPath}</code>
		</div>
	);
}
