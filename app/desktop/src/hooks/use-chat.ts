import { useCallback, useEffect, useRef, useState } from "react";
import { desktop, getDesktopRemoteRpcFailure } from "@/lib/desktop";
import { createDesktopAgentEventDispatcher, type DesktopAgentProjectionUpdate } from "@/lib/desktop-agent";
import { invalidateRecentSessions, upsertRecentSession } from "@/lib/desktop-query";
import type { QueuedMessage } from "@/stores/chat";
import type {
	DesktopAgentCreationFailureReason,
	DesktopAgentEvent,
	DesktopAgentMode,
	DesktopAgentSnapshot,
	DesktopAgentStatus,
	DesktopArtifact,
	DesktopMessageAttachment,
	DesktopPermissionResolution,
	DesktopTodos,
	DesktopTranscriptItem,
} from "../../shared/desktop-rpc";

export type ChatStatus = "ready" | "submitted" | "streaming" | "error";

export interface ChatMessageInput {
	readonly text: string;
	readonly mode: DesktopAgentMode;
	readonly attachments?: readonly DesktopMessageAttachment[];
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
	readonly artifacts: readonly DesktopArtifact[];
	readonly status: ChatStatus;
	readonly isLoading: boolean;
	readonly error: string | undefined;
	sendMessage(message: ChatMessageInput): Promise<boolean>;
	stop(): Promise<void>;
	clearError(): void;
	resolvePermission(resolution: DesktopPermissionResolution): Promise<void>;
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
	readonly artifacts: readonly DesktopArtifact[];
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
	artifacts: [],
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
			artifacts: [],
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
		} catch (error) {
			const failure = getDesktopRemoteRpcFailure(error);
			setState((previous) => ({
				...previous,
				error: chatFailureMessage({ operation: "queue", code: failure?.tag, reason: failure?.reason }),
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

	const sendMessage = useCallback(
		async ({ text: rawText, mode, attachments = [] }: ChatMessageInput): Promise<boolean> => {
			const text = rawText.trim();
			const fallbackFirstMessage =
				text || `Attached ${attachments.length} file${attachments.length === 1 ? "" : "s"}`;
			const current = stateRef.current;
			const latest = latestOptions.current;
			if ((!text && attachments.length === 0) || current.submitting) return false;

			if (current.agentStatus === "running") {
				if (attachments.length > 0) {
					setState((previous) => ({
						...previous,
						error: "请等待当前响应结束后再发送附件。",
					}));
					return false;
				}
				latest.onMessageQueued(text, mode);
				return true;
			}
			if (latest.queue.length > 0) {
				setState((previous) => ({ ...previous, error: "请先处理队列中的消息。" }));
				return false;
			}
			if (!latest.modelRef) {
				setState((previous) => ({ ...previous, error: "请先选择可用模型。" }));
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
						...(attachments.length > 0 ? { attachments } : {}),
					});
					latest.onDraftAccepted();
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
					...(attachments.length > 0 ? { attachments } : {}),
				});
				latest.onDraftAccepted();
				void invalidateRecentSessions();
				return true;
			} catch (error) {
				const failure = getDesktopRemoteRpcFailure(error);
				setState((previous) => ({
					...previous,
					error: chatFailureMessage({ operation: "message", code: failure?.tag, reason: failure?.reason }),
					submitting: false,
				}));
				return false;
			}
		},
		[],
	);

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

	const resolvePermission = useCallback(async (resolution: DesktopPermissionResolution) => {
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
		artifacts: state.artifacts,
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
		case "transcript_remove":
			return {
				...state,
				lastSeq: seq,
				messages: state.messages.filter((item) => item.id !== event.id),
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
		case "runtime_error":
			return {
				...state,
				agentStatus: "idle",
				error: chatFailureMessage({ operation: "runtime", code: event.error.code }),
				isLoading: false,
				lastSeq: seq,
				submitting: false,
			};
	}
}

export function chatFailureMessage(input: {
	readonly code?: string;
	readonly operation: "message" | "queue" | "runtime";
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

function defaultChatFailureMessage(operation: "message" | "queue" | "runtime"): string {
	switch (operation) {
		case "queue":
			return "队列消息未发送。请稍后重试。";
		case "runtime":
			return "当前响应未完成。请重试。";
		case "message":
			return "消息未发送。请稍后重试。";
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
		artifacts: [...snapshot.artifacts],
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

function upsertArtifact(artifacts: readonly DesktopArtifact[], artifact: DesktopArtifact): readonly DesktopArtifact[] {
	const current = artifacts.filter((candidate) => candidate.id !== artifact.id);
	return [...current, artifact].toSorted((left, right) => right.updatedAt - left.updatedAt);
}
