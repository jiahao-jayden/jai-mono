import type { OperationRecord, SessionEntry } from "@jai/agent";
import type { Usage } from "@jai/ai";
import { Result, type Result as ResultType } from "better-result";
import type { DesktopCatalogAccess } from "../protocol/desktop-catalog";
import type { ProductSessionDurableState, ProductSessionPersistence } from "../sessions";
import { hasTrajectoryScope, isTrajectoryReadAccess } from "./access";
import type { TrajectoryLiveEvent, TrajectoryLiveSource } from "./runtime-source";
import {
	TrajectoryAccessDenied,
	type TrajectoryCursor,
	TrajectoryCursorExpired,
	type TrajectoryFeed,
	type TrajectoryItem,
	type TrajectoryReadAccess,
	type TrajectoryReadError,
	TrajectoryReadFailed,
	type TrajectorySessionMetadata,
	type TrajectorySnapshot,
	type TrajectorySubscription,
} from "./types";

const POLL_INTERVAL_MS = 100;

export function createTrajectoryFeed(input: {
	readonly persistence: ProductSessionPersistence;
	readonly desktopCatalog?: DesktopCatalogAccess;
	readonly liveSource?: TrajectoryLiveSource;
}): TrajectoryFeed {
	return new DefaultTrajectoryFeed(input);
}

class DefaultTrajectoryFeed implements TrajectoryFeed {
	constructor(
		private readonly input: {
			readonly persistence: ProductSessionPersistence;
			readonly desktopCatalog?: DesktopCatalogAccess;
			readonly liveSource?: TrajectoryLiveSource;
		},
	) {}

	async snapshot(access: TrajectoryReadAccess): Promise<ResultType<TrajectorySnapshot, TrajectoryReadError>> {
		if (!isTrajectoryReadAccess(access)) return Result.err(deniedAccess(access));
		const state = await this.read(access);
		if (state.isErr()) return state;
		const metadata = this.metadata(state.value, access.sessionId);
		return Result.ok({
			session: metadata,
			cursor: cursorFor(state.value),
			items: state.value.journalFacts.map((fact) => projectFact(fact, access, state.value)),
		});
	}

	async subscribe(
		access: TrajectoryReadAccess,
		cursor: TrajectoryCursor,
		listener: (item: TrajectoryItem) => void,
	): Promise<ResultType<TrajectorySubscription, TrajectoryReadError>> {
		if (!isTrajectoryReadAccess(access)) return Result.err(deniedAccess(access));
		const initial = await this.read(access);
		if (initial.isErr()) return initial;
		const initialSequence = parseCursor(access.sessionId, cursor, initial.value);
		if (initialSequence instanceof TrajectoryCursorExpired) return Result.err(initialSequence);
		let seen = initialSequence;
		let closed = false;
		let polling = false;
		let liveSequence = 0;
		const poll = async () => {
			if (closed || polling) return;
			polling = true;
			try {
				const next = await this.read(access);
				if (next.isErr()) return;
				for (const fact of next.value.journalFacts) {
					if (fact.sequence <= seen) continue;
					seen = fact.sequence;
					try {
						listener(projectFact(fact, access, next.value));
					} catch {
						// A disposable reader cannot stop the Agent or other observers.
					}
				}
			} finally {
				polling = false;
			}
		};
		let closeLive: (() => void) | undefined;
		if (this.input.liveSource) {
			const live = await this.input.liveSource.subscribe(access.sessionId, (event) => {
				const item = projectLiveEvent(event, access, ++liveSequence);
				if (!item) return;
				try {
					listener(item);
				} catch {
					// A disposable reader cannot stop the Agent or other observers.
				}
			});
			if (live.isErr()) return live;
			closeLive = live.value;
		}
		for (const fact of initial.value.journalFacts) {
			if (fact.sequence <= seen) continue;
			seen = fact.sequence;
			try {
				listener(projectFact(fact, access, initial.value));
			} catch {
				// A disposable reader cannot stop the Agent or other observers.
			}
		}
		const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
		return Result.ok({
			close() {
				if (closed) return;
				closed = true;
				clearInterval(timer);
				closeLive?.();
			},
		});
	}

	private async read(
		access: TrajectoryReadAccess,
	): Promise<ResultType<ProductSessionDurableState, TrajectoryReadError>> {
		const loaded = await this.input.persistence.load(access.sessionId);
		if (loaded.isOk()) return Result.ok(loaded.value);
		return Result.err(
			new TrajectoryReadFailed({
				sessionId: access.sessionId,
				message: `Could not read trajectory for Session "${access.sessionId}"`,
				cause: loaded.error,
			}),
		);
	}

