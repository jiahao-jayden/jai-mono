import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { filesForAttachments } from "@/lib/attachment-files";
import { type IconName, useIcon } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type {
	DesktopNarrationItem,
	DesktopThinkingItem,
	DesktopToolItem,
	DesktopTranscriptItem,
} from "../../../../shared/desktop-rpc";
import { ChatMessage } from "../../ui/chat-message";
import { ThinkingStep, ThinkingSteps, ThinkingStepsContent, ThinkingStepsHeader } from "../../ui/thinking-steps";
import { ToolCall } from "../../ui/tool-call";
import { SubagentCard } from "./subagent-card";

type WorkItem = DesktopThinkingItem | DesktopNarrationItem | DesktopToolItem;

interface WorkGroup {
	readonly id: string;
	readonly items: readonly WorkItem[];
}

type WorkProcessRow =
	| { readonly kind: "exploration"; readonly id: string; readonly items: readonly DesktopToolItem[] }
	| { readonly kind: "item"; readonly item: WorkItem };

type ToolCategory = "search" | "read" | "update" | "command" | "skill" | "other";

const MemoizedTranscriptItem = memo(TranscriptItem);
const MemoizedWorkProcess = memo(WorkProcess, sameWorkProcess);

export function TranscriptItems({ items, loading }: { items: readonly DesktopTranscriptItem[]; loading: boolean }) {
	const animatedItemIds = useTranscriptItemAnimations(items, loading);
	const rows = groupTranscriptItems(items);

	return rows.map((row, index) =>
		"kind" in row ? (
			<MemoizedTranscriptItem key={row.id} animate={animatedItemIds.has(row.id)} item={row} />
		) : (
			<MemoizedWorkProcess key={row.id} group={row} settled={index < rows.length - 1} />
		),
	);
}

export function groupTranscriptItems(items: readonly DesktopTranscriptItem[]): (DesktopTranscriptItem | WorkGroup)[] {
	const rows: (DesktopTranscriptItem | WorkGroup)[] = [];

	for (const item of items) {
		if (item.kind === "message" && item.role === "toolResult") continue;
		if (item.kind === "permission" || item.kind === "extension_permission") continue;
		if (isWorkItem(item)) {
			const turnId = workItemTurnId(item);
			const previous = rows.at(-1);
			if (previous && !("kind" in previous) && workItemTurnId(previous.items[0]!) === turnId) {
				rows[rows.length - 1] = { ...previous, items: [...previous.items, item] };
			} else {
				rows.push({ id: `work:${turnId}:${item.id}`, items: [item] });
			}
			continue;
		}
		rows.push(item);
	}
	return rows;
}

export function TranscriptItem({ item, animate = false }: { item: DesktopTranscriptItem; animate?: boolean }) {
	if (item.kind === "thinking" || item.kind === "narration") {
		return <WorkProcess group={{ id: `work:${item.id}`, items: [item] }} settled={false} />;
	}
	if (item.kind === "message") {
		if (item.role === "toolResult") return null;
		const user = item.role === "user";
		const messageAlignment = cn("flex py-1", {
			"justify-end": user,
			"justify-start": !user,
		});
		const messageClassName = cn("max-w-full", {
			"max-w-[78%]": user,
		});
		const from = user ? "user" : "assistant";
		const isStreaming = item.status === "streaming";
		const attachmentFiles = item.attachments ? filesForAttachments(item.attachments) : [];
		const messageAttachments = attachmentFiles.length > 0 ? undefined : item.attachments;
		return (
			<div className={messageAlignment} data-transcript-item-id={item.id}>
				<ChatMessage
					animate={animate}
					attachments={messageAttachments}
					className={messageClassName}
					from={from}
					files={attachmentFiles}
					isStreaming={isStreaming}
				>
					{item.text}
				</ChatMessage>
			</div>
		);
	}

	if (item.kind === "tool") {
		const presentation = toolPresentation(item);
		return (
			<ToolCall
				icon={presentation.icon}
				label={presentation.label}
				summary={item.summary}
				details={item.details}
				status={item.status}
			/>
		);
	}

	if (item.kind === "subagent") {
		return (
			<div className="py-1" data-transcript-item-id={item.id}>
				<SubagentCard item={item} />
			</div>
		);
	}

	if (item.kind === "permission" || item.kind === "extension_permission") {
		return null;
	}

	if (item.kind === "compaction") {
		return <CompactionDivider item={item} />;
	}

	return null;
}

