import type { PermissionResolution } from "@jai/coding/permissions/approval";
import { useCallback, useEffect, useRef, useState } from "react";
import { desktop } from "@/lib/desktop";
import { createDesktopAgentEventDispatcher, type DesktopAgentProjectionUpdate } from "@/lib/desktop-agent";
import { invalidateRecentSessions, upsertRecentSession } from "@/lib/desktop-query";
import type { QueuedMessage } from "@/stores/chat";
import type {
	DesktopAgentEvent,
	DesktopAgentMode,
	DesktopAgentSnapshot,
	DesktopAgentStatus,
	DesktopTodos,
	DesktopTranscriptItem,
} from "../../shared/desktop-rpc";

export type ChatStatus = "ready" | "submitted" | "streaming" | "error";

export interface ChatMessageInput {
	readonly text: string;
	readonly mode: DesktopAgentMode;
}

export interface UseChatOptions {
	readonly id: string | null;
	readonly newSessionProjectId: string | null;
	readonly modelRef: string;
	readonly mode: DesktopAgentMode;
	readonly queue: readonly QueuedMessage[];
	onSessionCreated(sessionId: string): void;
	onDraftAccepted(): void;
	onMessageQueued(text: string, mode: DesktopAgentMode): void;
	onQueuedMessageAccepted(messageId: string): void;
}

export interface Chat {
	readonly id: string | null;
	readonly messages: readonly DesktopTranscriptItem[];
	readonly todos: DesktopTodos | undefined;
	readonly status: ChatStatus;
	readonly isLoading: boolean;
	readonly error: string | undefined;
	sendMessage(message: ChatMessageInput): Promise<void>;
	stop(): Promise<void>;
	clearError(): void;
	resolvePermission(resolution: PermissionResolution): Promise<void>;
}

export interface ChatRuntimeState {
	readonly agentStatus: DesktopAgentStatus;
	readonly error: string | undefined;
	readonly isLoading: boolean;
	readonly lastSeq: number;
	readonly sessionId: string | null;
	readonly submitting: boolean;
	readonly messages: readonly DesktopTranscriptItem[];
	readonly todos: DesktopTodos | undefined;
}

const EMPTY_STATE: ChatRuntimeState = {
	agentStatus: "idle",
	error: undefined,
	isLoading: false,
	lastSeq: 0,
	sessionId: null,
	submitting: false,
	messages: [],
	todos: undefined,
};

let dispatcher: ReturnType<typeof createDesktopAgentEventDispatcher> | undefined;

/**
 * Adapts the Desktop RPC snapshot/event stream into the UI-facing subset of
 * the AI SDK useChat contract. Zustand state is deliberately injected through
 * options rather than read here.
 */
