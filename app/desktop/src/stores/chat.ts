import type { AGUIEvent, ConfigResponse, ProviderSettings } from "@jayden/jai-gateway";
import { AGUIEventType } from "@jayden/jai-gateway/events";
import { nanoid } from "nanoid";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { gateway } from "@/services/gateway";
import type {
	ChatAttachment,
	ChatItem,
	ChatMessage,
	ChatMessagePart,
	ChatMessageRole,
	ChatStatus,
	CompactionItem,
} from "@/types/chat";
import { useSessionStore } from "./session";

export interface ModelCapabilities {
	reasoning?: boolean;
	toolCall?: boolean;
	structuredOutput?: boolean;
	vision?: boolean;
	imageGen?: boolean;
	audio?: boolean;
	pdf?: boolean;
}

export interface ModelItem {
	id: string;
	provider: string;
	displayName: string;
	capabilities?: ModelCapabilities;
}

function flattenModels(config: ConfigResponse): ModelItem[] {
	const items: ModelItem[] = [];
	if (config.providers) {
		for (const [providerId, pc] of Object.entries(config.providers) as [string, ProviderSettings][]) {
			if (!pc.enabled) continue;
			for (const m of pc.models) {
				const isString = typeof m === "string";
				const modelId = isString ? m : m.id;
				const entry = isString ? undefined : m;
				const caps = entry?.capabilities;

				items.push({
					id: `${providerId}/${modelId}`,
					provider: providerId,
					displayName: modelId,
					capabilities: caps
						? {
								reasoning: caps.reasoning,
								toolCall: caps.toolCall,
								structuredOutput: caps.structuredOutput,
								vision: caps.input?.image,
								imageGen: caps.output?.image,
								audio: caps.input?.audio,
								pdf: caps.input?.pdf,
							}
						: undefined,
				});
			}
		}
	}
	if (items.length === 0) {
		items.push({
			id: config.model,
			provider: config.provider,
			displayName: config.model.split("/").pop() ?? config.model,
		});
	}
	return items;
}

function appendTextToParts(parts: ChatMessagePart[], partType: "text" | "reasoning", text: string): ChatMessagePart[] {
	const last = parts[parts.length - 1];
	if (last?.type === partType) {
		return [...parts.slice(0, -1), { ...last, text: (last.text ?? "") + text }];
	}
	return [...parts, { type: partType, text }];
}

function updateMessageById(items: ChatItem[], id: string, updater: (msg: ChatMessage) => ChatMessage): ChatItem[] {
	return items.map((m) => (m.kind === "message" && m.id === id ? updater(m) : m));
}

function mapMessages(items: ChatItem[], fn: (msg: ChatMessage) => ChatMessage): ChatItem[] {
	return items.map((m) => (m.kind === "message" ? fn(m) : m));
}

interface GatewayMessage {
	role: "user" | "assistant" | "tool_result";
	content: Array<{
		type: "text" | "thinking" | "tool_call" | "image";
		text?: string;
		toolCallId?: string;
		toolName?: string;
		input?: unknown;
	}>;
}

interface GatewayCompactionMarker {
	id: string;
	timestamp: number;
	beforeMessageIndex: number;
}

/**
 * Convert backend messages + compaction markers into a flat ChatItem timeline.
 * Compactions are inserted such that `beforeMessageIndex` messages have been
 * emitted before each marker (i.e. the marker appears BEFORE the first kept
 * message that followed the summary).
 */
