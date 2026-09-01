import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type IntlShape, useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
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
import { Button } from "../../ui/button";
import { ChatMessage } from "../../ui/chat-message";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog";
import { Tooltip } from "../../ui/tooltip";
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

export function TranscriptItems({
	items,
	loading,
	navigationDisabled = false,
	onNavigate,
}: {
	readonly items: readonly DesktopTranscriptItem[];
	readonly loading: boolean;
	readonly navigationDisabled?: boolean;
	readonly onNavigate?: (entryId: string) => Promise<boolean>;
}) {
	const animatedItemIds = useTranscriptItemAnimations(items, loading);
	const rows = groupTranscriptItems(items);

	return rows.map((row, index) =>
		"kind" in row ? (
			<MemoizedTranscriptItem
				key={row.id}
				animate={animatedItemIds.has(row.id)}
				item={row}
				navigationDisabled={navigationDisabled}
				onNavigate={onNavigate}
			/>
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
		if (item.kind === "permission") continue;
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

export function TranscriptItem({
	item,
	animate = false,
	navigationDisabled = false,
	onNavigate,
}: {
	readonly item: DesktopTranscriptItem;
	readonly animate?: boolean;
	readonly navigationDisabled?: boolean;
	readonly onNavigate?: (entryId: string) => Promise<boolean>;
}) {
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
		const navigation = user && item.entryId && onNavigate ? { entryId: item.entryId, onNavigate } : undefined;
		const actions = navigation ? (
			<NavigateToMessageAction
				disabled={navigationDisabled}
				entryId={navigation.entryId}
				onNavigate={navigation.onNavigate}
			/>
		) : undefined;
		return (
			<div className={messageAlignment} data-transcript-item-id={item.id}>
				<ChatMessage
					animate={animate}
					attachments={messageAttachments}
					className={messageClassName}
					from={from}
					files={attachmentFiles}
					isStreaming={isStreaming}
					actions={actions}
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

	if (item.kind === "permission") {
		return null;
	}

	if (item.kind === "compaction") {
		return <CompactionDivider item={item} />;
	}

	return null;
}

function NavigateToMessageAction({
	disabled,
	entryId,
	onNavigate,
}: {
	readonly disabled: boolean;
	readonly entryId: string;
	readonly onNavigate: (entryId: string) => Promise<boolean>;
}) {
	const intl = useIntl();
	const CornerDownRightIcon = useIcon("corner-down-right");
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const actionDisabled = disabled || pending;

	const openDialog = () => {
		if (actionDisabled) return;
		setError(undefined);
		setOpen(true);
	};
	const onOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && !pending) {
			setError(undefined);
			setOpen(false);
		}
	};
	const navigate = async () => {
		if (pending) return;
		setPending(true);
		setError(undefined);
		try {
			if (await onNavigate(entryId)) {
				setOpen(false);
				return;
			}
			setError(intl.formatMessage(desktopMessages.transcriptBackModelError));
		} catch {
			setError(intl.formatMessage(desktopMessages.transcriptBackRetryError));
		} finally {
			setPending(false);
		}
	};

	return (
		<>
			<Tooltip content={intl.formatMessage(desktopMessages.transcriptBackToHere)} side="top">
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					disabled={actionDisabled}
					aria-label={intl.formatMessage(desktopMessages.transcriptBackToHere)}
					title={intl.formatMessage(desktopMessages.transcriptBackToHere)}
					onClick={openDialog}
				>
					<CornerDownRightIcon size={15} strokeWidth={1.75} />
				</Button>
			</Tooltip>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{intl.formatMessage(desktopMessages.transcriptBackToMessage)}</DialogTitle>
						<DialogDescription>{intl.formatMessage(desktopMessages.transcriptBackDescription)}</DialogDescription>
					</DialogHeader>
					{error ? (
						<p className="text-[12px] leading-relaxed text-destructive" role="alert">
							{error}
						</p>
					) : null}
					<DialogFooter>
						<Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
							{intl.formatMessage(desktopMessages.commonCancel)}
						</Button>
						<Button type="button" loading={pending} onClick={() => void navigate()}>
							{intl.formatMessage(desktopMessages.transcriptBackToHere)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

function CompactionDivider({
	item,
}: {
	readonly item: Extract<DesktopTranscriptItem, { readonly kind: "compaction" }>;
}) {
	const intl = useIntl();
	const LoaderIcon = useIcon("loader");
	const compacting = item.status === "compacting";
	const label = intl.formatMessage(
		compacting ? desktopMessages.transcriptCompacting : desktopMessages.transcriptCompacted,
	);
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
	const intl = useIntl();
	const running = group.items.some(
		(item) =>
			(item.kind === "thinking" && item.status === "streaming") ||
			(item.kind === "narration" && item.status === "streaming") ||
			(item.kind === "tool" && item.status === "running"),
	);
	const steps = workTimelineSteps(group.items, intl);
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

	const label = workTimelineSummary(steps, group.items, running, intl);

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

export function workTimelineSteps(items: readonly WorkItem[], intl: IntlShape): TimelineStep[] {
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
				verb: intl.formatMessage(desktopMessages.transcriptThinking),
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
				verb: intl.formatMessage(running ? desktopMessages.transcriptWorking : desktopMessages.transcriptWorked),
				chip: narration,
				icon: "sparkles",
				active: running,
			};
		}

		const presentation = toolPresentation(tools[0]!, running, intl);
		const details = toolClusterDetails(cluster.narrations, tools, intl);
		return {
			id: cluster.id,
			verb: presentation.label,
			chip: toolClusterChip(tools, intl),
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

function toolClusterChip(items: readonly DesktopToolItem[], intl: IntlShape): string {
	if (items.length > 1) {
		const category = items[0]!.activityKind;
		if (category === "search") return intl.formatMessage(desktopMessages.transcriptSearches, { count: items.length });
		if (category === "read" || category === "write")
			return intl.formatMessage(desktopMessages.transcriptFiles, { count: items.length });
		if (category === "execute")
			return intl.formatMessage(desktopMessages.transcriptCommands, { count: items.length });
		if (category === "call") return intl.formatMessage(desktopMessages.transcriptCalls, { count: items.length });
		return intl.formatMessage(desktopMessages.transcriptActions, { count: items.length });
	}
	const tool = items[0]!;
	return tool.summary ?? humanizeToolName(tool.toolName);
}

function toolClusterDetails(
	narrations: readonly DesktopNarrationItem[],
	tools: readonly DesktopToolItem[],
	intl: IntlShape,
): string | undefined {
	const narration = narrations.map((item) => item.text).join("\n\n");
	const toolDetails = tools
		.map((item) => {
			const summary = toolClusterChip([item], intl);
			const changedFiles = item.fileChanges
				?.map((change) => `${fileChangeVerb(change.operation, intl)} ${change.path}`)
				.join("\n");
			const details = [item.details, changedFiles].filter(Boolean).join("\n");
			const body = details ? `\n${details}` : "";
			return `${humanizeToolName(item.toolName)} · ${summary}${body}`;
		})
		.join("\n\n");
	return [narration, toolDetails].filter(Boolean).join("\n\n") || undefined;
}

export function workTimelineSummary(
	steps: readonly TimelineStep[],
	items: readonly WorkItem[],
	running: boolean,
	intl: IntlShape,
): string {
	const operationCount = items.filter((item): item is DesktopToolItem => item.kind === "tool").length;
	const changedPaths = new Set(
		items
			.filter((item): item is DesktopToolItem => item.kind === "tool")
			.flatMap((item) => item.fileChanges ?? [])
			.map((change) => change.path),
	);
	const filesChanged =
		changedPaths.size > 0
			? changedPaths.size
			: new Set(
					items
						.filter((item): item is DesktopToolItem => item.kind === "tool" && item.activityKind === "write")
						.map((item) => item.summary)
						.filter((summary): summary is string => Boolean(summary)),
				).size;
	const stepLabel = intl.formatMessage(desktopMessages.transcriptStepSummary, { count: steps.length });
	if (running) return intl.formatMessage(desktopMessages.transcriptWorkingSummary, { steps: stepLabel });
	if (filesChanged > 0) {
		return intl.formatMessage(desktopMessages.transcriptFilesSummary, { steps: stepLabel, count: filesChanged });
	}
	return intl.formatMessage(desktopMessages.transcriptActionsSummary, { steps: stepLabel, count: operationCount });
}

function fileChangeVerb(operation: "add" | "modify" | "delete", intl: IntlShape): string {
	switch (operation) {
		case "add":
			return intl.formatMessage(desktopMessages.transcriptAdded);
		case "modify":
			return intl.formatMessage(desktopMessages.transcriptModified);
		case "delete":
			return intl.formatMessage(desktopMessages.transcriptDeleted);
	}
}

function toolPresentation(item: DesktopToolItem, running: boolean, intl: IntlShape): { icon: IconName; label: string } {
	const category = item.activityKind;
	if (category === "search") {
		return {
			icon: "search",
			label: intl.formatMessage(running ? desktopMessages.transcriptSearching : desktopMessages.transcriptSearched),
		};
	}
	if (category === "read") {
		return {
			icon: "file-code",
			label: intl.formatMessage(running ? desktopMessages.transcriptReading : desktopMessages.transcriptRead),
		};
	}
	if (category === "write") {
		return {
			icon: "file-code",
			label: intl.formatMessage(running ? desktopMessages.transcriptEditing : desktopMessages.transcriptEdited),
		};
	}
	if (category === "call") {
		return {
			icon: "link",
			label: intl.formatMessage(running ? desktopMessages.transcriptCalling : desktopMessages.transcriptCalled),
		};
	}
	// Generic operations do not pretend to be commands or remote service calls.
	return {
		icon: "terminal",
		label: intl.formatMessage(running ? desktopMessages.transcriptRunning : desktopMessages.transcriptRan),
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
	const intl = useIntl();
	return (
		<div className="space-y-4 py-6" role="status" aria-label={intl.formatMessage(desktopMessages.transcriptLoading)}>
			<div className="ml-auto h-12 w-56 animate-pulse rounded-[14px] bg-primary-2/8" />
			<div className="h-4 w-[72%] animate-pulse rounded bg-foreground/6" />
			<div className="h-4 w-[58%] animate-pulse rounded bg-foreground/5" />
		</div>
	);
}