export function useChat(options: UseChatOptions): Chat {
	const [state, setState] = useState<ChatRuntimeState>(EMPTY_STATE);
	const latestOptions = useRef(options);
	const stateRef = useRef(state);
	const dispatchingQueueIdRef = useRef<string | undefined>(undefined);
	const previousAgentStatusRef = useRef<DesktopAgentStatus>("idle");
	latestOptions.current = options;
	stateRef.current = state;

	useEffect(() => {
		const sessionId = options.id;
		dispatchingQueueIdRef.current = undefined;
		previousAgentStatusRef.current = "idle";

		if (!sessionId) {
			setState(EMPTY_STATE);
			return;
		}

		setState({
			agentStatus: "idle",
			error: undefined,
			isLoading: true,
			lastSeq: 0,
			sessionId,
			submitting: false,
			messages: [],
			todos: undefined,
		});
		dispatcher ??= createDesktopAgentEventDispatcher();
		return dispatcher.subscribe(sessionId, (update) => {
			setState((current) => applyChatProjectionUpdate(current, update));
		});
	}, [options.id]);

	const dispatchQueueHead = useCallback(async () => {
		const current = stateRef.current;
		const latest = latestOptions.current;
		const head = latest.queue[0];
		if (!head || !current.sessionId || current.agentStatus !== "idle" || current.error) return;
		if (dispatchingQueueIdRef.current) return;
		if (!latest.modelRef) {
			setState((previous) => ({ ...previous, error: "请先选择可用模型。", submitting: false }));
			return;
		}

		dispatchingQueueIdRef.current = head.id;
		setState((previous) => ({ ...previous, error: undefined, submitting: true }));
		try {
			await desktop.agent.send({
				sessionId: current.sessionId,
				message: head.text,
				modelRef: latest.modelRef,
				mode: head.mode,
			});
			latest.onQueuedMessageAccepted(head.id);
		} catch {
			setState((previous) => ({
				...previous,
				error: "队列消息未发送。请检查模型配置后重试。",
				submitting: false,
			}));
		} finally {
			dispatchingQueueIdRef.current = undefined;
		}
	}, []);

	useEffect(() => {
		const previousAgentStatus = previousAgentStatusRef.current;
		previousAgentStatusRef.current = state.agentStatus;
		if (previousAgentStatus === "running" && state.agentStatus === "idle") {
			void dispatchQueueHead();
		}
	}, [dispatchQueueHead, state.agentStatus]);

	const sendMessage = useCallback(async ({ text: rawText, mode }: ChatMessageInput) => {
		const text = rawText.trim();
		const current = stateRef.current;
		const latest = latestOptions.current;
		if (!text || current.submitting) return;

		if (current.agentStatus === "running") {
			latest.onMessageQueued(text, mode);
			return;
		}
		if (latest.queue.length > 0) {
			setState((previous) => ({ ...previous, error: "请先处理队列中的消息。" }));
			return;
		}
		if (!latest.modelRef) {
			setState((previous) => ({ ...previous, error: "请先选择可用模型。" }));
			return;
		}

		setState((previous) => ({ ...previous, error: undefined, submitting: true }));
		try {
			if (current.sessionId) {
				await desktop.agent.send({
					sessionId: current.sessionId,
					message: text,
					modelRef: latest.modelRef,
					mode,
				});
				latest.onDraftAccepted();
				return;
			}

			const session = await desktop.session.create({
				projectId: latest.newSessionProjectId,
				firstMessage: text,
			});
			upsertRecentSession(session);
			latest.onSessionCreated(session.id);
			await desktop.agent.send({
				sessionId: session.id,
				message: text,
				modelRef: latest.modelRef,
				mode,
			});
			latest.onDraftAccepted();
			void invalidateRecentSessions();
		} catch {
			setState((previous) => ({
				...previous,
				error: "消息未发送。请检查模型配置后重试。",
				submitting: false,
			}));
		}
	}, []);

	const stop = useCallback(async () => {
		const current = stateRef.current;
		if (!current.sessionId || current.agentStatus !== "running") return;
		try {
			await desktop.agent.abort(current.sessionId);
		} catch {
			setState((previous) => ({ ...previous, error: "未能停止当前响应。" }));
		}
	}, []);

	const clearError = useCallback(() => {
		setState((current) => (current.error ? { ...current, error: undefined } : current));
	}, []);

	const resolvePermission = useCallback(async (resolution: PermissionResolution) => {
		try {
			await desktop.agent.resolvePermission(resolution);
		} catch {
			setState((previous) => ({ ...previous, error: "权限响应未提交。" }));
		}
	}, []);

	return {
		id: options.id,
		messages: state.messages,
		todos: state.todos,
		status: getChatStatus(state),
		isLoading: state.isLoading,
		error: state.error,
		sendMessage,
		stop,
		clearError,
		resolvePermission,
	};
}

export function applyChatProjectionUpdate(
	state: ChatRuntimeState,
	update: DesktopAgentProjectionUpdate,
): ChatRuntimeState {
	if (update.type === "snapshot") return snapshotState(update.snapshot);
	return applyAgentEvent(state, update.envelope.seq, update.envelope.event);
}

function applyAgentEvent(state: ChatRuntimeState, seq: number, event: DesktopAgentEvent): ChatRuntimeState {
	switch (event.type) {
		case "status":
			return {
				...state,
				agentStatus: event.status,
				error: event.status === "running" ? undefined : state.error,
				isLoading: false,
				lastSeq: seq,
				submitting: event.status === "running" ? false : state.submitting,
			};
		case "model_catalog_updated":
			return { ...state, lastSeq: seq };
		case "connector_oauth_completed":
		case "connector_oauth_failed":
			return { ...state, lastSeq: seq };
		case "transcript_upsert":
			return {
				...state,
				isLoading: false,
				lastSeq: seq,
				messages: upsertMessage(state.messages, event.item),
			};
		case "todos_replace":
			return { ...state, isLoading: false, lastSeq: seq, todos: event.todos };
		case "runtime_error":
			return {
				...state,
				agentStatus: "idle",
				error: event.error.message,
				isLoading: false,
				lastSeq: seq,
				submitting: false,
			};
	}
}

function snapshotState(snapshot: DesktopAgentSnapshot): ChatRuntimeState {
	return {
		agentStatus: snapshot.status,
		error: undefined,
		isLoading: false,
		lastSeq: snapshot.lastSeq,
		sessionId: snapshot.sessionId,
		submitting: false,
		messages: [...snapshot.items],
		todos: snapshot.todos,
	};
}

function getChatStatus(state: ChatRuntimeState): ChatStatus {
	if (state.error) return "error";
	if (state.agentStatus === "running") return "streaming";
	if (state.submitting) return "submitted";
	return "ready";
}

function upsertMessage(
	messages: readonly DesktopTranscriptItem[],
	message: DesktopTranscriptItem,
): readonly DesktopTranscriptItem[] {
	const index = messages.findIndex((candidate) => candidate.id === message.id);
	if (index < 0) return [...messages, message];
	const next = [...messages];
	next[index] = message;
	return next;
}
