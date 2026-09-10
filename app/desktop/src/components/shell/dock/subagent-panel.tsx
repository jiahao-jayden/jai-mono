import { cn } from "cn";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { desktop } from "@/lib/desktop";
import type {
	DesktopSubagentItem,
	DesktopSubagentTranscript,
	DesktopTranscriptItem,
} from "../../../../shared/desktop-rpc";
import { NextStep } from "../../ui/next-step";
import { TranscriptItems } from "../chat/chat-transcript";
import { SubagentAvatar } from "../subagent-avatar";

export function SubagentPanel({
	items,
	onOpenHistory,
}: {
	readonly items: readonly DesktopSubagentItem[];
	readonly onOpenHistory?: (item: DesktopSubagentItem) => void;
}) {
	const intl = useIntl();
	const active = items.filter((item) => item.status === "running");
	const settled = items.filter((item) => item.status !== "running");

	return (
		<section
			id="dock-subagent-panel"
			aria-label={intl.formatMessage(desktopMessages.dockSubagentPanel)}
			className="flex h-full min-w-0 flex-col gap-4 overflow-y-auto px-3 pb-3"
		>
			<SubagentGroup
				label={intl.formatMessage(desktopMessages.subagentActive)}
				items={active}
				onOpenHistory={onOpenHistory}
			>
				<p className="px-1 text-[13px] text-muted-foreground">
					{intl.formatMessage(desktopMessages.subagentPanelEmpty)}
				</p>
			</SubagentGroup>
			{settled.length > 0 ? (
				<SubagentGroup
					label={intl.formatMessage(desktopMessages.subagentComplete)}
					items={settled}
					onOpenHistory={onOpenHistory}
				/>
			) : null}
		</section>
	);
}

function SubagentGroup({
	label,
	items,
	onOpenHistory,
	children,
}: {
	readonly label: string;
	readonly items: readonly DesktopSubagentItem[];
	readonly onOpenHistory?: (item: DesktopSubagentItem) => void;
	readonly children?: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-1.5">
			<h2 className="flex h-6 items-center gap-1.5 px-1 text-[12px] font-medium text-muted-foreground">
				{label}
				<span aria-hidden="true">·</span>
				<span className="tabular-nums">{items.length}</span>
			</h2>
			{items.length === 0 ? children : null}
			{items.length > 0 ? (
				<ul className="flex flex-col gap-0.5" aria-label={label}>
					{items.map((item) => (
						<SubagentRow key={item.id} item={item} onOpenHistory={onOpenHistory} />
					))}
				</ul>
			) : null}
		</section>
	);
}

function SubagentRow({
	item,
	onOpenHistory,
}: {
	readonly item: DesktopSubagentItem;
	readonly onOpenHistory?: (item: DesktopSubagentItem) => void;
}) {
	const intl = useIntl();
	const ref = useRef<HTMLLIElement>(null);
	const running = item.status === "running";
	const complete = item.status === "complete";
	const statusLabel = intl.formatMessage(
		running
			? desktopMessages.subagentRunning
			: complete
				? desktopMessages.subagentDone
				: desktopMessages.subagentFailed,
	);
	const fallbackActivity = intl.formatMessage(
		running
			? desktopMessages.subagentPreparing
			: complete
				? desktopMessages.subagentCompleted
				: desktopMessages.subagentStopped,
	);
	const rowClassName = cn(
		"flex min-w-0 flex-col gap-1 rounded-lg px-2 py-2 transition-colors duration-150",
		onOpenHistory && "cursor-pointer hover:bg-muted-hover",
	);
	const activityClassName = cn(
		"max-w-full text-[12px] leading-4 text-muted-foreground",
		running && "shimmer-text",
		item.status === "error" && "text-destructive",
	);

	return (
		<li
			ref={ref}
			className={rowClassName}
			aria-label={intl.formatMessage(desktopMessages.subagentAria, { title: item.title, status: statusLabel })}
			onClick={onOpenHistory ? () => onOpenHistory(item) : undefined}
			onKeyDown={
				onOpenHistory
					? (event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								onOpenHistory(item);
							}
						}
					: undefined
			}
			role={onOpenHistory ? "button" : undefined}
			tabIndex={onOpenHistory ? 0 : undefined}
		>
			<div className="flex min-w-0 items-center gap-2.5">
				<SubagentAvatar item={item} size={28} />
				<p className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-foreground" title={item.title}>
					{item.title}
				</p>
			</div>
			<NextStep value={item.activityTitle ?? fallbackActivity} className={cn(activityClassName, "pl-7.5")} />
		</li>
	);
}

const HISTORY_REFRESH_DELAY_MS = 150;

/** 只读 subagent transcript 面板；先加载 child journal，并在 journal 追加时刷新。 */
export function SubagentHistoryPanel({
	sessionId,
	toolCallId,
	title,
}: {
	readonly sessionId: string;
	readonly toolCallId: string;
	readonly title: string;
}) {
	const intl = useIntl();
	const [transcript, setTranscript] = useState<DesktopSubagentTranscript | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		let loading = false;
		let pending = false;
		let scheduled: ReturnType<typeof setTimeout> | undefined;
		setTranscript(null);
		setError(null);

		const refresh = async () => {
			if (loading) {
				pending = true;
				return;
			}
			loading = true;
			setError(null);
			try {
				const result = await desktop.agent.getSubagentTranscript({ sessionId, toolCallId });
				if (!cancelled) setTranscript(result);
			} catch (err) {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			} finally {
				loading = false;
				if (pending && !cancelled) {
					pending = false;
					void refresh();
				}
			}
		};
		// Child journals grow one entry at a time and the parent card emits activity
		// updates alongside; a short window folds each burst into a single refetch.
		const scheduleRefresh = () => {
			if (scheduled !== undefined) return;
			scheduled = setTimeout(() => {
				scheduled = undefined;
				if (!cancelled) void refresh();
			}, HISTORY_REFRESH_DELAY_MS);
		};
		const unsubscribe = window.desktopRpc.onAgentEvent((envelope) => {
			if (
				envelope.sessionId === sessionId &&
				((envelope.event.type === "subagent_transcript_changed" && envelope.event.toolCallId === toolCallId) ||
					(envelope.event.type === "transcript_upsert" &&
						envelope.event.item.kind === "subagent" &&
						envelope.event.item.toolCallId === toolCallId))
			) {
				scheduleRefresh();
			}
		});
		void refresh();
		return () => {
			cancelled = true;
			if (scheduled !== undefined) clearTimeout(scheduled);
			unsubscribe();
		};
	}, [sessionId, toolCallId]);

	const items = transcript?.items ?? [];
	const loading = transcript === null && error === null;

	return (
		<section
			id="dock-subagent-history"
			aria-label={intl.formatMessage(desktopMessages.dockSubagentPanel)}
			className="flex h-full min-w-0 flex-col overflow-hidden"
		>
			<div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-surface px-3">
				<p className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground" title={title}>
					{title}
				</p>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{loading ? (
					<p className="px-3 py-4 text-[13px] text-muted-foreground">
						{intl.formatMessage(desktopMessages.subagentHistoryLoading)}
					</p>
				) : error ? (
					<p className="px-3 py-4 text-[13px] text-destructive">{error}</p>
				) : items.length === 0 ? (
					<p className="px-3 py-4 text-[13px] text-muted-foreground">
						{intl.formatMessage(desktopMessages.subagentHistoryEmpty)}
					</p>
				) : (
					<TranscriptItems items={items as readonly DesktopTranscriptItem[]} loading={loading} />
				)}
			</div>
		</section>
	);
}