	private metadata(state: ProductSessionDurableState, sessionId: string): TrajectorySessionMetadata {
		const catalogSession = this.input.desktopCatalog?.getSession(sessionId);
		if (!catalogSession || catalogSession.isErr() || !catalogSession.value) {
			return { sessionId, cwd: state.cwd };
		}
		const project = catalogSession.value.projectId
			? this.input.desktopCatalog?.getProject(catalogSession.value.projectId)
			: undefined;
		return {
			sessionId,
			cwd: state.cwd,
			title: catalogSession.value.title,
			...(project?.isOk() && project.value
				? { project: { id: project.value.id, displayName: project.value.displayName } }
				: {}),
		};
	}
}

function deniedAccess(access: unknown): TrajectoryAccessDenied {
	const sessionId =
		typeof access === "object" &&
		access !== null &&
		typeof (access as { readonly sessionId?: unknown }).sessionId === "string"
			? (access as { readonly sessionId: string }).sessionId
			: "";
	return new TrajectoryAccessDenied({
		sessionId,
		message: "Trajectory access must be issued by a trusted Server adapter",
	});
}

function projectLiveEvent(
	event: TrajectoryLiveEvent,
	access: TrajectoryReadAccess,
	sequence: number,
): Extract<TrajectoryItem, { readonly type: "live_chunk" }> | undefined {
	if (event.type === "message_chunk") {
		if (event.channel === "agent" && !hasTrajectoryScope(access, "final_text")) return undefined;
		if (event.channel === "thought" && !hasTrajectoryScope(access, "reasoning")) return undefined;
		return {
			id: `live:${event.messageId}:${event.channel}`,
			cursor: { value: `live:${sequence}` },
			timestamp: new Date().toISOString(),
			type: "live_chunk",
			chunk: { messageId: event.messageId, channel: event.channel, text: event.text },
		};
	}
	if (!hasTrajectoryScope(access, "tool_output")) return undefined;
	return {
		id: `live:${event.toolCallId}:tool`,
		cursor: { value: `live:${sequence}` },
		timestamp: new Date().toISOString(),
		type: "live_chunk",
		chunk: { messageId: event.toolCallId, channel: "tool", text: event.text },
	};
}

function cursorFor(state: ProductSessionDurableState): TrajectoryCursor {
	return { value: String(state.journalFacts.at(-1)?.sequence ?? 0) };
}

function parseCursor(
	sessionId: string,
	cursor: TrajectoryCursor,
	state: ProductSessionDurableState,
): number | TrajectoryCursorExpired {
	const sequence = Number(cursor.value);
	const highWater = state.journalFacts.at(-1)?.sequence ?? 0;
	if (!Number.isInteger(sequence) || sequence < 0 || sequence > highWater) {
		return new TrajectoryCursorExpired({
			sessionId,
			cursor: cursor.value,
			message: "Trajectory cursor is not available; request a new snapshot",
		});
	}
	return sequence;
}

function projectFact(
	fact: ProductSessionDurableState["journalFacts"][number],
	access: TrajectoryReadAccess,
	state: ProductSessionDurableState,
): TrajectoryItem {
	const cursor = { value: String(fact.sequence) };
	if (fact.kind === "entry") return projectEntry(fact.entry, cursor, access);
	return projectOperation(fact.record, cursor, access, state);
}

function projectEntry(entry: SessionEntry, cursor: TrajectoryCursor, access: TrajectoryReadAccess): TrajectoryItem {
	const base = { id: `entry:${entry.id}`, cursor, timestamp: entry.timestamp };
	if (entry.type !== "message") {
		return { ...base, type: "journal", journal: { type: entry.type, entryId: entry.id, parentId: entry.parentId } };
	}
	const message = entry.message;
	if (message.role === "user") {
		return {
			...base,
			type: "message",
			message: {
				entryId: entry.id,
				role: "user",
				parentId: entry.parentId,
				...(hasTrajectoryScope(access, "prompt")
					? { text: typeof message.content === "string" ? message.content : textContent(message.content) }
					: {}),
			},
		};
	}
	if (message.role === "toolResult") {
		return {
			...base,
			type: "message",
			message: {
				entryId: entry.id,
				role: "toolResult",
				parentId: entry.parentId,
				toolResult: {
					toolCallId: message.toolCallId,
					toolName: message.toolName,
					isError: message.isError,
					...(hasTrajectoryScope(access, "tool_output") ? { output: textContent(message.content) } : {}),
				},
			},
		};
	}
	const toolCall = message.content.find((content) => content.type === "toolCall");
	return {
		...base,
		type: "message",
		message: {
			entryId: entry.id,
			role: "assistant",
			parentId: entry.parentId,
			...(hasTrajectoryScope(access, "final_text") ? { text: textContent(message.content) } : {}),
			...(hasTrajectoryScope(access, "reasoning") ? { reasoning: thinkingContent(message.content) } : {}),
			...(toolCall
				? {
						toolCall: {
							id: toolCall.id,
							name: toolCall.name,
							...(hasTrajectoryScope(access, "tool_input") ? { input: toolCall.arguments } : {}),
						},
					}
				: {}),
		},
	};
}