function convertGatewayMessages(raw: GatewayMessage[], compactions: GatewayCompactionMarker[] = []): ChatItem[] {
	const toolResults = new Map<string, string>();
	for (const msg of raw) {
		if (msg.role !== "tool_result") continue;
		const id = (msg as { toolCallId?: string }).toolCallId;
		const text = msg.content?.find((c) => c.type === "text")?.text;
		if (id && text) toolResults.set(id, text);
	}

	const chatMessages: ChatMessage[] = [];
	for (const msg of raw) {
		if (msg.role === "tool_result") continue;

		const parts: ChatMessagePart[] = [];
		for (const block of msg.content) {
			if (block.type === "text" && block.text) {
				parts.push({ type: "text", text: block.text });
			} else if (block.type === "thinking" && block.text) {
				parts.push({ type: "reasoning", text: block.text });
			} else if (block.type === "tool_call") {
				const toolCallId = block.toolCallId ?? "";
				parts.push({
					type: "tool_call",
					toolCall: {
						toolCallId,
						name: block.toolName ?? "",
						status: "completed",
						args: block.input != null ? JSON.stringify(block.input) : undefined,
						result: toolResults.get(toolCallId),
					},
				});
			}
		}

		if (parts.length > 0) {
			chatMessages.push({ kind: "message", id: nanoid(), role: msg.role as ChatMessageRole, parts });
		}
	}

	// Interleave compaction markers by beforeMessageIndex (stable, in order).
	const sorted = [...compactions].sort((a, b) => a.beforeMessageIndex - b.beforeMessageIndex);
	const items: ChatItem[] = [];
	let cIdx = 0;
	for (let i = 0; i <= chatMessages.length; i++) {
		while (cIdx < sorted.length && sorted[cIdx].beforeMessageIndex === i) {
			const m = sorted[cIdx++];
			items.push({ kind: "compaction", id: m.id, status: "done", timestamp: m.timestamp });
		}
		if (i < chatMessages.length) items.push(chatMessages[i]);
	}
	return items;
}

interface ChatState {
	messages: ChatItem[];
	status: ChatStatus;
	currentModelId: string | null;
	availableModels: ModelItem[];
	sessionId: string | null;
	reasoningEffort: string | null;
	contextTokens: number;
	contextWindow: number;
	/**
	 * Monotonic counter bumped every time `loadSession` finishes populating
	 * a historical conversation. The chat view watches it to jump the
	 * scroll container to the bottom without animation, sidestepping the
	 * pin-to-user-message behavior that only makes sense for live sends.
	 */
	scrollBottomToken: number;

	syncModels: (config: ConfigResponse) => void;
	sendMessage: (text: string, attachments?: ChatAttachment[]) => Promise<void>;
	stop: () => void;
	setModel: (modelId: string) => void;
	setReasoningEffort: (effort: string | null) => void;
	newChat: () => void;
	loadSession: (info: { sessionId: string; title?: string }) => Promise<void>;
}

let abortController: AbortController | null = null;
let currentAssistantId: string | null = null;
let currentCompactionId: string | null = null;

/**
 * Streaming smoothing buffer.
 *
 * Raw LLM tokens arrive bursty (network jitter + provider batching). Writing
 * every delta straight to React causes a "一顿一顿" feel. Instead we
 * accumulate TEXT / REASONING deltas per-message and flush to the store on a
 * fixed ~120ms cadence so each visible update is a short phrase, not a single
 * character — which also makes the `@starting-style` block-entrance animation
 * land on a coherent unit rather than on each token.
 *
 * Invariants:
 *  - Any non-text structural event (TOOL_CALL_START / REASONING_END /
 *    COMPACTION_* / TEXT_MESSAGE_END / RUN_ERROR) must flush the buffer for
 *    the current assistant message first, so visual order matches event
 *    order.
 *  - `sendMessage` drains all buffers when the stream ends.
 */
const FLUSH_INTERVAL_MS = 120;

interface TextBuffer {
	text: string;
	reasoning: string;
	timer: ReturnType<typeof setTimeout> | null;
}

const textBuffers = new Map<string, TextBuffer>();

function getOrCreateBuffer(msgId: string): TextBuffer {
	let buf = textBuffers.get(msgId);
	if (!buf) {
		buf = { text: "", reasoning: "", timer: null };
		textBuffers.set(msgId, buf);
	}
	return buf;
}

function flushBuffer(msgId: string, get: () => ChatState, set: (partial: Partial<ChatState>) => void): void {
	const buf = textBuffers.get(msgId);
	if (!buf) return;
	if (buf.timer !== null) {
		clearTimeout(buf.timer);
		buf.timer = null;
	}
	const { text, reasoning } = buf;
	buf.text = "";
	buf.reasoning = "";
	if (!text && !reasoning) return;

	set({
		messages: updateMessageById(get().messages, msgId, (msg) => {
			let parts = msg.parts;
			if (text) parts = appendTextToParts(parts, "text", text);
			if (reasoning) parts = appendTextToParts(parts, "reasoning", reasoning);
			return { ...msg, parts };
		}),
	});
}

function scheduleFlush(msgId: string, get: () => ChatState, set: (partial: Partial<ChatState>) => void): void {
	const buf = getOrCreateBuffer(msgId);
	if (buf.timer !== null) return;
	buf.timer = setTimeout(() => {
		flushBuffer(msgId, get, set);
	}, FLUSH_INTERVAL_MS);
}

