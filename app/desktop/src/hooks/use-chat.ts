import { useCallback, useEffect, useRef, useState } from "react";
import { desktop, getDesktopRemoteRpcFailure } from "@/lib/desktop";
import { createDesktopAgentEventDispatcher, type DesktopAgentProjectionUpdate } from "@/lib/desktop-agent";
import { invalidateRecentSessions, upsertRecentSession } from "@/lib/desktop-query";
import type { QueuedMessage } from "@/stores/chat";
import type {
	DesktopAgentConnectionStatus,
	DesktopAgentEvent,
	DesktopAgentSnapshot,
	DesktopAgentStatus,
	DesktopArtifact,
	DesktopFailure,
	DesktopMessageAttachment,
	DesktopPermissionResolution,
	DesktopRunTiming,
	DesktopSessionConfiguration,
	DesktopSessionControls,
	DesktopSessionUsage,
	DesktopTodos,
	DesktopTranscriptItem,
} from "../../shared/desktop-rpc";
import { EMPTY_DESKTOP_SESSION_USAGE } from "../../shared/desktop-rpc";

export type ChatStatus = "ready" | "submitted" | "streaming" | "stopping";

export interface ChatMessageInput {
	readonly text: string;
	readonly controls: DesktopSessionControls;
	readonly attachments?: readonly DesktopMessageAttachment[];
	readonly delivery?: "queue" | "steer";
}

export interface UseChatOptions {
	readonly id: string | null;
	readonly newSessionProjectId: string | null;
	/** Preferred model when the Session has none of its own (new chats, or its model was disabled). */
	readonly modelRef: string;
	/** Preferred Session controls when the Session has none of its own yet. */
	readonly controls: DesktopSessionControls;
	readonly availableModelRefs: readonly string[];
	readonly queue: readonly QueuedMessage[];
	onSessionCreated(sessionId: string): void;
	onMessageAccepted(sessionId: string): void;
	onMessageQueued(text: string, controls: DesktopSessionControls, modelRef: string): void;
	onQueuedMessageAccepted(messageId: string): void;
}

/** Failure of the current branch's last Operation, as projected by the Runtime Host. */
export interface ChatOperationFailure {
	readonly failure: DesktopFailure;
	/** Identifies the failed turn, e.g. to remember a dismissal per Operation. */
	readonly operationId: string | undefined;
}

/** The single notice above the composer, in priority order: connection, last Operation failure, rejected send. */
export type ChatNotice =
	| { readonly kind: "connection"; readonly status: DesktopAgentConnectionStatus }
	| ({ readonly kind: "operation" } & ChatOperationFailure)
	| { readonly kind: "send"; readonly failure: DesktopFailure };

export function resolveChatNotice(
	state: Pick<ChatRuntimeState, "connectionStatus" | "operationFailure" | "error">,
	dismissedOperationIds: ReadonlySet<string>,
): ChatNotice | undefined {
	if (state.connectionStatus) return { kind: "connection", status: state.connectionStatus };
	const operation = state.operationFailure;
	if (operation && !(operation.operationId && dismissedOperationIds.has(operation.operationId))) {
		return { kind: "operation", ...operation };
	}
	return state.error ? { kind: "send", failure: state.error } : undefined;
}

export interface Chat {
	readonly id: string | null;
	readonly messages: readonly DesktopTranscriptItem[];
	readonly runs: readonly DesktopRunTiming[];
	readonly todos: DesktopTodos | undefined;
	readonly artifacts: readonly DesktopArtifact[];
	readonly usage: DesktopSessionUsage;
	readonly status: ChatStatus;
	readonly isLoading: boolean;
	readonly notice: ChatNotice | undefined;
	/** Model and Session controls the next message will use. */
	readonly modelRef: string;
	readonly controls: DesktopSessionControls;
	configure(selection: DesktopSessionConfiguration): Promise<void>;
	sendMessage(message: ChatMessageInput): Promise<boolean>;
	steerQueuedMessage(message: QueuedMessage): Promise<boolean>;
	stop(): Promise<void>;
	navigate(entryId: string): Promise<boolean>;
	/** Retries the failed last turn with the current model and controls; resolves to the rejection, if any. */
	retry(): Promise<DesktopFailure | undefined>;
	retryConnection(): Promise<void>;
	resolvePermission(resolution: DesktopPermissionResolution): Promise<void>;
	dismissNotice(): void;
}

