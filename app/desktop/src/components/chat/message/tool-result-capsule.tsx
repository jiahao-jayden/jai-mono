import { motion } from "motion/react";
import { useState } from "react";
import { CapsuleHost } from "@/components/capsule";
import { useCapsuleResource } from "@/hooks/use-capsule-resource";
import type { ParsedCapsuleSignal } from "@/lib/capsule-signal";
import { cn } from "@/lib/utils";
import { useResolvedTheme } from "@/stores/theme";

interface ToolResultCapsuleProps {
	instanceId: string;
	signal: ParsedCapsuleSignal;
}

const MIN_HEIGHT = 120;

export function ToolResultCapsule({ instanceId, signal }: ToolResultCapsuleProps) {
	const state = useCapsuleResource(signal.url);
	const theme = useResolvedTheme();
	const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

	return (
		<motion.div
			initial={{ opacity: 0, y: 4 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ type: "spring", stiffness: 300, damping: 24 }}
			className={cn("my-1 rounded-lg overflow-hidden", "border border-border/40 bg-card/40")}
		>
			{state.kind === "loading" && <CapsuleSkeleton title={titleFromUrl(signal.url)} />}

			{state.kind === "error" && <CapsuleError signal={signal} message={state.error.message} />}

			{state.kind === "ready" && (
				<div className="transition-[height] duration-200 ease-out" style={{ height: measuredHeight ?? MIN_HEIGHT }}>
					<CapsuleHost
						instanceId={instanceId}
						bundleCode={state.resource.bundleCode}
						data={signal.data}
						theme={theme}
						onResize={(_w, h) => {
							if (typeof h === "number" && Number.isFinite(h) && h > 0) {
								setMeasuredHeight(Math.max(MIN_HEIGHT, Math.round(h)));
							}
						}}
					/>
				</div>
			)}
		</motion.div>
	);
}

function CapsuleSkeleton({ title }: { title: string }) {
	return (
		<div role="status" aria-busy="true" className="flex h-30 items-center justify-center">
			<span className="sr-only">Loading capsule {title}</span>
			<span aria-hidden className="inline-flex items-center gap-1">
				<span className="size-1 rounded-full bg-muted-foreground/35 animate-[pulse_1.1s_ease-in-out_infinite]" />
				<span className="size-1 rounded-full bg-muted-foreground/35 animate-[pulse_1.1s_ease-in-out_0.15s_infinite]" />
				<span className="size-1 rounded-full bg-muted-foreground/35 animate-[pulse_1.1s_ease-in-out_0.3s_infinite]" />
			</span>
		</div>
	);
}

function CapsuleError({ signal, message }: { signal: ParsedCapsuleSignal; message: string }) {
	return (
		<div role="status" title={message} className="flex h-22 items-center justify-center px-4 text-center">
			<p className="text-[12.5px] italic text-muted-foreground/65 leading-relaxed">
				无法加载 capsule
				<span className="not-italic font-mono text-[11.5px] text-muted-foreground/50 ml-1.5">
					{titleFromUrl(signal.url)}
				</span>
			</p>
		</div>
	);
}

function titleFromUrl(url: string): string {
	const m = url.match(/\/r\/([^/]+)\/?$/);
	return m?.[1] ?? url;
}
