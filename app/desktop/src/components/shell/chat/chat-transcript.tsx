import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { filesForAttachments } from "@/lib/attachment-files";
import { type IconName, useIcon } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type {
	DesktopNarrationItem,
	DesktopThinkingItem,
	DesktopToolActivityKind,
	DesktopToolItem,
	DesktopTranscriptItem,
} from "../../../../shared/desktop-rpc";
import { type TimelineStep, ToolTimeline } from "../../elements/tool-timeline";
import { ChatMessage } from "../../ui/chat-message";
import { SubagentCard } from "./subagent-card";

type WorkItem = DesktopThinkingItem | DesktopNarrationItem | DesktopToolItem;

interface WorkGroup {
	readonly id: string;
	readonly items: readonly WorkItem[];
}

interface WorkTimelineCluster {
	readonly id: string;
	readonly kind: "thinking" | "narration" | DesktopToolActivityKind;
	readonly activityId: string;
	readonly items: readonly WorkItem[];
	readonly narrations: readonly DesktopNarrationItem[];
}

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
	const pendingCompactions: DesktopTranscriptItem[] = [];

	for (const item of items) {
		if (item.kind === "message" && item.role === "toolResult") continue;
		if (item.kind === "permission" || item.kind === "extension_permission") continue;
		if (item.kind === "compaction") {
			pendingCompactions.push(item);
			continue;
		}
		if (isWorkItem(item)) {
			const turnId = workItemTurnId(item);
			const previous = rows.at(-1);
			if (previous && !("kind" in previous) && workItemTurnId(previous.items[0]!) === turnId) {
				rows[rows.length - 1] = { ...previous, items: [...previous.items, item] };
				pendingCompactions.length = 0;
			} else {
				rows.push(...pendingCompactions);
				pendingCompactions.length = 0;
				rows.push({ id: `work:${turnId}:${item.id}`, items: [item] });
			}
			continue;
		}
		const previous = rows.at(-1);
		if (!previous || "kind" in previous) rows.push(...pendingCompactions);
		pendingCompactions.length = 0;
		rows.push(item);
	}
	const previous = rows.at(-1);
	if (!previous || "kind" in previous) rows.push(...pendingCompactions);
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
		return <WorkProcess group={{ id: `work:${item.id}`, items: [item] }} settled={false} />;
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
	const steps = workTimelineSteps(group.items);
	const [open, setOpen] = useState(running);

	useEffect(() => {
		if (running) {
			setOpen(true);
		} else if (settled) {
			setOpen(false);
		}
	}, [running, settled]);

	const anchorItem = group.items.at(-1);
	if (steps.length === 0) return null;

	const label = workTimelineSummary(steps, group.items, running);

	return (
		<div className="py-0.5" data-transcript-item-id={anchorItem?.id}>
			<ToolTimeline
				activeLabel={label}
				className="max-w-none"
				open={open}
				onOpenChange={setOpen}
				restingLabel={label}
				steps={steps}
				streaming={running}
			/>
		</div>
	);
}

function sameWorkProcess(
	previous: { readonly group: WorkGroup; readonly settled: boolean },
	next: { readonly group: WorkGroup; readonly settled: boolean },
): boolean {
	if (previous.settled !== next.settled) return false;
	if (previous.group.id !== next.group.id || previous.group.items.length !== next.group.items.length) return false;
	return previous.group.items.every((item, index) => item === next.group.items[index]);
}

export function workTimelineSteps(items: readonly WorkItem[]): TimelineStep[] {
	return workTimelineClusters(items).map((cluster) => {
		const running = cluster.items.some(
			(item) =>
				(item.kind === "thinking" && item.status === "streaming") ||
				(item.kind === "narration" && item.status === "streaming") ||
				(item.kind === "tool" && item.status === "running"),
		);
		if (cluster.kind === "thinking") {
			const text = cluster.items
				.filter((item): item is DesktopThinkingItem => item.kind === "thinking")
				.map((item) => item.text)
				.join("\n\n");
			return {
				id: cluster.id,
				verb: "Thinking",
				chip: text,
				icon: "sparkles",
				active: running,
				...(text.length > 160 ? { details: text } : {}),
			};
		}

		const tools = cluster.items.filter((item): item is DesktopToolItem => item.kind === "tool");
		if (tools.length === 0) {
			const narration = cluster.narrations.map((item) => item.text).join("\n\n");
			return {
				id: cluster.id,
				verb: running ? "Working" : "Worked",
				chip: narration,
				icon: "sparkles",
				active: running,
			};
		}

		const presentation = toolPresentation(tools[0]!, running);
		const details = toolClusterDetails(cluster.narrations, tools);
		return {
			id: cluster.id,
			verb: presentation.label,
			chip: toolClusterChip(tools),
			icon: presentation.icon,
			active: running,
			...(details ? { details } : {}),
		};
	});
}