export interface ChatRuntimeState {
	readonly agentStatus: DesktopAgentStatus;
	/** Latest request failure or rejected send, shown until dismissed or the next send. */
	readonly error: DesktopFailure | undefined;
	readonly operationFailure: ChatOperationFailure | undefined;
	readonly connectionStatus: DesktopAgentConnectionStatus | undefined;
	readonly isLoading: boolean;
	readonly lastSeq: number;
	readonly sessionId: string | null;
	readonly submitting: boolean;
	readonly stopping: boolean;
	readonly messages: readonly DesktopTranscriptItem[];
	readonly runs: readonly DesktopRunTiming[];
	readonly todos: DesktopTodos | undefined;
	readonly artifacts: readonly DesktopArtifact[];
	readonly usage: DesktopSessionUsage;
	readonly configuration: DesktopSessionConfiguration | undefined;
}

interface QueuedMessageSteerOperation {
	readonly message: QueuedMessage;
	readonly sessionId: string;
	readonly modelRef: string;
	steer(input: {
		readonly sessionId: string;
		readonly message: string;
		readonly modelRef: string;
		readonly controls: DesktopSessionControls;
	}): Promise<void>;
	onAccepted(messageId: string): void;
	onRejected(error: unknown): void;
}

const EMPTY_STATE: ChatRuntimeState = {
	agentStatus: "idle",
	error: undefined,
	operationFailure: undefined,
	connectionStatus: undefined,
	isLoading: false,
	lastSeq: 0,
	sessionId: null,
	submitting: false,
	stopping: false,
	messages: [],
	runs: [],
	todos: undefined,
	artifacts: [],
	usage: EMPTY_DESKTOP_SESSION_USAGE,
	configuration: undefined,
};

const MODEL_UNAVAILABLE: DesktopFailure = {
	code: "provider.model_unavailable",
	retryable: false,
	action: "choose_model",
};
// ponytail: local send rejections without a dedicated code (attachments while running, pending queue, Session not ready) use `request.failed`; add codes if the composer notice needs specific copy.
const SEND_REJECTED: DesktopFailure = { code: "request.failed", retryable: true };

let dispatcher: ReturnType<typeof createDesktopAgentEventDispatcher> | undefined;

/** First candidate that is still enabled, else the first enabled model; disabled picks fall back silently. */
export function resolveChatModelRef(
	candidates: readonly (string | undefined)[],
	availableModelRefs: readonly string[],
): string {
	return (
		candidates.find((candidate) => candidate !== undefined && availableModelRefs.includes(candidate)) ??
		availableModelRefs[0] ??
		""
	);
}

export function shouldDispatchQueueHead(previous: DesktopAgentStatus, current: DesktopAgentStatus): boolean {
	return previous === "running" && current === "idle";
}

export async function runQueuedMessageSteer(operation: QueuedMessageSteerOperation): Promise<boolean> {
	try {
		await operation.steer({
			sessionId: operation.sessionId,
			message: operation.message.text,
			modelRef: operation.modelRef,
			controls: operation.message.controls,
		});
		operation.onAccepted(operation.message.id);
		return true;
	} catch (error) {
		operation.onRejected(error);
		return false;
	}
}

/**
 * Adapts the Desktop RPC snapshot/event stream into the UI-facing subset of
 * the AI SDK useChat contract. Zustand state is deliberately injected through
 * options rather than read here.
 */