function flushAllBuffers(get: () => ChatState, set: (partial: Partial<ChatState>) => void): void {
	for (const msgId of Array.from(textBuffers.keys())) {
		flushBuffer(msgId, get, set);
	}
	textBuffers.clear();
}

function ensureAssistantMessage(get: () => ChatState, set: (partial: Partial<ChatState>) => void): string {
	if (currentAssistantId) return currentAssistantId;
	const id = nanoid();
	currentAssistantId = id;
	set({ messages: [...get().messages, { kind: "message", id, role: "assistant", parts: [] }] });
	return id;
}

function handleSSEEvent(event: AGUIEvent, get: () => ChatState, set: (partial: Partial<ChatState>) => void): void {
	// Text/reasoning deltas are buffered for smoothing (see FLUSH_INTERVAL_MS).
	// Every other event must observe the already-buffered text first, otherwise
	// a tool-call card could render above text that arrived earlier in time.
	const isBufferedEvent =
		event.type === AGUIEventType.TEXT_MESSAGE_CONTENT || event.type === AGUIEventType.REASONING_CONTENT;
	if (!isBufferedEvent && currentAssistantId) {
		flushBuffer(currentAssistantId, get, set);
	}

	switch (event.type) {
		case AGUIEventType.TEXT_MESSAGE_START: {
			ensureAssistantMessage(get, set);
			break;
		}
		case AGUIEventType.TEXT_MESSAGE_CONTENT: {
			const msgId = currentAssistantId;
			if (!msgId) break;
			const buf = getOrCreateBuffer(msgId);
			buf.text += event.delta;
			scheduleFlush(msgId, get, set);
			break;
		}
		case AGUIEventType.REASONING_START: {
			ensureAssistantMessage(get, set);
			break;
		}
		case AGUIEventType.REASONING_CONTENT: {
			const msgId = currentAssistantId;
			if (!msgId) break;
			const buf = getOrCreateBuffer(msgId);
			buf.reasoning += event.delta;
			scheduleFlush(msgId, get, set);
			break;
		}
		case AGUIEventType.TOOL_CALL_START: {
			const msgId = ensureAssistantMessage(get, set);
			const toolCall: ChatMessagePart["toolCall"] = {
				toolCallId: event.toolCallId,
				name: event.toolCallName,
				status: "running",
			};
			set({
				messages: updateMessageById(get().messages, msgId, (msg) => ({
					...msg,
					parts: [...msg.parts, { type: "tool_call", toolCall }],
				})),
			});
			break;
		}
		case AGUIEventType.TOOL_CALL_ARGS: {
			set({
				messages: mapMessages(get().messages, (msg) => ({
					...msg,
					parts: msg.parts.map((part) =>
						part.type === "tool_call" && part.toolCall?.toolCallId === event.toolCallId
							? { ...part, toolCall: { ...part.toolCall, args: (part.toolCall.args ?? "") + event.delta } }
							: part,
					),
				})),
			});
			break;
		}
		case AGUIEventType.TOOL_CALL_RESULT: {
			set({
				messages: mapMessages(get().messages, (msg) => ({
					...msg,
					parts: msg.parts.map((part) =>
						part.type === "tool_call" && part.toolCall?.toolCallId === event.toolCallId
							? { ...part, toolCall: { ...part.toolCall, result: event.content } }
							: part,
					),
				})),
			});
			break;
		}
		case AGUIEventType.TOOL_CALL_END: {
			set({
				messages: mapMessages(get().messages, (msg) => ({
					...msg,
					parts: msg.parts.map((part) =>
						part.type === "tool_call" && part.toolCall?.toolCallId === event.toolCallId
							? { ...part, toolCall: { ...part.toolCall, status: "completed" as const } }
							: part,
					),
				})),
			});
			break;
		}
		case AGUIEventType.PERMISSION_REQUEST: {
			set({
				messages: mapMessages(get().messages, (msg) => ({
					...msg,
					parts: msg.parts.map((part) => {
						if (part.type !== "tool_call") return part;
						if (part.toolCall?.toolCallId !== event.toolCallId) return part;
						return {
							...part,
							toolCall: {
								...part.toolCall,
								permission: {
									reqId: event.reqId,
									category: event.category,
									reason: event.reason,
									status: "pending" as const,
								},
							},
						};
					}),
				})),
			});
			break;
		}
		case AGUIEventType.PERMISSION_RESOLVED: {
			set({
				messages: mapMessages(get().messages, (msg) => ({
					...msg,
					parts: msg.parts.map((part) => {
						if (part.type !== "tool_call") return part;
						if (part.toolCall?.permission?.reqId !== event.reqId) return part;
						return {
							...part,
							toolCall: {
								...part.toolCall,
								permission: {
									...part.toolCall.permission,
									status: "resolved" as const,
									outcome: event.outcome,
								},
							},
						};
					}),
				})),
			});
			break;
		}
		case AGUIEventType.COMPACTION_START: {
			const id = nanoid();
			currentCompactionId = id;
			const placeholder: CompactionItem = {
				kind: "compaction",
				id,
				status: "streaming",
				timestamp: Date.now(),
			};
			set({ messages: [...get().messages, placeholder] });
			break;
		}
		case AGUIEventType.COMPACTION_END: {
			const id = currentCompactionId;
			if (!id) break;
			set({
				messages: get().messages.map((m) =>
					m.kind === "compaction" && m.id === id ? { ...m, status: "done" as const } : m,
				),
			});
			currentCompactionId = null;
			// Compaction rewrote history — the next assistant message belongs to
			// a fresh turn, force-allocate a new assistant bubble.
			currentAssistantId = null;
			break;
		}
		case AGUIEventType.RUN_ERROR: {
			const msgId = ensureAssistantMessage(get, set);
			set({
				status: "error",
				messages: updateMessageById(get().messages, msgId, (msg) => ({
					...msg,
					parts: [...msg.parts, { type: "error", text: String(event.message ?? "Unknown error") }],
				})),
			});
			break;
		}
		case AGUIEventType.TITLE_GENERATED: {
			useSessionStore.getState().setTitle(event.title);
			useSessionStore.getState().updateSessionTitle(get().sessionId!, event.title);
			break;
		}
		case AGUIEventType.USAGE_UPDATE: {
			set({ contextTokens: event.contextTokens ?? event.inputTokens ?? 0 });
			break;
		}
	}
}