function CompactionDivider({
	item,
}: {
	readonly item: Extract<DesktopTranscriptItem, { readonly kind: "compaction" }>;
}) {
	const LoaderIcon = useIcon("loader");
	const compacting = item.status === "compacting";
	const label = compacting ? "Compacting context" : "Context compacted";
	const live = compacting ? "polite" : "off";
	const indicator = compacting ? (
		<LoaderIcon
			size={13}
			strokeWidth={1.75}
			className="shrink-0 animate-spin motion-reduce:animate-none"
			aria-hidden="true"
		/>
	) : undefined;
	const className = cn("flex items-center gap-3 py-2 text-[11.5px] text-muted-foreground", {
		"text-primary-2/90": compacting,
	});

	return (
		<div className={className} aria-live={live} data-transcript-item-id={item.id}>
			<span className="h-px flex-1 bg-border" />
			<span className="inline-flex items-center gap-1.5">
				{indicator}
				{label}
			</span>
			<span className="h-px flex-1 bg-border" />
		</div>
	);
}

function useTranscriptItemAnimations(items: readonly DesktopTranscriptItem[], loading: boolean): ReadonlySet<string> {
	const seenItemIds = useRef(new Set<string>());
	const awaitingSnapshot = useRef(true);

	if (loading) {
		seenItemIds.current.clear();
		awaitingSnapshot.current = true;
	}

	if (awaitingSnapshot.current && !loading) {
		for (const item of items) seenItemIds.current.add(item.id);
		awaitingSnapshot.current = false;
	}

	const animatedItemIds = new Set(items.filter((item) => !seenItemIds.current.has(item.id)).map((item) => item.id));

	useLayoutEffect(() => {
		for (const item of items) seenItemIds.current.add(item.id);
	}, [items]);

	return animatedItemIds;
}

function WorkProcess({ group, settled }: { readonly group: WorkGroup; readonly settled: boolean }) {
	const running = group.items.some(
		(item) =>
			(item.kind === "thinking" && item.status === "streaming") ||
			(item.kind === "narration" && item.status === "streaming") ||
			(item.kind === "tool" && item.status === "running"),
	);
	const [open, setOpen] = useState(running);

	useEffect(() => {
		if (running) {
			setOpen(true);
		} else if (settled) {
			setOpen(false);
		}
	}, [running, settled]);

	const title = workGroupTitle(group.items, running);
	const rows = workProcessRows(group.items);
	const anchorItem = group.items.at(-1);

	return (
		<ThinkingSteps open={open} onOpenChange={setOpen} className="w-full" data-transcript-item-id={anchorItem?.id}>
			<ThinkingStepsHeader>{title}</ThinkingStepsHeader>
			<ThinkingStepsContent className="gap-1 px-1 pb-2 pt-1">
				{rows.map((row) =>
					row.kind === "exploration" ? (
						<ExplorationStep key={row.id} items={row.items} />
					) : (
						<WorkProcessStep key={row.item.id} item={row.item} />
					),
				)}
			</ThinkingStepsContent>
		</ThinkingSteps>
	);
}