export function useChat(options: UseChatOptions): Chat {
	const [state, setState] = useState<ChatRuntimeState>(EMPTY_STATE);
	// Renderer-only: a dismissed failure returns after reload because the snapshot re-derives it from the journal.
	const [dismissedOperationIds, setDismissedOperationIds] = useState<ReadonlySet<string>>(() => new Set());
	const latestOptions = useRef(options);
	const stateRef = useRef(state);
	const dispatchingQueueIdRef = useRef<string | undefined>(undefined);
	const blockedQueueIdRef = useRef<string | undefined>(undefined);
	const previousAgentStatusRef = useRef<DesktopAgentStatus>("idle");
	const pendingTranscriptRef = useRef(new Map<string, PendingTranscriptUpsert>());
	const transcriptFlushFrameRef = useRef<number | undefined>(undefined);
	const sessionConfiguration = state.sessionId === options.id ? state.configuration : undefined;
	const modelRef = resolveChatModelRef([sessionConfiguration?.modelRef, options.modelRef], options.availableModelRefs);
	const controls = sessionConfiguration?.controls ?? options.controls;
	latestOptions.current = { ...options, modelRef, controls };
	stateRef.current = state;

	const flushPendingTranscript = useCallback(() => {
		const pending = pendingTranscriptRef.current;
		if (pending.size === 0) return;
		pendingTranscriptRef.current = new Map();
		if (transcriptFlushFrameRef.current !== undefined) {
			cancelScheduledTranscriptFlush(transcriptFlushFrameRef.current);
			transcriptFlushFrameRef.current = undefined;
		}
		setState((current) => applyTranscriptUpsertBatch(current, [...pending.values()]));
	}, []);
	const queueTranscriptUpsert = useCallback(
		(update: PendingTranscriptUpsert) => {
			pendingTranscriptRef.current.set(update.item.id, update);
			if (isCompletedAssistantMessage(update.item)) {
				flushPendingTranscript();
				return;
			}
			if (transcriptFlushFrameRef.current !== undefined) return;
			transcriptFlushFrameRef.current = scheduleTranscriptFlush(() => {
				transcriptFlushFrameRef.current = undefined;
				flushPendingTranscript();
			});
		},
		[flushPendingTranscript],
	);

	useEffect(() => {
		const sessionId = options.id;
		dispatchingQueueIdRef.current = undefined;
		blockedQueueIdRef.current = undefined;
		previousAgentStatusRef.current = "idle";
		pendingTranscriptRef.current.clear();
		if (transcriptFlushFrameRef.current !== undefined) {
			cancelScheduledTranscriptFlush(transcriptFlushFrameRef.current);
			transcriptFlushFrameRef.current = undefined;
		}

		if (!sessionId) {
			setState(EMPTY_STATE);
			return;
		}

		const keepLive = stateRef.current.submitting && stateRef.current.sessionId === null;
		setState(
			keepLive
				? { ...stateRef.current, error: undefined, isLoading: false, sessionId }
				: {
						agentStatus: "idle",
						error: undefined,
						operationFailure: undefined,
						connectionStatus: undefined,
						isLoading: true,
						lastSeq: 0,
						sessionId,
						submitting: false,
						stopping: false,
						messages: [],
						runs: [],
						todos: undefined,
						artifacts: [],
						usage: EMPTY_DESKTOP_SESSION_USAGE,
						configuration: undefined,
					},
		);
		dispatcher ??= createDesktopAgentEventDispatcher();
		const unsubscribe = dispatcher.subscribe(sessionId, (update) => {
			if (update.type === "event" && update.envelope.event.type === "transcript_upsert") {
				queueTranscriptUpsert({
					seq: update.envelope.seq,
					item: update.envelope.event.item,
				});
				return;
			}
			flushPendingTranscript();
			setState((current) => applyChatProjectionUpdate(current, update));
		});
		void dispatcher.refresh(sessionId).catch((error) => {
			setState((previous) =>
				previous.sessionId !== sessionId
					? previous
					: withChatError(previous, getDesktopRemoteRpcFailure(error), { isLoading: false }),
			);
		});
		return () => {
			unsubscribe();
			pendingTranscriptRef.current.clear();
			if (transcriptFlushFrameRef.current !== undefined) {
				cancelScheduledTranscriptFlush(transcriptFlushFrameRef.current);
				transcriptFlushFrameRef.current = undefined;
			}
		};
	}, [flushPendingTranscript, options.id, queueTranscriptUpsert]);

	const dispatchQueueHead = useCallback(async () => {
		const current = stateRef.current;
		const latest = latestOptions.current;
		const head = latest.queue[0];
		if (!head || !current.sessionId || current.agentStatus !== "idle") return;
		if (head.id === blockedQueueIdRef.current || dispatchingQueueIdRef.current) return;
		const headModelRef = resolveChatModelRef([head.modelRef, latest.modelRef], latest.availableModelRefs);
		if (!headModelRef) {
			blockedQueueIdRef.current = head.id;
			setState((previous) => withChatError(previous, MODEL_UNAVAILABLE, { submitting: false }));
			return;
		}

		dispatchingQueueIdRef.current = head.id;
		setState((previous) => ({ ...previous, error: undefined, submitting: true }));
		try {
			await desktop.agent.send({
				sessionId: current.sessionId,
				message: head.text,
				modelRef: headModelRef,
				controls: head.controls,
			});
			latest.onQueuedMessageAccepted(head.id);
		} catch (error) {
			blockedQueueIdRef.current = head.id;
			setState((previous) => withChatError(previous, getDesktopRemoteRpcFailure(error), { submitting: false }));
		} finally {
			dispatchingQueueIdRef.current = undefined;
		}
	}, []);

	useEffect(() => {
		const previousAgentStatus = previousAgentStatusRef.current;
		previousAgentStatusRef.current = state.agentStatus;
		if (shouldDispatchQueueHead(previousAgentStatus, state.agentStatus)) {
			void dispatchQueueHead();
		}
	}, [dispatchQueueHead, state.agentStatus]);

	useEffect(() => {
		const headId = options.queue[0]?.id;
		if (!blockedQueueIdRef.current || headId === blockedQueueIdRef.current) return;
		blockedQueueIdRef.current = undefined;
		void dispatchQueueHead();
	}, [dispatchQueueHead, options.queue]);

	const sendMessage = useCallback(
		async ({ text: rawText, controls, attachments = [], delivery = "queue" }: ChatMessageInput): Promise<boolean> => {
			const text = rawText.trim();
			const fallbackFirstMessage =
				text || `Attached ${attachments.length} file${attachments.length === 1 ? "" : "s"}`;
			const current = stateRef.current;
			const latest = latestOptions.current;
			if ((!text && attachments.length === 0) || current.submitting) return false;

			if (current.agentStatus === "running") {
				if (attachments.length > 0 || !current.sessionId) {
					setState((previous) => withChatError(previous, SEND_REJECTED));
					return false;
				}
				if (!latest.modelRef) {
					setState((previous) => withChatError(previous, MODEL_UNAVAILABLE));
					return false;
				}
				if (delivery === "queue") {
					latest.onMessageQueued(text, controls, latest.modelRef);
					latest.onMessageAccepted(current.sessionId);
					return true;
				}
				try {
					await desktop.agent.steer({
						sessionId: current.sessionId,
						message: text,
						modelRef: latest.modelRef,
						controls,
					});
					latest.onMessageAccepted(current.sessionId);
					return true;
				} catch (error) {
					setState((previous) => withChatError(previous, getDesktopRemoteRpcFailure(error)));
					return false;
				}
			}
			if (latest.queue.length > 0) {
				setState((previous) => withChatError(previous, SEND_REJECTED));
				return false;
			}
			if (!latest.modelRef) {
				setState((previous) => withChatError(previous, MODEL_UNAVAILABLE));
				return false;
			}

			setState((previous) => ({ ...previous, error: undefined, submitting: true }));
			try {
				if (current.sessionId) {
					await desktop.agent.send({
						sessionId: current.sessionId,
						message: text,
						modelRef: latest.modelRef,
						controls,
						attachments: attachments.length > 0 ? attachments : undefined,
					});
					latest.onMessageAccepted(current.sessionId);
					return true;
				}

				const session = await desktop.session.create({
					projectId: latest.newSessionProjectId,
					firstMessage: fallbackFirstMessage,
				});
				upsertRecentSession(session);
				latest.onSessionCreated(session.id);
				await desktop.agent.send({
					sessionId: session.id,
					message: text,
					modelRef: latest.modelRef,
					controls,
					attachments: attachments.length > 0 ? attachments : undefined,
				});
				latest.onMessageAccepted(session.id);
				void invalidateRecentSessions();
				return true;
			} catch (error) {
				setState((previous) => withChatError(previous, getDesktopRemoteRpcFailure(error), { submitting: false }));
				return false;
			}
		},
		[],
	);

	const steerQueuedMessage = useCallback(async (message: QueuedMessage): Promise<boolean> => {
		const current = stateRef.current;
		const latest = latestOptions.current;
		const modelRef = resolveChatModelRef([message.modelRef, latest.modelRef], latest.availableModelRefs);
		if (!current.sessionId || current.agentStatus !== "running" || !modelRef) return false;
		return runQueuedMessageSteer({
			message,
			sessionId: current.sessionId,
			modelRef,
			steer: async (input) => {
				await desktop.agent.steer(input);
			},
			onAccepted: latest.onQueuedMessageAccepted,
			onRejected: (error) => {
				setState((previous) => withChatError(previous, getDesktopRemoteRpcFailure(error)));
			},
		});
	}, []);

	const stop = useCallback(async () => {
		const current = stateRef.current;
		if (!current.sessionId || current.agentStatus !== "running" || current.stopping) return;
		setState((previous) => ({ ...previous, error: undefined, stopping: true }));
		try {
			await desktop.agent.abort(current.sessionId);
		} catch (error) {
			setState((previous) => withChatError(previous, getDesktopRemoteRpcFailure(error), { stopping: false }));
		}
	}, []);

	const navigate = useCallback(async (entryId: string): Promise<boolean> => {
		const current = stateRef.current;
		const latest = latestOptions.current;
		if (!current.sessionId || !latest.modelRef || current.agentStatus === "running" || current.submitting) {
			return false;
		}
		try {
			await desktop.agent.navigate({
				sessionId: current.sessionId,
				entryId,
				modelRef: latest.modelRef,
				controls: latest.controls,
			});
			await dispatcher?.refresh(current.sessionId);
			return true;
		} catch {
			return false;
		}
	}, []);

	const resolvePermission = useCallback(async (resolution: DesktopPermissionResolution) => {
		try {
			await desktop.agent.resolvePermission(resolution);
		} catch (error) {
			setState((previous) => withChatError(previous, getDesktopRemoteRpcFailure(error)));
		}
	}, []);

	const notice = resolveChatNotice(state, dismissedOperationIds);
	const dismissNotice = () => {
		if (notice?.kind === "operation" && notice.operationId) {
			const operationId = notice.operationId;
			setDismissedOperationIds((current) => new Set(current).add(operationId));
		} else if (notice?.kind === "operation") {
			setState((previous) => ({ ...previous, operationFailure: undefined }));
		} else if (notice?.kind === "send") {
			setState((previous) => ({ ...previous, error: undefined }));
		}
	};

	const retry = useCallback(async (): Promise<DesktopFailure | undefined> => {
		const sessionId = stateRef.current.sessionId;
		const latest = latestOptions.current;
		if (!latest.modelRef) return MODEL_UNAVAILABLE;
		if (!sessionId) return undefined;
		try {
			await desktop.agent.retry({ sessionId, modelRef: latest.modelRef, controls: latest.controls });
			await dispatcher?.refresh(sessionId);
			return undefined;
		} catch (error) {
			return getDesktopRemoteRpcFailure(error);
		}
	}, []);

	const configure = useCallback(async (selection: DesktopSessionConfiguration): Promise<void> => {
		const sessionId = stateRef.current.sessionId;
		if (!sessionId) return;
		setState((previous) => (previous.sessionId === sessionId ? { ...previous, configuration: selection } : previous));
		try {
			await desktop.agent.configure({ sessionId, ...selection });
		} catch (error) {
			setState((previous) => withChatError(previous, getDesktopRemoteRpcFailure(error)));
			void dispatcher?.refresh(sessionId);
		}
	}, []);

	const retryConnection = useCallback(async (): Promise<void> => {
		try {
			await desktop.agent.retryConnection();
		} catch {
			setState((current) => ({ ...current, connectionStatus: "restart_failed" }));
		}
	}, []);

	return {
		id: options.id,
		messages: state.messages,
		runs: state.runs,
		todos: state.todos,
		artifacts: state.artifacts,
		usage: state.usage,
		status: getChatStatus(state),
		isLoading: state.isLoading,
		notice,
		modelRef,
		controls,
		configure,
		sendMessage,
		steerQueuedMessage,
		stop,
		navigate,
		retry,
		retryConnection,
		resolvePermission,
		dismissNotice,
	};
}

