import type { ConfigResponse, ProviderSettings } from "@jayden/jai-gateway";
import { nanoid } from "nanoid";
import { create } from "zustand";
import { gateway, type SSEEvent } from "@/services/gateway";
import type { ChatAttachment, ChatMessage, ChatMessagePart, ChatMessageRole, ChatStatus } from "@/types/chat";
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

function updateMessageById(
	messages: ChatMessage[],
	id: string,
	updater: (msg: ChatMessage) => ChatMessage,
): ChatMessage[] {
	return messages.map((m) => (m.id === id ? updater(m) : m));
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

function convertGatewayMessages(raw: GatewayMessage[]): ChatMessage[] {
	const messages: ChatMessage[] = [];

	const toolResults = new Map<string, string>();
	for (const msg of raw) {
		if (msg.role !== "tool_result") continue;
		const id = (msg as { toolCallId?: string }).toolCallId;
		const text = msg.content?.find((c) => c.type === "text")?.text;
		if (id && text) toolResults.set(id, text);
	}

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
			messages.push({ id: nanoid(), role: msg.role as ChatMessageRole, parts });
		}
	}

	return messages;
}

interface ChatState {
	messages: ChatMessage[];
	status: ChatStatus;
	currentModelId: string | null;
	availableModels: ModelItem[];
	sessionId: string | null;
	reasoningEffort: string | null;

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

function ensureAssistantMessage(get: () => ChatState, set: (partial: Partial<ChatState>) => void): string {
	if (currentAssistantId) return currentAssistantId;
	const id = nanoid();
	currentAssistantId = id;
	set({ messages: [...get().messages, { id, role: "assistant", parts: [] }] });
	return id;
}

function handleSSEEvent(event: SSEEvent, get: () => ChatState, set: (partial: Partial<ChatState>) => void): void {
	switch (event.type) {
		case "TEXT_MESSAGE_START": {
			ensureAssistantMessage(get, set);
			break;
		}
		case "TEXT_MESSAGE_CONTENT": {
			const delta = event.delta as string;
			const msgId = currentAssistantId;
			if (!msgId) break;
			set({
				messages: updateMessageById(get().messages, msgId, (msg) => ({
					...msg,
					parts: appendTextToParts(msg.parts, "text", delta),
				})),
			});
			break;
		}
		case "REASONING_START": {
			ensureAssistantMessage(get, set);
			break;
		}
		case "REASONING_CONTENT": {
			const delta = event.delta as string;
			const msgId = currentAssistantId;
			if (!msgId) break;
			set({
				messages: updateMessageById(get().messages, msgId, (msg) => ({
					...msg,
					parts: appendTextToParts(msg.parts, "reasoning", delta),
				})),
			});
			break;
		}
		case "TOOL_CALL_START": {
			const msgId = ensureAssistantMessage(get, set);
			const toolCall: ChatMessagePart["toolCall"] = {
				toolCallId: event.toolCallId as string,
				name: event.toolCallName as string,
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
		case "TOOL_CALL_ARGS": {
			const toolCallId = event.toolCallId as string;
			const delta = event.delta as string;
			set({
				messages: get().messages.map((msg) => ({
					...msg,
					parts: msg.parts.map((part) =>
						part.type === "tool_call" && part.toolCall?.toolCallId === toolCallId
							? { ...part, toolCall: { ...part.toolCall, args: (part.toolCall.args ?? "") + delta } }
							: part,
					),
				})),
			});
			break;
		}
		case "TOOL_CALL_RESULT": {
			const toolCallId = event.toolCallId as string;
			const content = event.content as string;
			set({
				messages: get().messages.map((msg) => ({
					...msg,
					parts: msg.parts.map((part) =>
						part.type === "tool_call" && part.toolCall?.toolCallId === toolCallId
							? { ...part, toolCall: { ...part.toolCall, result: content } }
							: part,
					),
				})),
			});
			break;
		}
		case "TOOL_CALL_END": {
			const toolCallId = event.toolCallId as string;
			set({
				messages: get().messages.map((msg) => ({
					...msg,
					parts: msg.parts.map((part) =>
						part.type === "tool_call" && part.toolCall?.toolCallId === toolCallId
							? { ...part, toolCall: { ...part.toolCall, status: "completed" as const } }
							: part,
					),
				})),
			});
			break;
		}
		case "RUN_ERROR": {
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
		case "TITLE_GENERATED": {
			const title = event.title as string;
			useSessionStore.getState().setTitle(title);
			useSessionStore.getState().updateSessionTitle(get().sessionId!, title);
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

	syncModels(config: ConfigResponse) {
		const models = flattenModels(config);
		set({ availableModels: models });

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
		if (!text.trim() || status === "streaming" || status === "submitted") return;

		const parts: ChatMessagePart[] = [{ type: "text", text }];
		if (attachments?.length) {
			for (const att of attachments) {
				parts.push({ type: "attachment", attachment: att });
			}
		}

		const userMessage: ChatMessage = {
			id: nanoid(),
			role: "user",
			parts,
		};
		set({ status: "submitted", messages: [...get().messages, userMessage] });
		currentAssistantId = null;

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

			const rawAttachments = attachments?.map((a) => ({
				filename: a.filename,
				data: a.dataUrl ? a.dataUrl.replace(/^data:[^;]+;base64,/, "") : "",
				mimeType: a.mimeType,
				size: a.size,
			}));

			await gateway.messages.send(sid, text, {
				onEvent: (event) => handleSSEEvent(event, get, set),
				modelId: currentModelId ?? undefined,
				reasoningEffort: get().reasoningEffort ?? undefined,
				signal: controller.signal,
				attachments: rawAttachments?.length ? rawAttachments : undefined,
			});
		} catch (err) {
			console.error("[gateway] prompt failed:", err);
			const errorText = err instanceof Error ? err.message : String(err);
			const errorMsgId = currentAssistantId ?? nanoid();
			if (!currentAssistantId) {
				set({ messages: [...get().messages, { id: errorMsgId, role: "assistant", parts: [] }] });
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

		abortController = null;
		set({ status: "ready" });
		if (isNewChat) {
			useSessionStore.getState().fetchSessions();
		}
	},

	stop() {
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
				set({ currentModelId: confirmed, availableModels: models });
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
		set({
			sessionId: null,
			messages: [],
			status: "ready",
		});
		currentAssistantId = null;
		useSessionStore.getState().setTitle(null);
	},

	async loadSession(info) {
		if (get().sessionId === info.sessionId) return;

		set({
			messages: [],
			status: "ready",
			sessionId: info.sessionId,
		});
		currentAssistantId = null;
		useSessionStore.getState().setTitle(info.title ?? null);

		try {
			const { messages: raw } = await gateway.messages.get(info.sessionId);
			const converted = convertGatewayMessages(raw as GatewayMessage[]);
			set({ messages: converted });
		} catch (err) {
			console.error("[gateway] loadSession messages failed:", err);
		}
	},
}));