export const useChatStore = create<ChatState>((set, get) => ({
	messages: [],
	status: "ready",
	currentModelId: null,
	availableModels: [],
	sessionId: null,
	reasoningEffort: null,
	contextTokens: 0,
	contextWindow: 0,
	scrollBottomToken: 0,

	syncModels(config: ConfigResponse) {
		const models = flattenModels(config);
		set({ availableModels: models, contextWindow: config.contextWindow ?? 0 });

		const current = get().currentModelId;
		if (models.length > 0 && (!current || !models.some((m) => m.id === current))) {
			set({ currentModelId: models.find((m) => m.id === config.model)?.id ?? models[0].id });
		}

		if (config.reasoningEffort !== undefined) {
			set({ reasoningEffort: config.reasoningEffort ?? null });
		}
	},

	async sendMessage(text: string, attachments?: ChatAttachment[]) {
		const { status, sessionId, currentModelId } = get();
		const trimmedText = text.trim();
		const attachmentList = attachments ?? [];
		const hasAttachments = attachmentList.length > 0;
		if ((!trimmedText && !hasAttachments) || status === "streaming" || status === "submitted") return;

		const parts: ChatMessagePart[] = [];
		if (trimmedText) {
			parts.push({ type: "text", text: trimmedText });
		}
		if (hasAttachments) {
			for (const att of attachmentList) {
				parts.push({ type: "attachment", attachment: att });
			}
		}

		const userMessage: ChatMessage = {
			kind: "message",
			id: nanoid(),
			role: "user",
			parts,
		};
		set({ status: "submitted", messages: [...get().messages, userMessage] });
		currentAssistantId = null;
		currentCompactionId = null;

		const isNewChat = !sessionId;

		try {
			let sid = sessionId;
			if (!sid) {
				await gateway.waitForReady();
				const session = await gateway.sessions.create();
				sid = session.sessionId;
				set({ sessionId: sid });
				useSessionStore.getState().setTitle("Untitled");
			}

			set({ status: "streaming" });

			const controller = new AbortController();
			abortController = controller;

			const rawAttachments = attachmentList.map((a) => ({
				filename: a.filename,
				data: a.dataUrl ? a.dataUrl.replace(/^data:[^;]+;base64,/, "") : "",
				mimeType: a.mimeType,
				size: a.size,
			}));

			await gateway.messages.send(sid, trimmedText, {
				onEvent: (event) => handleSSEEvent(event, get, set),
				modelId: currentModelId ?? undefined,
				reasoningEffort: get().reasoningEffort ?? undefined,
				signal: controller.signal,
				attachments: rawAttachments.length ? rawAttachments : undefined,
			});
		} catch (err) {
			flushAllBuffers(get, set);
			console.error("[gateway] prompt failed:", err);
			const errorText = err instanceof Error ? err.message : String(err);
			const errorMsgId = currentAssistantId ?? nanoid();
			if (!currentAssistantId) {
				set({
					messages: [...get().messages, { kind: "message", id: errorMsgId, role: "assistant", parts: [] }],
				});
			}
			set({
				status: "error",
				messages: updateMessageById(get().messages, errorMsgId, (msg) => ({
					...msg,
					parts: [...msg.parts, { type: "error", text: errorText }],
				})),
			});
			return;
		}

		flushAllBuffers(get, set);
		abortController = null;
		set({ status: "ready" });
		if (isNewChat) {
			useSessionStore.getState().fetchSessions();
		}
	},

	stop() {
		flushAllBuffers(get, set);
		abortController?.abort();
		abortController = null;
		const { sessionId } = get();
		if (sessionId) {
			gateway.messages.abort(sessionId).catch(() => {});
		}
		set({ status: "ready" });
	},

	setModel(modelId: string) {
		set({ currentModelId: modelId });
		gateway.config
			.update({ model: modelId })
			.then((config) => {
				const models = flattenModels(config);
				const confirmed = models.find((m) => m.id === config.model)?.id ?? modelId;
				set({ currentModelId: confirmed, availableModels: models, contextWindow: config.contextWindow ?? 0 });
			})
			.catch((err) => {
				console.error("[chat] failed to persist model selection:", err);
			});
	},

	setReasoningEffort(effort: string | null) {
		set({ reasoningEffort: effort });
		gateway.config.update({ reasoningEffort: effort ?? undefined }).catch(() => {});
	},

	newChat() {
		flushAllBuffers(get, set);
		set({
			sessionId: null,
			messages: [],
			status: "ready",
			contextTokens: 0,
		});
		currentAssistantId = null;
		currentCompactionId = null;
		useSessionStore.getState().setTitle(null);
	},

	async loadSession(info) {
		if (get().sessionId === info.sessionId) return;

		flushAllBuffers(get, set);
		set({
			messages: [],
			status: "ready",
			sessionId: info.sessionId,
			contextTokens: 0,
		});
		currentAssistantId = null;
		currentCompactionId = null;
		useSessionStore.getState().setTitle(info.title ?? null);

		try {
			const [result, sessionInfo] = await Promise.all([
				gateway.messages.get(info.sessionId),
				gateway.sessions.get(info.sessionId),
			]);
			const converted = convertGatewayMessages(
				result.messages as GatewayMessage[],
				(result.compactions ?? []) as GatewayCompactionMarker[],
			);
			set((s) => ({
				messages: converted,
				contextTokens: sessionInfo.lastInputTokens ?? 0,
				scrollBottomToken: s.scrollBottomToken + 1,
			}));
		} catch (err) {
			console.error("[gateway] loadSession messages failed:", err);
		}
	},
}));

export interface PendingPermissionView {
	permission: ToolPermissionState;
	toolCallId: string;
	toolName: string;
}

export function usePendingPermission(): PendingPermissionView | null {
	return useChatStore(
		useShallow((state) => {
			for (const item of state.messages) {
				if (item.kind !== "message") continue;
				for (const part of item.parts) {
					if (part.type !== "tool_call" || !part.toolCall) continue;
					const perm = part.toolCall.permission;
					if (perm?.status === "pending") {
						return {
							permission: perm,
							toolCallId: part.toolCall.toolCallId,
							toolName: part.toolCall.name,
						};
					}
				}
			}
			return null;
		}),
	);
}

type ToolPermissionState = NonNullable<NonNullable<ChatMessagePart["toolCall"]>["permission"]>;

if (import.meta.env.DEV && typeof window !== "undefined") {
	(window as unknown as { __chatStore: typeof useChatStore }).__chatStore = useChatStore;
}