function workTimelineClusters(items: readonly WorkItem[]): readonly WorkTimelineCluster[] {
	const clusters: WorkTimelineCluster[] = [];
	let pendingNarrations: DesktopNarrationItem[] = [];

	for (const item of items) {
		if (item.kind === "narration") {
			pendingNarrations = [...pendingNarrations, item];
			continue;
		}

		const kind = item.kind === "thinking" ? "thinking" : item.activityKind;
		const previous = clusters.at(-1);
		if (previous && previous.kind === kind && previous.activityId === item.activityId) {
			clusters[clusters.length - 1] = {
				...previous,
				items: [...previous.items, item],
				narrations: [...previous.narrations, ...pendingNarrations],
			};
		} else {
			clusters.push({
				id: `timeline:${item.id}`,
				kind,
				activityId: item.activityId,
				items: [item],
				narrations: pendingNarrations,
			});
		}
		pendingNarrations = [];
	}

	if (pendingNarrations.length > 0) {
		clusters.push({
			id: `timeline:${pendingNarrations[0]!.id}`,
			kind: "narration",
			activityId: pendingNarrations[0]!.activityId,
			items: [],
			narrations: pendingNarrations,
		});
	}

	return clusters;
}

function toolClusterChip(items: readonly DesktopToolItem[]): string {
	if (items.length > 1) {
		const category = items[0]!.activityKind;
		if (category === "search") return `${items.length} searches`;
		if (category === "read" || category === "write") return `${items.length} files`;
		if (category === "execute") return `${items.length} commands`;
		return `${items.length} actions`;
	}
	const tool = items[0]!;
	return tool.summary ?? humanizeToolName(tool.toolName);
}

function toolClusterDetails(
	narrations: readonly DesktopNarrationItem[],
	tools: readonly DesktopToolItem[],
): string | undefined {
	const narration = narrations.map((item) => item.text).join("\n\n");
	const toolDetails = tools
		.map((item) => {
			const summary = toolClusterChip([item]);
			const details = item.details ? `\n${item.details}` : "";
			return `${humanizeToolName(item.toolName)} · ${summary}${details}`;
		})
		.join("\n\n");
	return [narration, toolDetails].filter(Boolean).join("\n\n") || undefined;
}

export function workTimelineSummary(
	steps: readonly TimelineStep[],
	items: readonly WorkItem[],
	running: boolean,
): string {
	const operationCount = items.filter((item): item is DesktopToolItem => item.kind === "tool").length;
	const filesChanged = new Set(
		items
			.filter((item): item is DesktopToolItem => item.kind === "tool" && item.activityKind === "write")
			.map((item) => item.summary)
			.filter((summary): summary is string => Boolean(summary)),
	).size;
	const stepLabel = `${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
	if (running) return `${stepLabel} · Working`;
	if (filesChanged > 0) return `${stepLabel} · ${filesChanged} ${filesChanged === 1 ? "file" : "files"} changed`;
	return `${stepLabel} · ${operationCount} ${operationCount === 1 ? "action" : "actions"}`;
}

function toolPresentation(item: DesktopToolItem, running: boolean): { icon: IconName; label: string } {
	const category = item.activityKind;
	if (category === "search") {
		return {
			icon: "search",
			label: running ? "Searching" : "Searched",
		};
	}
	if (category === "read") {
		return {
			icon: "file-code",
			label: running ? "Reading" : "Read",
		};
	}
	if (category === "write") {
		return {
			icon: "file-code",
			label: running ? "Editing" : "Edited",
		};
	}
	// execute 与 operation 共用 Ran：未知能力的工具不假装成命令，也不另造动词。
	return {
		icon: "terminal",
		label: running ? "Running" : "Ran",
	};
}

function humanizeToolName(toolName: string): string {
	const normalized = toolName.replace(/^[a-z]+__/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
	const words = normalized.split(/[_\s-]+/).filter(Boolean);
	return words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
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
