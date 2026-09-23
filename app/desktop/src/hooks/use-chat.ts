import { useCallback, useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { desktop, getDesktopRemoteRpcFailure } from "@/lib/desktop";
import { createDesktopAgentEventDispatcher, type DesktopAgentProjectionUpdate } from "@/lib/desktop-agent";
import { invalidateRecentSessions, upsertRecentSession } from "@/lib/desktop-query";
import type { QueuedMessage } from "@/stores/chat";
import type {
	DesktopAgentConnectionStatus,
	DesktopAgentCreationFailureReason,
	DesktopAgentEvent,
	DesktopAgentMode,
	DesktopAgentSnapshot,
	DesktopAgentStatus,
	DesktopAgentStopReason,
	DesktopArtifact,
	DesktopMessageAttachment,
	DesktopPermissionResolution,
	DesktopRunTiming,
	DesktopSessionConfiguration,
	DesktopSessionUsage,
	DesktopTodos,
	DesktopTranscriptItem,
} from "../../shared/desktop-rpc";
import { EMPTY_DESKTOP_SESSION_USAGE } from "../../shared/desktop-rpc";

export type ChatStatus = "ready" | "submitted" | "streaming" | "stopping" | "error";

export interface ChatMessageInput {
	readonly text: string;
	readonly mode: DesktopAgentMode;
	readonly attachments?: readonly DesktopMessageAttachment[];
	readonly delivery?: "queue" | "steer";
}

export interface UseChatOptions {
	readonly id: string | null;
	readonly newSessionProjectId: string | null;
	/** Preferred model when the Session has none of its own (new chats, or its model was disabled). */
	readonly modelRef: string;
	readonly mode: DesktopAgentMode;
	readonly availableModelRefs: readonly string[];
	readonly queue: readonly QueuedMessage[];
	onSessionCreated(sessionId: string): void;
	onMessageAccepted(sessionId: string): void;
	onMessageQueued(text: string, mode: DesktopAgentMode, modelRef: string): void;
	onQueuedMessageAccepted(messageId: string): void;
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
	readonly error: string | undefined;
	readonly errorKey: number;
	readonly connectionStatus: DesktopAgentConnectionStatus | undefined;
	readonly stopReason: DesktopAgentStopReason | undefined;
	/** Model and mode the next message will use. */
	readonly modelRef: string;
	readonly mode: DesktopAgentMode;
	configure(selection: DesktopSessionConfiguration): Promise<void>;
	sendMessage(message: ChatMessageInput): Promise<boolean>;
	steerQueuedMessage(message: QueuedMessage): Promise<boolean>;
	stop(): Promise<void>;
	navigate(entryId: string): Promise<boolean>;
	retryConnection(): Promise<void>;
	resolvePermission(resolution: DesktopPermissionResolution): Promise<void>;
	dismissError(): void;
}

export interface ChatRuntimeState {
	readonly agentStatus: DesktopAgentStatus;
	readonly error: string | undefined;
	readonly errorKey: number;
	readonly connectionStatus: DesktopAgentConnectionStatus | undefined;
	readonly stopReason: DesktopAgentStopReason | undefined;
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
		readonly mode: DesktopAgentMode;
	}): Promise<void>;
	onAccepted(messageId: string): void;
	onRejected(error: unknown): void;
}