export function applyChatProjectionUpdate(
	state: ChatRuntimeState,
	update: DesktopAgentProjectionUpdate,
): ChatRuntimeState {
	if (update.type === "snapshot") return snapshotState(update.snapshot);
	return applyAgentEvent(state, update.envelope.seq, update.envelope.event);
}

interface PendingTranscriptUpsert {
	readonly seq: number;
	readonly item: DesktopTranscriptItem;
}

export function applyTranscriptUpsertBatch(
	state: ChatRuntimeState,
	updates: readonly PendingTranscriptUpsert[],
): ChatRuntimeState {
	const merged = mergeTranscriptUpserts(updates);
	if (merged.length === 0) return state;
	let messages = state.messages;
	let lastSeq = state.lastSeq;
	for (const update of merged) {
		messages = upsertMessage(messages, update.item);
		lastSeq = Math.max(lastSeq, update.seq);
	}
	return { ...state, isLoading: false, lastSeq, messages };
}

export function mergeTranscriptUpserts(
	updates: readonly PendingTranscriptUpsert[],
): readonly PendingTranscriptUpsert[] {
	const latest = new Map<string, PendingTranscriptUpsert>();
	for (const update of updates) latest.set(update.item.id, update);
	return [...latest.values()];
}

function applyAgentEvent(state: ChatRuntimeState, seq: number, event: DesktopAgentEvent): ChatRuntimeState {
	switch (event.type) {
		case "status":
			return {
				...state,
				agentStatus: event.status,
				operationFailure: event.failure ? { failure: event.failure, operationId: event.operationId } : undefined,
				error: event.status === "running" ? undefined : state.error,
				isLoading: false,
				lastSeq: seq,
				submitting: event.status === "running" ? false : state.submitting,
				stopping: event.status === "idle" ? false : state.stopping,
			};
		case "connection_status":
			return {
				...state,
				isLoading: false,
				lastSeq: seq,
				connectionStatus: event.status,
				submitting: event.status === "reconnecting" ? false : state.submitting,
				stopping: event.status === "reconnecting" ? false : state.stopping,
			};
		case "model_catalog_updated":
			return { ...state, lastSeq: seq };
		case "connector_oauth_completed":
		case "connector_oauth_failed":
		case "subagent_transcript_changed":
			return { ...state, lastSeq: seq };
		case "transcript_upsert":
			return applyTranscriptUpsertBatch(state, [{ seq, item: event.item }]);
		case "transcript_remove":
			return {
				...state,
				lastSeq: seq,
				messages: state.messages.filter((item) => item.id !== event.id),
			};
		case "run_upsert":
			return {
				...state,
				lastSeq: seq,
				runs: [...state.runs.filter((run) => run.operationId !== event.run.operationId), event.run],
			};
		case "todos_replace":
			return { ...state, isLoading: false, lastSeq: seq, todos: event.todos };
		case "artifact_upsert":
			return {
				...state,
				isLoading: false,
				lastSeq: seq,
				artifacts: upsertArtifact(state.artifacts, event.artifact),
			};
		case "usage_changed":
			return { ...state, isLoading: false, lastSeq: seq, usage: event.usage };
		case "configuration_changed":
			return { ...state, lastSeq: seq, configuration: event.configuration };
	}
}

