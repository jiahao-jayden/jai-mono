import type { KeyboardEvent } from "react";
import { useTrajectory } from "./use-trajectory";
import type { TrajectoryDataSource } from "./source";
import type { TrajectoryItem } from "./wire";

export interface TrajectoryViewProps {
	readonly source: TrajectoryDataSource;
	readonly sessionId: string;
	readonly className?: string;
}

export function TrajectoryView({ source, sessionId, className }: TrajectoryViewProps) {
	const [state, dispatch] = useTrajectory(source, sessionId);
	const selected = state.items.find((item) => item.id === state.selectedItemId);
	const rootClassName = className ? `jai-trajectory ${className}` : "jai-trajectory";
	return (
		<section className={rootClassName} aria-label="Trajectory">
			<header className="jai-trajectory__header">
				<div>
					<h1>{state.snapshot?.session.title ?? "Session trajectory"}</h1>
					<p className="jai-trajectory__path">{state.snapshot?.session.cwd ?? "Loading Session…"}</p>
				</div>
				<Status phase={state.phase} />
			</header>
			{state.phase === "loading" && <Loading />}
			{state.phase === "error" && state.error && <Notice tone="error" message={state.error.message} />}
			{state.phase === "cursor_expired" && <Notice tone="warning" message="The live cursor expired. The next connection will begin from a fresh snapshot." />}
			{state.phase === "reconnecting" && <Notice tone="quiet" message="Connection interrupted. Reconnecting from the latest durable cursor…" />}
			{state.phase !== "loading" && state.phase !== "error" && state.items.length === 0 && <Empty />}
			{state.items.length > 0 && (
				<div className="jai-trajectory__content">
					<ol className="jai-trajectory__timeline" aria-label="Trajectory records">
						{state.items.map((item) => (
							<li key={item.id}>
								<Record item={item} selected={item.id === state.selectedItemId} onSelect={() => dispatch({ type: "select", itemId: item.id })} />
							</li>
						))}
					</ol>
					{selected && <Detail item={selected} onClose={() => dispatch({ type: "select" })} />}
				</div>
			)}
		</section>
	);
}

function Status({ phase }: { readonly phase: ReturnType<typeof useTrajectory>[0]["phase"] }) {
	const label = phase === "ready" ? "Live" : phase === "reconnecting" ? "Reconnecting" : phase === "loading" ? "Loading" : "Attention needed";
	return <p className={`jai-trajectory__status jai-trajectory__status--${phase}`} aria-live="polite">{label}</p>;
}

function Loading() {
	return <div className="jai-trajectory__loading" aria-live="polite"><span /><span /><span /></div>;
}

function Notice({ tone, message }: { readonly tone: "error" | "warning" | "quiet"; readonly message: string }) {
	return <p className={`jai-trajectory__notice jai-trajectory__notice--${tone}`} role={tone === "error" ? "alert" : "status"}>{message}</p>;
}

function Empty() {
	return <div className="jai-trajectory__empty"><h2>Nothing has run yet</h2><p>When this Session begins work, its durable milestones and live output will appear here.</p></div>;
}

function Record({ item, selected, onSelect }: { readonly item: TrajectoryItem; readonly selected: boolean; readonly onSelect: () => void }) {
	const label = recordLabel(item);
	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		const records = [...(event.currentTarget.closest("ol")?.querySelectorAll<HTMLButtonElement>(".jai-trajectory__record") ?? [])];
		const index = records.indexOf(event.currentTarget);
		records.at(index + (event.key === "ArrowDown" ? 1 : -1))?.focus();
	};
	return <button type="button" className={`jai-trajectory__record${selected ? " is-selected" : ""}`} onClick={onSelect} onKeyDown={onKeyDown} aria-pressed={selected}>
		<span className="jai-trajectory__record-dot" aria-hidden="true" />
		<span className="jai-trajectory__record-main"><strong>{label}</strong><small>{formatTime(item.timestamp)}</small></span>
		<span className="jai-trajectory__record-summary">{recordSummary(item)}</span>
	</button>;
}

function Detail({ item, onClose }: { readonly item: TrajectoryItem; readonly onClose: () => void }) {
	return <aside className="jai-trajectory__detail" aria-label="Selected trajectory record">
		<div className="jai-trajectory__detail-heading"><h2>{recordLabel(item)}</h2><button type="button" onClick={onClose} aria-label="Close record detail">Close</button></div>
		<pre>{JSON.stringify(item, null, 2)}</pre>
	</aside>;
}

function recordLabel(item: TrajectoryItem): string {
	if (item.type === "message") return item.message.role === "toolResult" ? `Tool result · ${item.message.toolResult?.toolName ?? "tool"}` : `${item.message.role === "user" ? "User" : "Assistant"} message`;
	if (item.type === "live_chunk") return item.chunk.channel === "tool" ? "Live tool output" : item.chunk.channel === "thought" ? "Live reasoning" : "Live response";
	return typeof item.journal.type === "string" ? item.journal.type.replaceAll("_", " ") : "Operation fact";
}

function recordSummary(item: TrajectoryItem): string {
	if (item.type === "message") return item.message.text ?? item.message.reasoning ?? item.message.toolResult?.output ?? "Content not granted";
	if (item.type === "live_chunk") return item.chunk.text;
	const value = item.journal.outcome ?? item.journal.model ?? item.journal.toolName ?? item.journal.kind;
	return typeof value === "string" ? value : `cursor ${item.cursor.value}`;
}

function formatTime(timestamp: string): string {
	const date = new Date(timestamp);
	return Number.isNaN(date.getTime()) ? timestamp : new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}
