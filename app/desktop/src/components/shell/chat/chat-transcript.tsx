import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { cn } from "cn";
import {
	forwardRef,
	memo,
	type ReactNode,
	type RefObject,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { type IntlShape, useIntl } from "react-intl";
import { ThinkingOrb } from "thinking-orbs";
import { desktopMessages } from "@/i18n/messages";
import { filesForAttachments } from "@/lib/attachment-files";
import { useIcon } from "@/lib/icon-context";
import type {
	DesktopNarrationItem,
	DesktopSubagentItem,
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
import { SubagentAvatar } from "../subagent-avatar";
import { resolveToolTimelinePresentation } from "./tool-timeline-presentation";

type WorkItem = DesktopThinkingItem | DesktopNarrationItem | DesktopToolItem | DesktopSubagentItem;

export interface WorkGroup {
	readonly id: string;
	readonly items: readonly WorkItem[];
}

export type TranscriptRow = DesktopTranscriptItem | WorkGroup;

export interface TranscriptVirtualListHandle {
	getItemIndex(itemId: string): number;
	scrollToItem(itemId: string, behavior?: ScrollBehavior): boolean;
}

interface WorkTimelineCluster {
	readonly id: string;
	readonly kind: "thinking" | "narration" | "subagent" | DesktopToolActivityKind;
	readonly activityId: string;
	readonly items: readonly WorkItem[];
	readonly narrations: readonly DesktopNarrationItem[];
}

interface WorkTimelineOptions {
	readonly onOpenSubagent?: (item: DesktopSubagentItem) => void;
}

const MemoizedTranscriptItem = memo(TranscriptItem);
const MemoizedWorkProcess = memo(WorkProcess, sameWorkProcess);

export function TranscriptItems({
	items,
	loading,
	responding = false,
	openWorkGroups,
	workGroupKeyPrefix,
	navigationDisabled = false,
	onNavigate,
	onOpenSubagent,
}: {
	readonly items: readonly DesktopTranscriptItem[];
	readonly loading: boolean;
	readonly responding?: boolean;
	readonly openWorkGroups?: Set<string>;
	readonly workGroupKeyPrefix?: string;
	readonly navigationDisabled?: boolean;
	readonly onNavigate?: (entryId: string) => Promise<boolean>;
	readonly onOpenSubagent?: (item: DesktopSubagentItem) => void;
}) {
	const animatedItemIds = useTranscriptItemAnimations(items, loading);
	const rows = groupTranscriptItems(items);
	const renderOptions = {
		animatedItemIds,
		items,
		responding,
		openWorkGroups,
		workGroupKeyPrefix,
		navigationDisabled,
		onNavigate,
		onOpenSubagent,
	};

	return rows.map((row) => renderTranscriptRow(row, renderOptions));
}

export const TranscriptVirtualList = forwardRef<
	TranscriptVirtualListHandle,
	{
		readonly items: readonly DesktopTranscriptItem[];
		readonly loading: boolean;
		readonly responding?: boolean;
		readonly openWorkGroups?: Set<string>;
		readonly workGroupKeyPrefix?: string;
		readonly navigationDisabled?: boolean;
		readonly onNavigate?: (entryId: string) => Promise<boolean>;
		readonly onOpenSubagent?: (item: DesktopSubagentItem) => void;
		readonly scrollRef: RefObject<HTMLDivElement | null>;
		readonly tailSpace: number;
		readonly emptyState?: ReactNode;
		readonly onVisibleRowRangeChange?: (topRowIndex: number, bottomRowIndex: number) => void;
	}
>(
	(
		{
			items,
			loading,
			responding = false,
			openWorkGroups,
			workGroupKeyPrefix,
			navigationDisabled = false,
			onNavigate,
			onOpenSubagent,
			scrollRef,
			tailSpace,
			emptyState,
			onVisibleRowRangeChange,
		},
		ref,
	) => {
		const intl = useIntl();
		const animatedItemIds = useTranscriptItemAnimations(items, loading);
		const rows = groupTranscriptItems(items);
		const footerCount = Number(responding) + Number(tailSpace > 0);
		const count = rows.length + footerCount;
		const visibleRangeFrameRef = useRef<number | undefined>(undefined);
		const visibleRangeRef = useRef<{ top: number; bottom: number } | undefined>(undefined);
		const visibleRangeCallbackRef = useRef(onVisibleRowRangeChange);
		useLayoutEffect(() => {
			visibleRangeCallbackRef.current = onVisibleRowRangeChange;
		}, [onVisibleRowRangeChange]);
		const scheduleVisibleRowRange = (instance: Virtualizer<HTMLDivElement, HTMLDivElement>) => {
			if (visibleRangeFrameRef.current !== undefined) return;
			visibleRangeFrameRef.current = requestAnimationFrame(() => {
				visibleRangeFrameRef.current = undefined;
				const scrollElement = scrollRef.current;
				const callback = visibleRangeCallbackRef.current;
				if (!scrollElement || !callback) return;
				const viewportTop = scrollElement.scrollTop;
				const viewportBottom = viewportTop + scrollElement.clientHeight;
				let top = Number.POSITIVE_INFINITY;
				let bottom = Number.NEGATIVE_INFINITY;
				for (const item of instance.getVirtualItems()) {
					const rowStart = item.start + 16;
					const rowEnd = item.end + 16;
					if (item.index >= rows.length || rowEnd <= viewportTop || rowStart >= viewportBottom) continue;
					top = Math.min(top, item.index);
					bottom = Math.max(bottom, item.index);
				}
				if (!Number.isFinite(top) || !Number.isFinite(bottom)) return;
				const next = { top, bottom };
				const previous = visibleRangeRef.current;
				if (previous?.top === next.top && previous.bottom === next.bottom) return;
				visibleRangeRef.current = next;
				callback(next.top, next.bottom);
			});
		};
		const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
			count,
			getScrollElement: () => scrollRef.current,
			estimateSize: (index) => estimateTranscriptVirtualItemSize(index, rows.length, responding, tailSpace),
			getItemKey: (index) => transcriptVirtualItemKey(index, rows, responding),
			gap: 8,
			overscan: 5,
			onChange: scheduleVisibleRowRange,
		});
		useImperativeHandle(
			ref,
			() => ({
				getItemIndex: (itemId) => rows.findIndex((row) => transcriptRowContainsItem(row, itemId)),
				scrollToItem: (itemId, behavior = "auto") => {
					const index = rows.findIndex((row) => transcriptRowContainsItem(row, itemId));
					if (index < 0) return false;
					virtualizer.scrollToIndex(index, { align: "start", behavior });
					return true;
				},
			}),
			[rows, virtualizer],
		);
		const virtualItems = virtualizer.getVirtualItems();
		useEffect(() => {
			return () => {
				if (visibleRangeFrameRef.current !== undefined) cancelAnimationFrame(visibleRangeFrameRef.current);
			};
		}, []);
		const renderOptions = {
			animatedItemIds,
			items,
			responding,
			openWorkGroups,
			workGroupKeyPrefix,
			navigationDisabled,
			onNavigate,
			onOpenSubagent,
		};
		const hasEmptyState = rows.length === 0 && !responding && tailSpace <= 0 && emptyState !== undefined;
		const contentHeight = Math.max(virtualizer.getTotalSize() + 32, hasEmptyState ? 160 : 32);

		return (
			<div className="px-5">
				<div className="relative mx-auto w-full max-w-184" style={{ height: contentHeight }}>
					{hasEmptyState ? (
						<div className="py-16 text-center text-[13px] text-muted-foreground">{emptyState}</div>
					) : null}
					{virtualItems.map((virtualItem) => {
						const row = rows[virtualItem.index];
						const isWorkingFooter = virtualItem.index === rows.length && responding;
						const isTailFooter = virtualItem.index === rows.length + Number(responding);
						const rowStyle = {
							position: "absolute" as const,
							top: 0,
							left: 0,
							width: "100%",
							transform: `translateY(${virtualItem.start + 16}px)`,
						};
						const tailStyle = { height: tailSpace };
						const footerContent = isWorkingFooter ? (
							<div className="flex items-center gap-2 px-1 py-1 text-muted-foreground" role="status">
								<ThinkingOrb aria-hidden size={64} state="solving" style={{ width: 28, height: 28 }} />
								<span className="shimmer-text text-[12px] font-medium">
									{intl.formatMessage(desktopMessages.chatAgentWorking)}
								</span>
							</div>
						) : isTailFooter ? (
							<div aria-hidden="true" className="shrink-0" style={tailStyle} />
						) : null;
						const content = row ? renderTranscriptRow(row, renderOptions) : footerContent;

						return (
							<div
								key={virtualItem.key}
								ref={virtualizer.measureElement}
								data-index={virtualItem.index}
								className="absolute right-0 left-0"
								style={rowStyle}
							>
								{content}
							</div>
						);
					})}
				</div>
			</div>
		);
	},
);

