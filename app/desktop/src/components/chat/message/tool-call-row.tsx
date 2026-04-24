import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronRightIcon, LoaderIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ChatMessagePart } from "@/types/chat";
import { PermissionResolvedTrace } from "./permission-prompt";
import { getToolDisplayName, getToolIcon } from "./tool-icons";
import { pickPreview } from "./tool-previews";

type ToolCallData = NonNullable<ChatMessagePart["toolCall"]>;

interface ToolCallRowProps {
	tool: ToolCallData;
}

function LeadingIcon({ tool }: { tool: ToolCallData }) {
	const awaitingPermission = tool.permission?.status === "pending";

	if (awaitingPermission) {
		return (
			<span role="img" aria-label="waiting on permission" className="size-3 inline-flex items-center justify-center">
				<span className="size-1.5 rounded-full bg-primary-2/70 animate-pulse" />
			</span>
		);
	}

	if (tool.status === "running") {
		return <LoaderIcon role="img" aria-label="running" className="size-3 animate-spin text-muted-foreground/60" />;
	}

	const icon = getToolIcon(tool.name);
	const tone =
		tool.status === "error"
			? "text-destructive/70"
			: tool.status === "completed"
				? "text-muted-foreground/70"
				: "text-muted-foreground/40";

	return (
		<HugeiconsIcon
			icon={icon}
			size={12}
			strokeWidth={1.75}
			aria-hidden
			className={cn("shrink-0 translate-y-px", tone)}
		/>
	);
}

function TrailingStatus({ tool }: { tool: ToolCallData }) {
	if (tool.status === "error") {
		return <XIcon aria-label="failed" className="size-2.5 text-destructive/70 shrink-0" />;
	}
	return null;
}

function extractPrimaryArg(toolName: string, argsRaw: string | undefined): string | null {
	if (!argsRaw) return null;
	try {
		const parsed = JSON.parse(argsRaw) as Record<string, unknown>;
		if (toolName === "WebSearch" && typeof parsed.query === "string") return parsed.query;
		if (toolName === "WebFetch" && typeof parsed.url === "string") return hostOf(parsed.url);
		if (toolName === "Bash" && typeof parsed.description === "string" && parsed.description.trim())
			return parsed.description.trim();
		const candidate =
			parsed.path ?? parsed.file_path ?? parsed.command ?? parsed.pattern ?? parsed.url ?? parsed.query ?? null;
		if (typeof candidate !== "string") return null;
		const trimmed = candidate.trim();
		if (!trimmed) return null;
		return trimmed.length > 72 ? `${trimmed.slice(0, 72)}…` : trimmed;
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

function shouldAutoExpand(tool: ToolCallData): boolean {
	if (tool.permission?.status === "pending") return true;
	return tool.status === "running" || tool.status === "error";
}

function useAutoExpand(tool: ToolCallData) {
	const [expanded, setExpanded] = useState(shouldAutoExpand(tool));
	const lastStatus = useRef(tool.status);
	const lastPerm = useRef(tool.permission?.status);

	useEffect(() => {
		const statusChanged = lastStatus.current !== tool.status;
		const permChanged = lastPerm.current !== tool.permission?.status;
		if (statusChanged || permChanged) {
			setExpanded(shouldAutoExpand(tool));
			lastStatus.current = tool.status;
			lastPerm.current = tool.permission?.status;
		}
	}, [tool]);

	return [expanded, setExpanded] as const;
}

// Ticks once per second while `active` is true. Returns elapsed seconds since
// the most recent transition into active. Resets to 0 when active flips off.
function useElapsedSeconds(active: boolean): number {
	const [sec, setSec] = useState(0);
	const startAt = useRef<number | null>(null);

	useEffect(() => {
		if (!active) {
			startAt.current = null;
			setSec(0);
			return;
		}
		startAt.current = Date.now();
		setSec(0);
		const id = setInterval(() => {
			if (startAt.current != null) setSec(Math.floor((Date.now() - startAt.current) / 1000));
		}, 1000);
		return () => clearInterval(id);
	}, [active]);

	return sec;
}

export function ToolCallRow({ tool }: ToolCallRowProps) {
	const awaitingPermission = tool.permission?.status === "pending";
	const resolvedPermission = tool.permission?.status === "resolved" ? tool.permission : null;
	const [expanded, setExpanded] = useAutoExpand(tool);
	const elapsed = useElapsedSeconds(tool.status === "running");
	const primaryArg = extractPrimaryArg(tool.name, tool.args);
	const displayName = getToolDisplayName(tool.name);
	const Preview = pickPreview(tool.name);
	const hasPreview = Boolean(tool.args || tool.result || resolvedPermission);

	const isError = tool.status === "error";
	const rowTone = awaitingPermission
		? "text-foreground/75"
		: isError
			? "text-destructive/85 hover:text-destructive"
			: "text-muted-foreground/70 hover:text-foreground/85";
	const labelTone = awaitingPermission ? "text-foreground/90" : isError ? "text-destructive/90" : "text-foreground/75";
	const argTone = isError ? "text-destructive/60" : "text-muted-foreground/55";
	const dotTone = isError ? "text-destructive/30" : "text-muted-foreground/30";

	return (
		<div>
			<button
				type="button"
				disabled={!hasPreview}
				aria-expanded={expanded}
				onClick={() => hasPreview && setExpanded(!expanded)}
				className={cn(
					"group/row flex items-center gap-2 w-full py-1.5 text-left text-[11.5px] leading-none rounded-sm transition-colors",
					hasPreview ? "cursor-pointer" : "cursor-default",
					rowTone,
				)}
			>
				<LeadingIcon tool={tool} />
				<span className={cn("font-medium shrink-0", labelTone)}>{displayName}</span>
				{primaryArg ? (
					<>
						<span aria-hidden className={cn("shrink-0", dotTone)}>
							·
						</span>
						<span className={cn("min-w-0 flex-1 truncate font-mono text-[11px]", argTone)}>{primaryArg}</span>
					</>
				) : (
					<span className="flex-1" />
				)}
				{tool.status === "running" && elapsed >= 3 && (
					<span
						role="timer"
						aria-label={`${elapsed} seconds elapsed`}
						className="text-[10.5px] tabular-nums text-muted-foreground/55 shrink-0"
					>
						{elapsed}s
					</span>
				)}
				<TrailingStatus tool={tool} />
				{hasPreview && (
					<ChevronRightIcon
						aria-hidden
						className={cn(
							"size-2.5 shrink-0 transition-[transform,opacity] duration-200 ease-out",
							isError ? "text-destructive/45" : "text-muted-foreground/35",
							expanded
								? "rotate-90 opacity-100"
								: "opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100",
						)}
					/>
				)}
			</button>

			<div
				className={cn(
					"grid transition-[grid-template-rows,opacity] duration-200 ease-out",
					expanded && hasPreview ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
				)}
			>
				<div className="overflow-hidden">
					<Preview tool={tool} />
					{resolvedPermission && <PermissionResolvedTrace permission={resolvedPermission} />}
				</div>
			</div>
		</div>
	);
}