const EMPTY_STATE: ChatRuntimeState = {
	agentStatus: "idle",
	error: undefined,
	errorKey: 0,
	connectionStatus: undefined,
	stopReason: undefined,
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
			mode: operation.message.mode,
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
	const intl = useIntl();
	const projectRequiredMessage = intl.formatMessage(desktopMessages.composerProjectRequired);
	const [state, setState] = useState<ChatRuntimeState>(EMPTY_STATE);
	const latestOptions = useRef(options);
	const stateRef = useRef(state);
	const dispatchingQueueIdRef = useRef<string | undefined>(undefined);
	const blockedQueueIdRef = useRef<string | undefined>(undefined);
	const previousAgentStatusRef = useRef<DesktopAgentStatus>("idle");
	const pendingTranscriptRef = useRef(new Map<string, PendingTranscriptUpsert>());
	const transcriptFlushFrameRef = useRef<number | undefined>(undefined);
	const sessionConfiguration = state.sessionId === options.id ? state.configuration : undefined;
	const modelRef = resolveChatModelRef([sessionConfiguration?.modelRef, options.modelRef], options.availableModelRefs);
	const mode = sessionConfiguration?.mode ?? options.mode;
	latestOptions.current = { ...options, modelRef, mode };
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
						errorKey: 0,
						connectionStatus: undefined,
						stopReason: undefined,
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
			const failure = getDesktopRemoteRpcFailure(error);
			setState((previous) =>
				previous.sessionId !== sessionId
					? previous
					: {
							...previous,
							...withChatError(previous, chatFailureMessage({ operation: "load", code: failure?.tag }), {
								isLoading: false,
							}),
						},
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
		if (!head || !current.sessionId || current.agentStatus !== "idle" || current.error) return;
		if (head.id === blockedQueueIdRef.current || dispatchingQueueIdRef.current) return;
		const headModelRef = resolveChatModelRef([head.modelRef, latest.modelRef], latest.availableModelRefs);
		if (!headModelRef) {
			blockedQueueIdRef.current = head.id;
			setState((previous) => withChatError(previous, "请先选择可用模型。", { submitting: false }));
			return;
		}

		dispatchingQueueIdRef.current = head.id;
		setState((previous) => ({ ...previous, error: undefined, submitting: true }));
		try {
			await desktop.agent.send({
				sessionId: current.sessionId,
				message: head.text,
				modelRef: headModelRef,
				mode: head.mode,
			});
			latest.onQueuedMessageAccepted(head.id);
		} catch (error) {
			const failure = getDesktopRemoteRpcFailure(error);
			blockedQueueIdRef.current = head.id;
			setState((previous) =>
				withChatError(
					previous,
					failure?.tag === "desktop_agent.workspace_required"
						? projectRequiredMessage
						: chatFailureMessage({ operation: "queue", code: failure?.tag, reason: failure?.reason }),
					{ submitting: false },
				),
			);
		} finally {
			dispatchingQueueIdRef.current = undefined;
		}
	}, [projectRequiredMessage]);

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
		async ({ text: rawText, mode, attachments = [], delivery = "queue" }: ChatMessageInput): Promise<boolean> => {
			const text = rawText.trim();
			const fallbackFirstMessage =
				text || `Attached ${attachments.length} file${attachments.length === 1 ? "" : "s"}`;
			const current = stateRef.current;
			const latest = latestOptions.current;
			if ((!text && attachments.length === 0) || current.submitting) return false;

			if (current.agentStatus === "running") {
				if (attachments.length > 0) {
					setState((previous) => withChatError(previous, "请等待当前响应结束后再发送附件。"));
					return false;
				}
				if (!current.sessionId) {
					setState((previous) => withChatError(previous, "当前会话尚未准备好，请稍后重试。"));
					return false;
				}
				if (!latest.modelRef) {
					setState((previous) => withChatError(previous, "请先选择可用模型。"));
					return false;
				}
				if (delivery === "queue") {
					latest.onMessageQueued(text, mode, latest.modelRef);
					latest.onMessageAccepted(current.sessionId);
					return true;
				}
				try {
					await desktop.agent.steer({
						sessionId: current.sessionId,
						message: text,
						modelRef: latest.modelRef,
						mode,
					});
					latest.onMessageAccepted(current.sessionId);
					return true;
				} catch (error) {
					const failure = getDesktopRemoteRpcFailure(error);
					setState((previous) =>
						withChatError(
							previous,
							failure?.tag === "desktop_agent.workspace_required"
								? projectRequiredMessage
								: chatFailureMessage({ operation: "message", code: failure?.tag, reason: failure?.reason }),
						),
					);
					return false;
				}
			}
			if (latest.queue.length > 0) {
				setState((previous) => withChatError(previous, "请先处理队列中的消息。"));
				return false;
			}
			if (!latest.modelRef) {
				setState((previous) => withChatError(previous, "请先选择可用模型。"));
				return false;
			}

			setState((previous) => ({ ...previous, error: undefined, submitting: true }));
			try {
				if (current.sessionId) {
					await desktop.agent.send({
						sessionId: current.sessionId,
						message: text,
						modelRef: latest.modelRef,
						mode,
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
					mode,
					attachments: attachments.length > 0 ? attachments : undefined,
				});
				latest.onMessageAccepted(session.id);
				void invalidateRecentSessions();
				return true;
			} catch (error) {
				const failure = getDesktopRemoteRpcFailure(error);
				setState((previous) =>
					withChatError(
						previous,
						failure?.tag === "desktop_agent.workspace_required"
							? projectRequiredMessage
							: chatFailureMessage({ operation: "message", code: failure?.tag, reason: failure?.reason }),
						{ submitting: false },
					),
				);
				return false;
			}
		},
		[projectRequiredMessage],
	);

	const steerQueuedMessage = useCallback(
		async (message: QueuedMessage): Promise<boolean> => {
			const current = stateRef.current;
			const latest = latestOptions.current;
			const modelRef = resolveChatModelRef([message.modelRef, latest.modelRef], latest.availableModelRefs);
			if (!current.sessionId || current.agentStatus !== "running" || !modelRef) return false;
			return runQueuedMessageSteer({
				message,
				sessionId: current.sessionId,
				modelRef,
				steer: (input) => desktop.agent.steer(input),
				onAccepted: latest.onQueuedMessageAccepted,
				onRejected: (error) => {
					const failure = getDesktopRemoteRpcFailure(error);
					setState((previous) =>
						withChatError(
							previous,
							failure?.tag === "desktop_agent.workspace_required"
								? projectRequiredMessage
								: chatFailureMessage({ operation: "message", code: failure?.tag, reason: failure?.reason }),
						),
					);
				},
			});
		},
		[projectRequiredMessage],
	);

	const stop = useCallback(async () => {
		const current = stateRef.current;
		if (!current.sessionId || current.agentStatus !== "running" || current.stopping) return;
		setState((previous) => ({ ...previous, error: undefined, stopping: true }));
		try {
			await desktop.agent.abort(current.sessionId);
		} catch {
			setState((previous) => withChatError(previous, "未能停止当前响应。", { stopping: false }));
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
				mode: latest.mode,
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
		} catch {
			setState((previous) => withChatError(previous, "权限响应未提交。"));
		}
	}, []);

	const dismissError = useCallback(() => {
		const current = stateRef.current;
		if (!current.error) return;
		const next = { ...current, error: undefined };
		stateRef.current = next;
		setState(next);
		void dispatchQueueHead();
	}, [dispatchQueueHead]);

	const configure = useCallback(async (selection: DesktopSessionConfiguration): Promise<void> => {
		const sessionId = stateRef.current.sessionId;
		if (!sessionId) return;
		setState((previous) => (previous.sessionId === sessionId ? { ...previous, configuration: selection } : previous));
		try {
			await desktop.agent.configure({ sessionId, ...selection });
		} catch (error) {
			const failure = getDesktopRemoteRpcFailure(error);
			setState((previous) =>
				withChatError(
					previous,
					chatFailureMessage({ operation: "message", code: failure?.tag, reason: failure?.reason }),
				),
			);
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
		error: state.error,
		errorKey: state.errorKey,
		connectionStatus: state.connectionStatus,
		stopReason: state.stopReason,
		modelRef,
		mode,
		configure,
		sendMessage,
		steerQueuedMessage,
		stop,
		navigate,
		retryConnection,
		resolvePermission,
		dismissError,
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
				stopReason: event.stopReason,
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
		case "runtime_error":
			return withChatError(state, chatFailureMessage({ operation: "runtime", code: event.error.code }), {
				agentStatus: "idle",
				isLoading: false,
				lastSeq: seq,
				submitting: false,
				stopping: false,
			});
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

export function chatFailureMessage(input: {
	readonly code?: string;
	readonly operation: "message" | "queue" | "runtime" | "load";
	readonly reason?: DesktopAgentCreationFailureReason;
}): string {
	switch (input.code) {
		case "desktop_provider.missing_credentials":
		case "coding_sdk.missing_credentials":
			return "当前模型尚未配置凭证。请前往 Settings > Providers 完成配置。";
		case "desktop_provider.model_inventory_missing":
			return "此 Provider 尚未获取模型清单。请前往 Settings > Providers 获取模型后重试。";
		case "desktop_provider.model_not_verified":
			return "所选模型尚未完成能力验证。请在 Settings > Providers 选择可用模型。";
		case "desktop_provider.model_capability_unsupported":
			return "所选模型不支持 Agent 所需的工具调用能力。请更换模型。";
		case "desktop_provider.model_not_found":
			return "所选模型已不在 Provider 的最新清单中。请重新获取模型并选择可用模型。";
		case "desktop_provider.model_disabled":
			return "所选模型已被禁用。请在 Settings > Providers 启用后重试。";
		case "desktop_provider.profile_not_found":
			return "当前模型所属的 Provider 已不存在。请重新选择模型。";
		case "desktop_provider.profile_disabled":
			return "当前 Provider 已被禁用。请启用后重试。";
		case "desktop_provider.invalid_model_ref":
		case "coding_sdk.invalid_model_ref":
			return "所选模型无效。请重新选择模型。";
		case "desktop_session_catalog.project_path_invalid":
			return "关联的 Project 目录不可用。请重新关联后重试。";
		case "desktop_session_catalog.session_recovery_failed":
		case "desktop_agent.acp_request_failed":
			return "会话恢复失败。请重试；如果仍然失败，请重启应用。";
		case "coding_sdk.unsupported_provider":
		case "coding_sdk.invalid_provider_configuration":
			return "当前 Provider 配置无效。请前往 Settings > Providers 检查后重试。";
		case "desktop_agent.creation_failed":
			return agentCreationFailureMessage(input.reason);
		default:
			return defaultChatFailureMessage(input.operation);
	}
}

function agentCreationFailureMessage(reason: DesktopAgentCreationFailureReason | undefined): string {
	switch (reason) {
		case "model_unavailable":
			return "模型运行时未初始化。请重新选择模型后重试。";
		case "provider_configuration_invalid":
			return "当前 Provider 配置无效。请前往 Settings > Providers 检查后重试。";
		case "agent_initialization_failed":
		case undefined:
			return "Agent 未能启动。请重试；如果仍然失败，请重启应用。";
	}
}

function defaultChatFailureMessage(operation: "message" | "queue" | "runtime" | "load"): string {
	switch (operation) {
		case "queue":
			return "队列消息未发送。请稍后重试。";
		case "runtime":
			return "当前响应未完成。请重试。";
		case "load":
			return "会话恢复失败。请重试；如果仍然失败，请重启应用。";
		case "message":
			return "消息未发送。请稍后重试。";
	}
}

function withChatError(
	state: ChatRuntimeState,
	error: string,
	patch: Partial<ChatRuntimeState> = {},
): ChatRuntimeState {
	return { ...state, ...patch, error, errorKey: state.errorKey + 1 };
}

function snapshotState(snapshot: DesktopAgentSnapshot): ChatRuntimeState {
	return {
		agentStatus: snapshot.status,
		error: undefined,
		errorKey: 0,
		connectionStatus: snapshot.connectionStatus,
		stopReason: snapshot.stopReason,
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
	if (state.error) return "error";
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
