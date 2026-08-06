import { memo, useLayoutEffect, useRef } from "react";
import type { IconName } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type {
	DesktopMessageItem,
	DesktopProgressItem,
	DesktopThinkingItem,
	DesktopToolItem,
	DesktopTranscriptItem,
} from "../../../../shared/desktop-rpc";
import { ChatMessage } from "../../ui/chat-message";
import { ThinkingStep } from "../../ui/thinking-steps";
import { ToolCall } from "../../ui/tool-call";
import { SubagentCard } from "./subagent-card";

type ConnectorItem = DesktopMessageItem & { readonly role: "assistant"; readonly stopReason: "toolUse" };
type WorkItem = DesktopThinkingItem | DesktopProgressItem | DesktopToolItem | ConnectorItem;

interface WorkGroup {
	readonly id: string;
	readonly items: readonly WorkItem[];
}

type WorkProcessRow =
	| { readonly kind: "exploration"; readonly id: string; readonly items: readonly DesktopToolItem[] }
	| { readonly kind: "item"; readonly item: WorkItem };

type ToolCategory = "search" | "read" | "update" | "command" | "skill" | "other";

const MemoizedTranscriptItem = memo(TranscriptItem);
const MemoizedWorkProcess = memo(WorkProcess, sameWorkGroup);

export function TranscriptItems({ items, loading }: { items: readonly DesktopTranscriptItem[]; loading: boolean }) {
	const animatedItemIds = useTranscriptItemAnimations(items, loading);
	const rows = groupTranscriptItems(items);

	return rows.map((row) =>
		"kind" in row ? (
			<MemoizedTranscriptItem key={row.id} animate={animatedItemIds.has(row.id)} item={row} />
		) : (
			<MemoizedWorkProcess key={row.id} group={row} />
		),
	);
}

export function groupTranscriptItems(items: readonly DesktopTranscriptItem[]): (DesktopTranscriptItem | WorkGroup)[] {
	const rows: (DesktopTranscriptItem | WorkGroup)[] = [];
	const workByTurn = new Map<string, WorkItem[]>();
	const emittedTurns = new Set<string>();

	for (const item of items) {
		if (!isWorkItem(item)) continue;
		const turnId = workItemTurnId(item);
		const workItems = workByTurn.get(turnId) ?? [];
		workItems.push(item);
		workByTurn.set(turnId, workItems);
	}

	for (const item of items) {
		if (item.kind === "message" && item.role === "toolResult") continue;
		if (item.kind === "permission") continue;
		if (isWorkItem(item)) {
			const turnId = workItemTurnId(item);
			if (!emittedTurns.has(turnId)) {
				rows.push({ id: `work:${turnId}`, items: workByTurn.get(turnId) ?? [item] });
				emittedTurns.add(turnId);
			}
			continue;
		}
		rows.push(item);
	}
	return rows;
}

