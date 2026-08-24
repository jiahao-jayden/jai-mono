import type { CodingAgentEvent, CodingAgentMessage } from "@jai/coding-agent";
import type {
	DesktopAgentEvent,
	DesktopAgentEventEnvelope,
	DesktopArtifact,
	DesktopCompactionItem,
	DesktopMessageItem,
	DesktopTranscriptItem,
} from "../../../shared/desktop-rpc";
import type { SessionRuntime } from "../runtime";
import { completedCompactionItem } from "./compaction";
import { assistantPartItem, type DesktopAssistantItem, userMessageItem } from "./items";
import {
	type LiveProjection,
	type LiveProjectionContext,
	projectMessageUpdate,
	projectToolProgress,
	projectToolStart,
} from "./live";

export class LiveAgentProjection {
	readonly #emit: (envelope: DesktopAgentEventEnvelope) => void;
	readonly #onSessionActivity: (sessionId: string) => void;
	readonly #now: () => number;

	constructor(options: {
		readonly emit: (envelope: DesktopAgentEventEnvelope) => void;
		readonly onSessionActivity: (sessionId: string) => void;
		readonly now?: () => number;
	}) {
		this.#emit = options.emit;
		this.#onSessionActivity = options.onSessionActivity;
		this.#now = options.now ?? Date.now;
	}

	onAgentEvent(runtime: SessionRuntime, event: CodingAgentEvent): void {
		switch (event.type) {
			case "message_start": {
				for (const item of this.#projectMessageItems(runtime, event.message, "streaming")) {
					runtime.items.set(item.id, item);
					this.emitNow(runtime, { type: "transcript_upsert", item });
				}
				return;
			}
			case "message_update": {
				this.#applyProjection(runtime, projectMessageUpdate(event, this.#projectionContext(runtime)));
				return;
			}
			case "message_end": {
				const completeItems = this.#projectMessageItems(runtime, event.message, "complete", event.entryId);
				const narrationIds = new Set(completeItems.filter((item) => item.kind === "narration").map((item) => item.id));
				for (const id of narrationIds) runtime.pendingTranscriptUpdates.delete(id);
				for (const item of completeItems) {
					runtime.items.set(item.id, item);
					if (narrationIds.size > 0) this.#emitEnvelope(runtime, { type: "transcript_upsert", item });
					else this.emitNow(runtime, { type: "transcript_upsert", item });
				}
				if (narrationIds.size > 0) this.#flushPendingTranscriptUpdates(runtime);
				this.#onSessionActivity(runtime.sessionId);
				if (event.message.role === "assistant") runtime.activeAssistantId = undefined;
				if (event.message.role === "user") runtime.activeUserId = undefined;
				return;
			}
			case "message_discard": {
				this.#discardActiveAssistant(runtime);
				return;
			}
			case "tool_execution_start": {
				this.#applyProjection(runtime, projectToolStart(event, this.#projectionContext(runtime)));
				return;
			}
			case "tool_execution_update":
			case "tool_execution_end": {
				if (event.type === "tool_execution_end") {
					const artifact = runtime.agent.state.artifacts.find((candidate) => candidate.toolCallId === event.toolCallId);
					if (artifact && !event.isError) this.#upsertArtifact(runtime, artifact);
				}
				this.#applyProjection(runtime, projectToolProgress(event, this.#projectionContext(runtime)));
				return;
			}
			case "compaction_start": {
				this.#startCompaction(runtime);
				return;
			}
			case "compaction_end": {
				this.#finishCompaction(runtime, event.outcome);
				return;
			}
			default:
				return;
		}
	}

	clear(runtime: SessionRuntime): void {
		if (runtime.flushTimer) clearTimeout(runtime.flushTimer);
		runtime.flushTimer = undefined;
		runtime.pendingTranscriptUpdates.clear();
	}

	emitNow(runtime: SessionRuntime, event: DesktopAgentEvent): void {
		this.#flushPendingTranscriptUpdates(runtime);
		this.#emitEnvelope(runtime, event);
	}