TranscriptVirtualList.displayName = "TranscriptVirtualList";

export function groupTranscriptItems(items: readonly DesktopTranscriptItem[]): TranscriptRow[] {
	const rows: TranscriptRow[] = [];
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

function renderTranscriptRow(
	row: TranscriptRow,
	options: {
		readonly animatedItemIds: ReadonlySet<string>;
		readonly items: readonly DesktopTranscriptItem[];
		readonly responding: boolean;
		readonly openWorkGroups?: Set<string>;
		readonly workGroupKeyPrefix?: string;
		readonly navigationDisabled: boolean;
		readonly onNavigate?: (entryId: string) => Promise<boolean>;
		readonly onOpenSubagent?: (item: DesktopSubagentItem) => void;
	},
): ReactNode {
	if ("kind" in row) {
		return (
			<MemoizedTranscriptItem
				key={row.id}
				animate={options.animatedItemIds.has(row.id)}
				item={row}
				navigationDisabled={options.navigationDisabled}
				onNavigate={options.onNavigate}
			/>
		);
	}

	return (
		<MemoizedWorkProcess
			key={row.id}
			group={row}
			items={options.items}
			responding={options.responding}
			openWorkGroups={options.openWorkGroups}
			openStateKey={options.workGroupKeyPrefix ? `${options.workGroupKeyPrefix}:${row.id}` : undefined}
			onOpenSubagent={options.onOpenSubagent}
		/>
	);
}

function estimateTranscriptVirtualItemSize(
	index: number,
	rowCount: number,
	responding: boolean,
	tailSpace: number,
): number {
	if (index < rowCount) return 96;
	if (responding && index === rowCount) return 40;
	return Math.max(1, tailSpace);
}

function transcriptVirtualItemKey(index: number, rows: readonly TranscriptRow[], responding: boolean): string {
	if (index < rows.length) return rows[index]!.id;
	if (responding && index === rows.length) return "agent-working";
	return "tail-space";
}

function transcriptRowContainsItem(row: TranscriptRow, itemId: string): boolean {
	if (row.id === itemId) return true;
	return !("kind" in row) && row.items.at(-1)?.id === itemId;
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
	if (item.kind === "thinking" || item.kind === "narration" || item.kind === "tool" || item.kind === "subagent") {
		return <WorkProcess group={{ id: `work:${item.id}`, items: [item] }} items={[item]} />;
	}
	if (item.kind === "message") {
		if (item.role === "toolResult") return null;
		const user = item.role === "user";
		const messageAlignment = cn("flex py-1", {
			"min-h-7": !user && item.status === "streaming",
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
					size="icon"
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
		"text-brand": compacting,
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

	if (awaitingSnapshot.current && !loading && items.length > 0) {
		for (const item of items) seenItemIds.current.add(item.id);
		awaitingSnapshot.current = false;
	}

	const animatedItemIds = new Set(items.filter((item) => !seenItemIds.current.has(item.id)).map((item) => item.id));

	useLayoutEffect(() => {
		for (const item of items) seenItemIds.current.add(item.id);
	}, [items]);

	return animatedItemIds;
}

function WorkProcess({
	group,
	items,
	responding = false,
	openWorkGroups,
	openStateKey,
	onOpenSubagent,
}: {
	readonly group: WorkGroup;
	readonly items: readonly DesktopTranscriptItem[];
	readonly responding?: boolean;
	readonly openWorkGroups?: Set<string>;
	readonly openStateKey?: string;
	readonly onOpenSubagent?: (item: DesktopSubagentItem) => void;
}) {
	const intl = useIntl();
	const steps = workTimelineSteps(group.items, intl, { onOpenSubagent });
	const rememberedOpen = openStateKey !== undefined && openWorkGroups?.has(openStateKey);
	const clock = workRunClock(items, group.items, responding, Date.now());
	const [open, setOpen] = useState(clock.active || rememberedOpen === true);
	const [, setNow] = useState(Date.now);
	const wasActiveRef = useRef(clock.active);

	useLayoutEffect(() => {
		if (clock.active) {
			wasActiveRef.current = true;
			setOpen(true);
		} else if (wasActiveRef.current) {
			wasActiveRef.current = false;
			setOpen(false);
			if (openStateKey) openWorkGroups?.delete(openStateKey);
		}
	}, [clock.active, openStateKey, openWorkGroups]);

	useEffect(() => {
		if (!clock.active || clock.paused) return;
		setNow(Date.now());
		const interval = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(interval);
	}, [clock.active, clock.paused]);

	const anchorItem = group.items.at(-1);
	if (steps.length === 0) return null;

	const label = workTimelineSummary(items, group.items, responding, intl);
	const onOpenChange = (nextOpen: boolean) => {
		setOpen(nextOpen);
		if (openStateKey) {
			if (nextOpen) openWorkGroups?.add(openStateKey);
			else openWorkGroups?.delete(openStateKey);
		}
	};

	return (
		<div className="py-0.5" data-transcript-item-id={anchorItem?.id}>
			<ToolTimeline
				activeLabel={label}
				className="max-w-none"
				open={open}
				onOpenChange={onOpenChange}
				restingLabel={label}
				steps={steps}
				streaming={clock.active}
			/>
			{!clock.active && <div className="h-px w-full bg-border" />}
		</div>
	);
}

// `onOpenSubagent` is deliberately not compared: it only forwards to shell
// state setters, so a stale closure behaves identically and the memo stays hot.
function sameWorkProcess(
	previous: {
		readonly group: WorkGroup;
		readonly items: readonly DesktopTranscriptItem[];
		readonly responding?: boolean;
		readonly openWorkGroups?: Set<string>;
		readonly openStateKey?: string;
	},
	next: {
		readonly group: WorkGroup;
		readonly items: readonly DesktopTranscriptItem[];
		readonly responding?: boolean;
		readonly openWorkGroups?: Set<string>;
		readonly openStateKey?: string;
	},
): boolean {
	if (previous.responding !== next.responding || previous.openStateKey !== next.openStateKey) return false;
	if (previous.openWorkGroups !== next.openWorkGroups) return false;
	if (previous.group.id !== next.group.id || previous.group.items.length !== next.group.items.length) return false;
	if (previous.items !== next.items) return false;
	return previous.group.items.every((item, index) => item === next.group.items[index]);
}

function isWorkItemRunning(item: WorkItem): boolean {
	if (item.kind === "thinking" || item.kind === "narration") return item.status === "streaming";
	return item.status === "running";
}

export function workTimelineSteps(
	items: readonly WorkItem[],
	intl: IntlShape,
	options: WorkTimelineOptions = {},
): TimelineStep[] {
	return workTimelineClusters(items).map((cluster) => {
		const running = cluster.items.some(isWorkItemRunning);
		if (cluster.kind === "subagent") {
			const item = cluster.items[0] as DesktopSubagentItem;
			const summary = running
				? item.activityTitle
				: item.status === "error"
					? intl.formatMessage(desktopMessages.subagentFailed)
					: undefined;
			return {
				id: cluster.id,
				title: item.title,
				...(summary ? { summary } : {}),
				icon: "users",
				density: "compact",
				avatar: <SubagentAvatar item={item} size={20} />,
				active: running,
				...(options.onOpenSubagent ? { onSelect: () => options.onOpenSubagent?.(item) } : {}),
			};
		}
		if (cluster.kind === "thinking") {
			const text = cluster.items
				.filter((item): item is DesktopThinkingItem => item.kind === "thinking")
				.map((item) => item.text)
				.join("\n\n");
			return {
				id: cluster.id,
				title: intl.formatMessage(desktopMessages.transcriptThinking),
				summary: text,
				icon: "sparkles",
				density: "compact",
				active: running,
				...(text.length > 160 ? { details: text } : {}),
			};
		}

		const tools = cluster.items.filter((item): item is DesktopToolItem => item.kind === "tool");
		if (tools.length === 0) {
			const narration = cluster.narrations.map((item) => item.text).join("\n\n");
			return {
				id: cluster.id,
				title: intl.formatMessage(running ? desktopMessages.transcriptWorking : desktopMessages.transcriptWorked),
				summary: narration,
				icon: "sparkles",
				density: "compact",
				active: running,
			};
		}

		const presentation = resolveToolTimelinePresentation(cluster.narrations, tools, running, intl);
		return {
			id: cluster.id,
			title: presentation.title,
			...(presentation.summary ? { summary: presentation.summary } : {}),
			icon: presentation.icon,
			density: presentation.density,
			active: running,
			...(presentation.details ? { details: presentation.details } : {}),
			...(presentation.webSearchResults ? { webSearchResults: presentation.webSearchResults } : {}),
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

		const kind = item.kind === "thinking" || item.kind === "subagent" ? item.kind : item.activityKind;
		// Each delegated task is its own row; tools of the same activity collapse into one.
		const activityId = item.kind === "subagent" ? item.id : item.activityId;
		const previous = clusters.at(-1);
		if (previous && previous.kind === kind && previous.activityId === activityId) {
			clusters[clusters.length - 1] = {
				...previous,
				items: [...previous.items, item],
				narrations: [...previous.narrations, ...pendingNarrations],
			};
		} else {
			clusters.push({
				id: `timeline:${item.id}`,
				kind,
				activityId,
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

export function workTimelineSummary(
	items: readonly DesktopTranscriptItem[],
	workItems: readonly WorkItem[],
	responding: boolean,
	intl: IntlShape,
	now = Date.now(),
): string {
	const clock = workRunClock(items, workItems, responding, now);
	if (clock.durationMs === 0) {
		return intl.formatMessage(clock.active ? desktopMessages.transcriptWorking : desktopMessages.transcriptWorked);
	}
	return intl.formatMessage(
		clock.active ? desktopMessages.transcriptWorkingDuration : desktopMessages.transcriptWorkedDuration,
		{ duration: formatWorkDuration(clock.durationMs, intl) },
	);
}

function workRunClock(
	items: readonly DesktopTranscriptItem[],
	workItems: readonly WorkItem[],
	responding: boolean,
	now: number,
): { active: boolean; paused: boolean; durationMs: number; start?: number } {
	const firstWorkId = workItems[0]?.id;
	let turnStart: number | undefined;
	let startIndex = 0;
	for (let index = 0; index < items.length; index++) {
		const item = items[index]!;
		if (item.kind === "message" && item.role === "user") {
			turnStart = item.timestamp;
			startIndex = index;
		}
		if (item.id === firstWorkId) break;
		if (
			turnStart === undefined &&
			item.kind === "message" &&
			item.role === "assistant" &&
			item.status === "complete"
		) {
			turnStart = item.timestamp;
		}
	}

	let paused = false;
	let assistantAfterWorkAt: number | undefined;
	const permissionWindows: Array<{ requestedAt: number; resolvedAt?: number }> = [];
	let sawNextUser = false;
	let sawWork = false;
	for (let index = startIndex; index < items.length; index++) {
		const item = items[index]!;
		if (index > startIndex && item.kind === "message" && item.role === "user") {
			sawNextUser = true;
			break;
		}
		if (item.id === firstWorkId) sawWork = true;
		if (item.kind === "permission") {
			if (item.resolvedAt === undefined) paused = true;
			permissionWindows.push({ requestedAt: item.requestedAt, resolvedAt: item.resolvedAt });
		}
		if (sawWork && item.kind === "message" && item.role === "assistant" && item.status === "complete") {
			assistantAfterWorkAt = item.timestamp;
		}
	}

	let workStart: number | undefined;
	let workEnd: number | undefined;
	for (const item of workItems) {
		if (item.kind === "tool" || item.kind === "subagent") {
			if (item.startedAt !== undefined) workStart = Math.min(workStart ?? item.startedAt, item.startedAt);
			if (item.completedAt !== undefined) {
				workEnd = Math.max(workEnd ?? item.completedAt, item.completedAt);
			}
			continue;
		}
		workStart = Math.min(workStart ?? item.timestamp, item.timestamp);
		workEnd = Math.max(workEnd ?? item.timestamp, item.timestamp);
	}

	const active =
		workItems.some(isWorkItemRunning) ||
		paused ||
		(responding && isLatestWorkGroup(items, workItems) && !sawNextUser);
	const start = resolveWorkStart(turnStart, workStart, workEnd);
	if (start === undefined || (!active && assistantAfterWorkAt === undefined && workEnd === undefined)) {
		return { active, paused, durationMs: 0 };
	}
	const end = active ? now : (resolveWorkEnd(assistantAfterWorkAt, workEnd) ?? start);
	const pauseMs = permissionWindows.reduce(
		(total, permission) => total + pauseOverlapMs(permission, start, end, now),
		0,
	);
	return { active, paused, durationMs: Math.max(0, end - start - pauseMs), start };
}

function resolveWorkStart(
	turnStart: number | undefined,
	workStart: number | undefined,
	workEnd: number | undefined,
): number | undefined {
	if (turnStart === undefined) return workStart;
	if (workStart === undefined) return turnStart;
	if (workStart < turnStart && workEnd !== undefined && workEnd >= turnStart) return turnStart;
	return clockConsistentWithWork(turnStart, workStart) ? turnStart : workStart;
}

function resolveWorkEnd(messageEnd: number | undefined, workEnd: number | undefined): number | undefined {
	if (messageEnd === undefined) return workEnd;
	if (workEnd === undefined) return messageEnd;
	if (workEnd > messageEnd) return messageEnd;
	return clockConsistentWithWork(messageEnd, workEnd) ? messageEnd : workEnd;
}

function clockConsistentWithWork(messageTime: number | undefined, workTime: number | undefined): boolean {
	if (messageTime === undefined || workTime === undefined) return messageTime !== undefined;
	return Math.abs(messageTime - workTime) < 5 * 60_000;
}

function isLatestWorkGroup(items: readonly DesktopTranscriptItem[], workItems: readonly WorkItem[]): boolean {
	const lastWorkId = workItems.at(-1)?.id;
	if (!lastWorkId) return false;
	const lastWorkIndex = items.findIndex((item) => item.id === lastWorkId);
	if (lastWorkIndex < 0) return false;
	for (const item of items.slice(lastWorkIndex + 1)) {
		if (item.kind === "permission") continue;
		if (item.kind === "message" && item.role === "toolResult") continue;
		return false;
	}
	return true;
}

function pauseOverlapMs(
	permission: { requestedAt: number; resolvedAt?: number },
	start: number,
	end: number,
	now: number,
): number {
	const pauseStart = Math.max(start, permission.requestedAt);
	const pauseEnd = Math.min(end, permission.resolvedAt ?? now);
	return Math.max(0, pauseEnd - pauseStart);
}

export function formatWorkDuration(milliseconds: number, intl: IntlShape): string {
	const duration = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
	if (duration < 10_000) {
		return intl.formatNumber(Math.max(1, Math.round(duration / 1_000)), {
			style: "unit",
			unit: "second",
			unitDisplay: "narrow",
		});
	}
	const totalSeconds = Math.round(duration / 1_000);
	const hours = Math.floor(totalSeconds / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) {
		const parts = [intl.formatNumber(hours, { style: "unit", unit: "hour", unitDisplay: "narrow" })];
		if (minutes > 0) {
			parts.push(intl.formatNumber(minutes, { style: "unit", unit: "minute", unitDisplay: "narrow" }));
		}
		if (seconds > 0) {
			parts.push(intl.formatNumber(seconds, { style: "unit", unit: "second", unitDisplay: "narrow" }));
		}
		return parts.join(" ");
	}
	if (minutes === 0) {
		return intl.formatNumber(seconds, { style: "unit", unit: "second", unitDisplay: "narrow" });
	}
	if (seconds === 0) {
		return intl.formatNumber(minutes, { style: "unit", unit: "minute", unitDisplay: "narrow" });
	}
	return [
		intl.formatNumber(minutes, { style: "unit", unit: "minute", unitDisplay: "narrow" }),
		intl.formatNumber(seconds, { style: "unit", unit: "second", unitDisplay: "narrow" }),
	].join(" ");
}

function isWorkItem(item: DesktopTranscriptItem): item is WorkItem {
	return item.kind === "thinking" || item.kind === "narration" || item.kind === "tool" || item.kind === "subagent";
}

function workItemTurnId(item: WorkItem): string {
	return item.turnId;
}