export function TranscriptItem({ item, animate = false }: { item: DesktopTranscriptItem; animate?: boolean }) {
	if (item.kind === "thinking" || item.kind === "progress") {
		return <WorkProcess group={{ id: `work:${item.id}`, items: [item] }} />;
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
		return (
			<div className={messageAlignment} data-transcript-item-id={item.id}>
				<ChatMessage animate={animate} className={messageClassName} from={from} isStreaming={isStreaming}>
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

	if (item.kind === "permission") {
		return null;
	}

	return (
		<div className="flex items-center gap-3 py-2 text-[11.5px] text-muted-foreground">
			<span className="h-px flex-1 bg-border" />
			Context compacted
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

function WorkProcess({ group }: { readonly group: WorkGroup }) {
	const progress = group.items.find((item): item is DesktopProgressItem => item.kind === "progress");
	const tools = group.items.filter((item): item is DesktopToolItem => item.kind === "tool");
	if (!progress && tools.length === 0) {
		return (
			<div className="flex flex-col px-1 py-1">
				{group.items.map((item) => (
					<WorkProcessStep key={item.id} item={item} />
				))}
			</div>
		);
	}
	const running = group.items.some(
		(item) =>
			(item.kind === "thinking" && item.status === "streaming") ||
			(item.kind === "message" && item.status === "streaming") ||
			(item.kind === "tool" && item.status === "running"),
	);
	const title = workGroupTitle(group.items, running);
	const rows = workProcessRows(tools);

	return (
		<div className="w-full">
			<div className="px-1 py-1.5 text-[13px] font-medium text-muted-foreground">{title}</div>
			<div className="flex flex-col gap-1 px-1 pb-2 pt-1">
				{rows.map((row) =>
					row.kind === "exploration" ? (
						<ExplorationStep key={row.id} items={row.items} />
					) : (
						<WorkProcessStep key={row.item.id} item={row.item} />
					),
				)}
			</div>
		</div>
	);
}

export function workGroupTitle(items: readonly WorkItem[], running: boolean): string {
	const progress = items.find((item): item is DesktopProgressItem => item.kind === "progress");
	if (progress) return progress.title;

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
	return running ? "Planning…" : "Planning";
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

function sameWorkGroup(previous: { readonly group: WorkGroup }, next: { readonly group: WorkGroup }): boolean {
	if (previous.group.id !== next.group.id || previous.group.items.length !== next.group.items.length) return false;
	return previous.group.items.every((item, index) => item === next.group.items[index]);
}

function WorkProcessStep({ item }: { readonly item: WorkItem }) {
	if (item.kind === "progress") return null;
	if (item.kind === "tool") return <ToolStep item={item} />;
	if (item.kind === "thinking") {
		return (
			<ThinkingStep icon="clock" label="Reasoning" status={item.status === "streaming" ? "active" : "complete"}>
				<p className="max-h-48 overflow-y-auto pt-1 text-[12px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
					{item.text}
				</p>
			</ThinkingStep>
		);
	}
	return (
		<ThinkingStep
			icon="clock"
			label="Planning"
			description={item.text}
			status={item.status === "streaming" ? "active" : "complete"}
		/>
	);
}

function ExplorationStep({ items }: { readonly items: readonly DesktopToolItem[] }) {
	const running = items.some((item) => item.status === "running");
	const failed = items.some((item) => item.status === "error");
	const label = explorationSummary(items, running, failed);
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

export function explorationSummary(items: readonly DesktopToolItem[], running: boolean, failed: boolean): string {
	if (running) return "Exploring";
	if (failed) return "Exploration failed";
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
			variant={toolCategory(item.toolName) === "command" ? "card" : "plain"}
		/>
	);
}

function toolPresentation(item: DesktopToolItem): { icon: IconName; label: string } {
	const failed = item.status === "error";
	const category = toolCategory(item.toolName);
	if (category === "search") {
		return {
			icon: "search",
			label: failed ? "Search failed" : item.status === "running" ? "Searching code" : "Searched code",
		};
	}
	if (category === "read") {
		return {
			icon: "file-code",
			label: failed ? "Read failed" : item.status === "running" ? "Reading files" : "Read files",
		};
	}
	if (category === "update") {
		return {
			icon: "file-code",
			label: failed ? "Update failed" : item.status === "running" ? "Updating files" : "Updated files",
		};
	}
	if (category === "command") {
		return {
			icon: "terminal",
			label: failed ? "Command failed" : item.status === "running" ? "Running command" : "Ran command",
		};
	}
	return {
		icon: "terminal",
		label: failed ? "Work failed" : item.status === "running" ? "Working" : "Completed work",
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

function isConnectorItem(item: DesktopTranscriptItem): item is ConnectorItem {
	return item.kind === "message" && item.role === "assistant" && item.stopReason === "toolUse";
}

function isWorkItem(item: DesktopTranscriptItem): item is WorkItem {
	return item.kind === "thinking" || item.kind === "progress" || item.kind === "tool" || isConnectorItem(item);
}

function workItemTurnId(item: WorkItem): string {
	return item.kind === "message" ? item.id : item.turnId;
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