	#startCompaction(runtime: SessionRuntime): void {
		if (runtime.pendingCompactionId) return;
		const item: DesktopCompactionItem = {
			kind: "compaction",
			id: `compaction:pending:${runtime.nextCompactionId++}`,
			summary: "",
			timestamp: this.#now(),
			status: "compacting",
		};
		runtime.pendingCompactionId = item.id;
		runtime.items.set(item.id, item);
		this.emitNow(runtime, { type: "transcript_upsert", item });
	}

	#finishCompaction(runtime: SessionRuntime, outcome: unknown): void {
		const pendingId = runtime.pendingCompactionId;
		runtime.pendingCompactionId = undefined;
		if (pendingId) {
			runtime.items.delete(pendingId);
			this.emitNow(runtime, { type: "transcript_remove", id: pendingId });
		}

		const item = completedCompactionItem(outcome);
		if (!item) return;
		runtime.items.set(item.id, item);
		this.emitNow(runtime, { type: "transcript_upsert", item });
	}

	#projectionContext(runtime: SessionRuntime): LiveProjectionContext {
		return {
			...(runtime.currentTurnId ? { turnId: runtime.currentTurnId } : {}),
			messageId: (role) => this.#ensureMessageId(runtime, role),
			existing: (id) => runtime.items.get(id),
		};
	}

	#applyProjection(runtime: SessionRuntime, projection: LiveProjection): void {
		switch (projection.kind) {
			case "none":
				return;
			case "items":
				for (const item of projection.items) {
					runtime.items.set(item.id, item);
					this.emitNow(runtime, { type: "transcript_upsert", item });
				}
				return;
			case "streaming":
				runtime.items.set(projection.item.id, projection.item);
				this.#queueTranscriptUpdate(runtime, { type: "transcript_upsert", item: projection.item });
				return;
			case "todos": {
				const todos = runtime.agent.state.todos;
				if (!todos) return;
				runtime.todos = todos;
				this.emitNow(runtime, { type: "todos_replace", todos });
				return;
			}
		}
	}

	#projectMessageItems(
		runtime: SessionRuntime,
		message: CodingAgentMessage,
		status: DesktopMessageItem["status"],
		entryId?: string,
	): DesktopAssistantItem[] {
		if (message.role === "toolResult") return [];
		if (message.role === "assistant") {
			const messageId = this.#ensureMessageId(runtime, "assistant");
			const turnId = runtime.currentTurnId ?? messageId;
			return message.content.flatMap((_, contentIndex) => {
				const item = assistantPartItem({ message, messageId, turnId, contentIndex, status });
				if (!item) return [];
				if (item.kind === "tool" && runtime.items.get(item.id)?.kind === "tool") return [];
				return [item];
			});
		}
		const id = this.#ensureMessageId(runtime, "user");
		runtime.currentTurnId = id;
		return [userMessageItem({ id, message, status, ...(entryId ? { entryId } : {}) })];
	}

	#ensureMessageId(runtime: SessionRuntime, role: "assistant" | "user"): string {
		if (role === "assistant") {
			const id = runtime.activeAssistantId ?? `message:${runtime.nextMessageId++}`;
			runtime.activeAssistantId = id;
			return id;
		}
		const id = runtime.activeUserId ?? `message:${runtime.nextMessageId++}`;
		runtime.activeUserId = id;
		return id;
	}

	#discardActiveAssistant(runtime: SessionRuntime): void {
		const messageId = runtime.activeAssistantId;
		if (!messageId) return;
		const discarded = [...runtime.items.values()].filter(
			(item) => item.id === messageId || item.id.startsWith(`${messageId}:`),
		);
		for (const item of discarded) {
			runtime.pendingTranscriptUpdates.delete(item.id);
			runtime.items.delete(item.id);
		}
		runtime.activeAssistantId = undefined;
		for (const item of discarded) this.emitNow(runtime, { type: "transcript_remove", id: item.id });
	}

	#queueTranscriptUpdate(
		runtime: SessionRuntime,
		event: Extract<DesktopAgentEvent, { readonly type: "transcript_upsert" }>,
	): void {
		runtime.pendingTranscriptUpdates.set(event.item.id, event);
		if (runtime.flushTimer) return;
		runtime.flushTimer = setTimeout(() => this.#flushPendingTranscriptUpdates(runtime), 100);
		runtime.flushTimer.unref?.();
	}

	#flushPendingTranscriptUpdates(runtime: SessionRuntime): void {
		if (runtime.flushTimer) clearTimeout(runtime.flushTimer);
		runtime.flushTimer = undefined;
		const events = [...runtime.pendingTranscriptUpdates.values()];
		runtime.pendingTranscriptUpdates.clear();
		for (const event of events) this.#emitEnvelope(runtime, event);
	}

	#emitEnvelope(runtime: SessionRuntime, event: DesktopAgentEvent): void {
		if (runtime.closed) return;
		runtime.seq++;
		this.#emit({ sessionId: runtime.sessionId, seq: runtime.seq, event: structuredClone(event) });
	}

	#upsertArtifact(runtime: SessionRuntime, artifact: DesktopArtifact): void {
		const current = runtime.artifacts.get(artifact.id);
		if (current && current.updatedAt > artifact.updatedAt) return;
		runtime.artifacts.set(artifact.id, artifact);
		this.emitNow(runtime, { type: "artifact_upsert", artifact });
	}
}