function isCompletedAssistantMessage(item: DesktopTranscriptItem): boolean {
	return item.kind === "message" && item.role === "assistant" && item.status === "complete";
}

function scheduleTranscriptFlush(callback: () => void): number {
	if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
		return window.requestAnimationFrame(callback);
	}
	return setTimeout(callback, 16) as unknown as number;
}

function cancelScheduledTranscriptFlush(handle: number): void {
	if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
		window.cancelAnimationFrame(handle);
		return;
	}
	clearTimeout(handle);
}

function withChatError(
	state: ChatRuntimeState,
	error: DesktopFailure,
	patch: Partial<ChatRuntimeState> = {},
): ChatRuntimeState {
	return { ...state, ...patch, error };
}

function snapshotState(snapshot: DesktopAgentSnapshot): ChatRuntimeState {
	return {
		agentStatus: snapshot.status,
		error: undefined,
		operationFailure: snapshot.failure ? { failure: snapshot.failure, operationId: snapshot.operationId } : undefined,
		connectionStatus: snapshot.connectionStatus,
		isLoading: false,
		lastSeq: snapshot.lastSeq,
		sessionId: snapshot.sessionId,
		submitting: false,
		stopping: false,
		messages: [...snapshot.items],
		runs: [...snapshot.runs],
		todos: snapshot.todos,
		artifacts: [...snapshot.artifacts],
		usage: snapshot.usage,
		configuration: snapshot.configuration,
	};
}

function getChatStatus(state: ChatRuntimeState): ChatStatus {
	if (state.stopping) return "stopping";
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

function upsertArtifact(artifacts: readonly DesktopArtifact[], artifact: DesktopArtifact): readonly DesktopArtifact[] {
	const current = artifacts.filter((candidate) => candidate.id !== artifact.id);
	return [...current, artifact].toSorted((left, right) => right.updatedAt - left.updatedAt);
}