export function workGroupTitle(items: readonly WorkItem[], running: boolean): string {
	const tool = items.find((item): item is DesktopToolItem => item.kind === "tool");
	if (tool?.toolName === "Skill") {
		const skill = tool.summary?.replace(/^\//, "");
		if (skill) return running ? `Loading ${skill}…` : `Loaded ${skill}`;
	}
	if (tool) {
		switch (toolCategory(tool.toolName)) {
			case "search":
			case "read":
				return "Exploring";
			case "update":
				return "Implementing";
			case "command":
				return "Executing";
			case "skill":
				return "Loading skill";
			case "other":
				return "Working";
		}
	}
	if (items.some((item) => item.kind === "thinking")) return running ? "Reasoning…" : "Reasoning";
	return running ? "Working…" : "Working";
}

export function workProcessRows(items: readonly WorkItem[]): readonly WorkProcessRow[] {
	const rows: WorkProcessRow[] = [];
	for (const item of items) {
		if (item.kind === "tool" && isExplorationTool(item)) {
			const previous = rows.at(-1);
			if (previous?.kind === "exploration") {
				rows[rows.length - 1] = { ...previous, items: [...previous.items, item] };
			} else {
				rows.push({ kind: "exploration", id: `exploration:${item.id}`, items: [item] });
			}
			continue;
		}
		rows.push({ kind: "item", item });
	}
	return rows;
}

function sameWorkProcess(
	previous: { readonly group: WorkGroup; readonly settled: boolean },
	next: { readonly group: WorkGroup; readonly settled: boolean },
): boolean {
	if (previous.settled !== next.settled) return false;
	if (previous.group.id !== next.group.id || previous.group.items.length !== next.group.items.length) return false;
	return previous.group.items.every((item, index) => item === next.group.items[index]);
}

function WorkProcessStep({ item }: { readonly item: WorkItem }) {
	const thinkingRef = useRef<HTMLParagraphElement>(null);
	const followsThinkingRef = useRef(true);

	useLayoutEffect(() => {
		if (item.kind !== "thinking" || item.status !== "streaming" || !followsThinkingRef.current) return;
		const element = thinkingRef.current;
		if (element) element.scrollTop = element.scrollHeight;
	}, [item]);

	if (item.kind === "tool") return <ToolStep item={item} />;
	if (item.kind === "narration") {
		return (
			<ThinkingStep
				showIcon={false}
				label={item.text}
				status={item.status === "streaming" ? "active" : "complete"}
			/>
		);
	}
	if (item.kind === "thinking") {
		return (
			<ThinkingStep icon="clock" label="Reasoning" status={item.status === "streaming" ? "active" : "complete"}>
				<p
					ref={thinkingRef}
					className="max-h-48 overflow-y-auto pt-1 text-[12px] leading-relaxed whitespace-pre-wrap text-muted-foreground"
					onScroll={(event) => {
						const element = event.currentTarget;
						followsThinkingRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 24;
					}}
				>
					{item.text}
				</p>
			</ThinkingStep>
		);
	}
	return null;
}

function ExplorationStep({ items }: { readonly items: readonly DesktopToolItem[] }) {
	const running = items.some((item) => item.status === "running");
	const label = explorationSummary(items, running);
	return (
		<ThinkingStep icon="search" label={label} status={running ? "active" : "complete"}>
			<div className="flex flex-col gap-1 py-1">
				{items.map((item) => (
					<ToolStep key={item.id} item={item} />
				))}
			</div>
		</ThinkingStep>
	);
}

export function explorationSummary(items: readonly DesktopToolItem[], running: boolean): string {
	if (running) return "Exploring";
	const files = items.filter((item) => toolCategory(item.toolName) === "read").length;
	const searches = items.length - files;
	const parts = [
		files > 0 ? `${files} ${files === 1 ? "file" : "files"}` : undefined,
		searches > 0 ? `${searches} ${searches === 1 ? "search" : "searches"}` : undefined,
	].filter((part): part is string => Boolean(part));
	return `Explored ${parts.join(", ")}`;
}

function ToolStep({ item }: { readonly item: DesktopToolItem }) {
	const presentation = toolPresentation(item);
	return (
		<ToolCall
			icon={presentation.icon}
			label={presentation.label}
			summary={item.summary}
			details={item.details}
			status={item.status}
		/>
	);
}

function toolPresentation(item: DesktopToolItem): { icon: IconName; label: string } {
	const category = toolCategory(item.toolName);
	if (category === "search") {
		return {
			icon: "search",
			label: item.status === "running" ? "Searching code" : "Searched code",
		};
	}
	if (category === "read") {
		return {
			icon: "file-code",
			label: item.status === "running" ? "Reading files" : "Read files",
		};
	}
	if (category === "update") {
		return {
			icon: "file-code",
			label: item.status === "running" ? "Updating files" : "Updated files",
		};
	}
	if (category === "command") {
		return {
			icon: "terminal",
			label: item.status === "running" ? "Running command" : "Ran command",
		};
	}
	return {
		icon: "terminal",
		label: item.status === "running" ? "Working" : "Completed work",
	};
}

function toolCategory(toolName: string): ToolCategory {
	const normalizedName = toolName.toLowerCase();
	if (normalizedName.includes("search") || normalizedName === "grep" || normalizedName === "glob") return "search";
	if (normalizedName.includes("read")) return "read";
	if (normalizedName.includes("write") || normalizedName.includes("edit")) return "update";
	if (normalizedName === "bash" || normalizedName.includes("shell") || normalizedName.includes("terminal")) {
		return "command";
	}
	if (normalizedName === "skill") return "skill";
	return "other";
}

function isExplorationTool(item: DesktopToolItem): boolean {
	const category = toolCategory(item.toolName);
	return category === "search" || category === "read";
}

function isWorkItem(item: DesktopTranscriptItem): item is WorkItem {
	return item.kind === "thinking" || item.kind === "narration" || item.kind === "tool";
}

function workItemTurnId(item: WorkItem): string {
	return item.turnId;
}

export function TranscriptLoading() {
	return (
		<div className="space-y-4 py-6" role="status" aria-label="Loading conversation">
			<div className="ml-auto h-12 w-56 animate-pulse rounded-[14px] bg-primary-2/8" />
			<div className="h-4 w-[72%] animate-pulse rounded bg-foreground/6" />
			<div className="h-4 w-[58%] animate-pulse rounded bg-foreground/5" />
		</div>
	);
}