function projectOperation(
	record: OperationRecord,
	cursor: TrajectoryCursor,
	access: TrajectoryReadAccess,
	state: ProductSessionDurableState,
): TrajectoryItem {
	const journal: Record<string, unknown> = { type: record.type, operationId: record.operationId };
	let parentId: string | undefined;
	switch (record.type) {
		case "operation_accepted":
			journal.inputEntryId = record.inputEntryId;
			journal.kind = record.kind;
			parentId = `entry:${record.inputEntryId}`;
			break;
		case "model_attempted":
			journal.turnId = record.turnId;
			journal.attemptId = record.attemptId;
			journal.assistantEntryId = record.assistantEntryId;
			journal.model = record.modelSnapshotId;
			parentId = `operation:${record.operationId}:turn_started:${record.turnId}`;
			journal.runtimeModel = state.operationRuntimeConfigurations.find(
				(configuration) => configuration.operationId === record.operationId,
			)?.configuration.model;
			break;
		case "tool_dispatched":
			journal.turnId = record.turnId;
			journal.toolCallId = record.toolCallId;
			journal.toolName = record.toolName;
			journal.assistantEntryId = record.assistantEntryId;
			journal.argsHash = record.argsHash;
			parentId = `entry:${record.assistantEntryId}`;
			if (hasTrajectoryScope(access, "tool_input")) journal.input = record.args;
			break;
		case "usage_settled":
			journal.attemptId = record.attemptId;
			journal.usage = usageProjection(record.usage);
			parentId = `operation:${record.operationId}:model_attempted:${record.attemptId}`;
			break;
		case "model_stream_settled":
			journal.turnId = record.turnId;
			journal.attemptId = record.attemptId;
			journal.assistantEntryId = record.assistantEntryId;
			journal.firstOutputAt = record.firstOutputAt;
			journal.lastOutputAt = record.lastOutputAt;
			journal.chunkCount = record.chunkCount;
			journal.chunkTypeCounts = record.chunkTypeCounts;
			journal.outcome = record.outcome;
			parentId = `operation:${record.operationId}:model_attempted:${record.attemptId}`;
			break;
		case "tool_timing_settled":
			journal.turnId = record.turnId;
			journal.toolCallId = record.toolCallId;
			journal.startedAt = record.startedAt;
			journal.finishedAt = record.finishedAt;
			journal.outcome = record.outcome;
			parentId = `operation:${record.operationId}:tool_dispatched:${record.toolCallId}`;
			break;
		case "turn_started":
			journal.turnId = record.turnId;
			break;
		case "turn_finished":
			journal.turnId = record.turnId;
			journal.assistantEntryId = record.assistantEntryId;
			journal.outcome = record.outcome;
			parentId = `operation:${record.operationId}:turn_started:${record.turnId}`;
			break;
		case "input_queued":
			journal.inputId = record.inputId;
			journal.delivery = record.delivery;
			journal.inputEntryId = record.inputEntryId;
			parentId = `operation:${record.operationId}:operation_accepted`;
			break;
		case "operation_finished":
			journal.outcome = record.outcome;
			parentId = `operation:${record.operationId}:operation_accepted`;
			break;
		default:
			return assertNever(record);
	}
	return {
		id: operationRecordId(record),
		...(parentId ? { parentId } : {}),
		cursor,
		timestamp: record.timestamp,
		type: "journal",
		journal,
	};
}

function usageProjection(usage: Usage): Record<string, number> {
	return {
		input: usage.input,
		output: usage.output,
		cacheRead: usage.cacheRead,
		cacheWrite: usage.cacheWrite,
		totalTokens: usage.totalTokens,
		cost: usage.cost.total,
		...(usage.reasoning === undefined ? {} : { reasoning: usage.reasoning }),
	};
}

function assertNever(value: never): never {
	throw new Error(`Unhandled trajectory record: ${JSON.stringify(value)}`);
}

function operationRecordId(record: OperationRecord): string {
	switch (record.type) {
		case "model_attempted":
		case "usage_settled":
			return `operation:${record.operationId}:${record.type}:${record.attemptId}`;
		case "tool_dispatched":
		case "tool_timing_settled":
			return `operation:${record.operationId}:${record.type}:${record.toolCallId}`;
		case "turn_started":
		case "turn_finished":
			return `operation:${record.operationId}:${record.type}:${record.turnId}`;
		case "input_queued":
			return `operation:${record.operationId}:${record.type}:${record.inputId}`;
		default:
			return `operation:${record.operationId}:${record.type}`;
	}
}

function textContent(content: readonly unknown[]): string | undefined {
	const text = content
		.flatMap((part) => (isPart(part, "text") && typeof part.text === "string" ? [part.text] : []))
		.join("");
	return text || undefined;
}

function thinkingContent(content: readonly unknown[]): string | undefined {
	const thinking = content
		.flatMap((part) => (isPart(part, "thinking") && typeof part.thinking === "string" ? [part.thinking] : []))
		.join("");
	return thinking || undefined;
}

function isPart(value: unknown, type: string): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && (value as { readonly type?: unknown }).type === type;
}
