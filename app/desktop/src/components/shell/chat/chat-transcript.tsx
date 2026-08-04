import { memo } from "react";
import type { IconName } from "@/lib/icon-context";
import type {
	DesktopMessageItem,
	DesktopProgressItem,
	DesktopThinkingItem,
	DesktopToolItem,
	DesktopTranscriptItem,
} from "../../../../shared/desktop-rpc";
import { ChatMessage } from "../../ui/chat-message";
import { ThinkingStep, ThinkingSteps, ThinkingStepsContent, ThinkingStepsHeader } from "../../ui/thinking-steps";
import { ToolCall } from "../../ui/tool-call";

type ConnectorItem = DesktopMessageItem & { readonly role: "assistant"; readonly stopReason: "toolUse" };
type WorkItem = DesktopThinkingItem | DesktopProgressItem | DesktopToolItem | ConnectorItem;

interface WorkGroup {
	readonly id: string;
	readonly items: readonly WorkItem[];
}

const MemoizedTranscriptItem = memo(TranscriptItem);
const MemoizedWorkProcess = memo(WorkProcess, sameWorkGroup);

export function TranscriptItems({ items }: { items: readonly DesktopTranscriptItem[] }) {
	const rows: (DesktopTranscriptItem | WorkGroup)[] = [];
	let activeGroup: WorkItem[] = [];

	const commitGroup = () => {
		if (activeGroup.length === 0) return;
		rows.push({ id: `work:${activeGroup[0].id}`, items: activeGroup });
		activeGroup = [];
	};

	for (const item of items) {
		if (item.kind === "message" && item.role === "toolResult") continue;
		if (item.kind === "permission") continue;
		if (item.kind === "progress") {
			while (
				activeGroup.at(-1)?.kind === "thinking" ||
				(activeGroup.at(-1)?.kind === "message" && isConnectorItem(activeGroup.at(-1)!))
			) {
				activeGroup.pop();
			}
			commitGroup();
			activeGroup.push(item);
			continue;
		}
		if (item.kind === "thinking" || item.kind === "tool") {
			activeGroup.push(item);
			continue;
		}
		if (isConnectorItem(item)) {
			if (!activeGroup.some((entry) => entry.kind === "thinking")) activeGroup.push(item);
			continue;
		}
		commitGroup();
		rows.push(item);
	}
	commitGroup();

	return rows.map((row) =>
		"kind" in row ? (
			<MemoizedTranscriptItem key={row.id} item={row} />
		) : (
			<MemoizedWorkProcess key={row.id} group={row} />
		),
	);
}

export function TranscriptItem({ item }: { item: DesktopTranscriptItem }) {
	if (item.kind === "thinking" || item.kind === "progress") {
		return <WorkProcess group={{ id: `work:${item.id}`, items: [item] }} />;
	}
	if (item.kind === "message") {
		if (item.role === "toolResult") return null;
		const user = item.role === "user";
		return (
			<div className={`flex py-1 ${user ? "justify-end" : "justify-start"}`}>
				<ChatMessage
					className={user ? "max-w-[78%]" : "max-w-full"}
					from={user ? "user" : "assistant"}
					isStreaming={item.status === "streaming"}
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

function WorkProcess({ group }: { readonly group: WorkGroup }) {
	const progress = group.items.find((item): item is DesktopProgressItem => item.kind === "progress");
	const visibleItems = progress ? group.items.filter((item) => item.kind === "tool") : group.items;
	const running = group.items.some(
		(item) =>
			(item.kind === "thinking" && item.status === "streaming") ||
			(item.kind === "message" && item.status === "streaming") ||
			(item.kind === "tool" && item.status === "running"),
	);

	return (
		<ThinkingSteps className="w-full py-1" defaultOpen={running}>
			<ThinkingStepsHeader>
				{progress?.title ??
					(running ? "Working…" : `${group.items.length} ${group.items.length === 1 ? "step" : "steps"}`)}
			</ThinkingStepsHeader>
			<ThinkingStepsContent>
				{progress ? (
					<p className="px-2 pb-2 text-[13px] leading-relaxed text-muted-foreground">{progress.detail}</p>
				) : null}
				{visibleItems.map((item) => (
					<WorkProcessStep key={item.id} item={item} />
				))}
			</ThinkingStepsContent>
		</ThinkingSteps>
	);
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
	const normalizedName = item.toolName.toLowerCase();
	const failed = item.status === "error";
	if (normalizedName.includes("search") || normalizedName === "grep" || normalizedName === "glob") {
		return {
			icon: "search",
			label: failed ? "Search failed" : item.status === "running" ? "Searching" : "Searched",
		};
	}
	if (normalizedName.includes("read")) {
		return { icon: "file-code", label: failed ? "Read failed" : item.status === "running" ? "Reading" : "Read" };
	}
	if (normalizedName.includes("write") || normalizedName.includes("edit")) {
		return {
			icon: "file-code",
			label: failed ? "Update failed" : item.status === "running" ? "Updating" : "Updated",
		};
	}
	return {
		icon: "terminal",
		label: failed ? `${item.toolName} failed` : item.toolName,
	};
}

function isConnectorItem(item: DesktopTranscriptItem): item is ConnectorItem {
	return item.kind === "message" && item.role === "assistant" && item.stopReason === "toolUse";
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
