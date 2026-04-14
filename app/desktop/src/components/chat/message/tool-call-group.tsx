import { CommandLineIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckIcon, ChevronRightIcon, LoaderIcon, TerminalIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ChatMessagePart } from "@/types/chat";

type ToolCallData = NonNullable<ChatMessagePart["toolCall"]>;

interface ToolCallGroupProps {
	tools: ToolCallData[];
}

function StatusDot({ status }: { status: ToolCallData["status"] }) {
	switch (status) {
		case "running":
			return <LoaderIcon className="size-3 animate-spin text-muted-foreground/60" />;
		case "completed":
			return <CheckIcon className="size-3 text-emerald-500/70" />;
		case "error":
			return <XIcon className="size-3 text-destructive/70" />;
		default:
			return <span className="size-1.5 rounded-full bg-muted-foreground/20" />;
	}
}

function summarize(tools: ToolCallData[]): string {
	const running = tools.filter((t) => t.status === "running");
	const errors = tools.filter((t) => t.status === "error");

	if (running.length > 0) {
		return `Running ${running[running.length - 1].name}...`;
	}
	if (errors.length > 0) {
		return `${tools.length} tools (${errors.length} failed)`;
	}
	return `Used ${tools.length} tool${tools.length > 1 ? "s" : ""}`;
}

function ToolCallItem({ tool }: { tool: ToolCallData }) {
	const [expanded, setExpanded] = useState(false);
	const hasDetail = tool.args || tool.result;

	return (
		<div>
			<button
				type="button"
				disabled={!hasDetail}
				onClick={() => hasDetail && setExpanded(!expanded)}
				className={cn(
					"flex items-center gap-2 w-full py-1 text-left text-[11px] rounded transition-colors",
					hasDetail ? "hover:text-muted-foreground/80 cursor-pointer" : "cursor-default",
					"text-muted-foreground/50",
				)}
			>
				<StatusDot status={tool.status} />
				<span className="font-medium truncate flex-1">{tool.name}</span>
				{hasDetail && (
					<ChevronRightIcon
						className={cn("size-2.5 shrink-0 transition-transform duration-150", expanded && "rotate-90")}
					/>
				)}
			</button>

			<div
				className={cn(
					"grid transition-[grid-template-rows] duration-200 ease-out",
					expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}
			>
				<div className="overflow-hidden">
					<div className="ml-5 mb-1.5 rounded-md bg-muted/30 px-3 py-2 space-y-1.5 text-[11px] font-mono text-muted-foreground/50 leading-relaxed">
						{tool.args && (
							<pre className="whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
								{tryFormatJson(tool.args)}
							</pre>
						)}
						{tool.args && tool.result && <div className="border-t border-muted-foreground/8" />}
						{tool.result && (
							<pre className="whitespace-pre-wrap break-all max-h-40 overflow-y-auto">{tool.result}</pre>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

export function ToolCallGroup({ tools }: ToolCallGroupProps) {
	const [expanded, setExpanded] = useState(false);
	const hasRunning = tools.some((t) => t.status === "running");

	return (
		<div className="w-full">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors py-0.5 rounded"
			>
				{hasRunning ? (
					<LoaderIcon className="size-3 animate-spin" />
				) : (
					<HugeiconsIcon icon={CommandLineIcon} size={16} strokeWidth={2} />
				)}
				<span>{summarize(tools)}</span>
				<ChevronRightIcon className={cn("size-2.5 transition-transform duration-150", expanded && "rotate-90")} />
			</button>

			<div
				className={cn(
					"grid transition-[grid-template-rows] duration-200 ease-out",
					expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}
			>
				<div className="overflow-hidden">
					<div className="ml-1 mt-0.5 pl-3 border-l border-muted-foreground/8">
						{tools.map((tool) => (
							<ToolCallItem key={tool.toolCallId} tool={tool} />
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

function tryFormatJson(str: string): string {
	try {
		return JSON.stringify(JSON.parse(str), null, 2);
	} catch {
		return str;
	}
}
