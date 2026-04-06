import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import { gateway, type SSEEvent } from "@/lib/gateway-client";
import { useSessionStore } from "@/stores/session";
import type { ChatMessage, ChatMessagePart, ChatStatus, ModelInfo } from "@/types/chat";

type SetMessages = React.Dispatch<React.SetStateAction<ChatMessage[]>>;

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

function ensureAssistantMessage(
	assistantIdRef: React.MutableRefObject<string | null>,
	setMessages: SetMessages,
): string {
	if (assistantIdRef.current) return assistantIdRef.current;
	const id = nanoid();
	assistantIdRef.current = id;
	setMessages((prev) => [...prev, { id, role: "assistant", parts: [] }]);
	return id;
}

function handleSSEEvent(
	event: SSEEvent,
	assistantIdRef: React.MutableRefObject<string | null>,
	setMessages: SetMessages,
	messageIdMap: React.MutableRefObject<Map<string, string>>,
): void {
	switch (event.type) {
		case "TEXT_MESSAGE_START": {
			const msgId = ensureAssistantMessage(assistantIdRef, setMessages);
			messageIdMap.current.set(event.messageId as string, msgId);
			break;
		}
		case "TEXT_MESSAGE_CONTENT": {
			const delta = event.delta as string;
			const msgId = assistantIdRef.current;
			if (!msgId) break;
			setMessages((prev) =>
				updateMessageById(prev, msgId, (msg) => ({
					...msg,
					parts: appendTextToParts(msg.parts, "text", delta),
				})),
			);
			break;
		}
		case "REASONING_START": {
			ensureAssistantMessage(assistantIdRef, setMessages);
			break;
		}
		case "REASONING_CONTENT": {
			const delta = event.delta as string;
			const msgId = assistantIdRef.current;
			if (!msgId) break;
			setMessages((prev) =>
				updateMessageById(prev, msgId, (msg) => ({
					...msg,
					parts: appendTextToParts(msg.parts, "reasoning", delta),
				})),
			);
			break;
		}
		case "TOOL_CALL_START": {
			const msgId = ensureAssistantMessage(assistantIdRef, setMessages);
			const toolCall: ChatMessagePart["toolCall"] = {
				toolCallId: event.toolCallId as string,
				name: event.toolCallName as string,
				status: "running",
			};
			setMessages((prev) =>
				updateMessageById(prev, msgId, (msg) => ({
					...msg,
					parts: [...msg.parts, { type: "tool_call", toolCall }],
				})),
			);
			break;
		}
		case "TOOL_CALL_END": {
			const toolCallId = event.toolCallId as string;
			setMessages((prev) =>
				prev.map((msg) => ({
					...msg,
					parts: msg.parts.map((part) =>
						part.type === "tool_call" && part.toolCall?.toolCallId === toolCallId
							? { ...part, toolCall: { ...part.toolCall, status: "completed" as const } }
							: part,
					),
				})),
			);
			break;
		}
		case "RUN_ERROR": {
			const msgId = ensureAssistantMessage(assistantIdRef, setMessages);
			setMessages((prev) =>
				updateMessageById(prev, msgId, (msg) => ({
					...msg,
					parts: appendTextToParts(msg.parts, "text", `\n\nError: ${event.message}`),
				})),
			);
			break;
		}
	}
}

export function useGatewayChat() {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [status, setStatus] = useState<ChatStatus>("ready");
	const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
	const [currentModelId, setCurrentModelId] = useState<string | null>(null);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const sessionIdRef = useRef<string | null>(null);
	const currentAssistantIdRef = useRef<string | null>(null);
	const messageIdMapRef = useRef(new Map<string, string>());
	const abortRef = useRef<AbortController | null>(null);
	const currentModelIdRef = useRef(currentModelId);
	currentModelIdRef.current = currentModelId;

	useEffect(() => {
		(async () => {
			try {
				await gateway.waitForReady();
				const { models } = await gateway.getModels();
				setAvailableModels(models);
				if (models.length > 0 && !currentModelIdRef.current) {
					setCurrentModelId(models[0].id);
				}
			} catch (err) {
				console.error("[gateway] init failed:", err);
			}
		})();
	}, []);

	const ensureSession = useCallback(async () => {
		if (sessionIdRef.current) return sessionIdRef.current;

		await gateway.waitForReady();

		const session = await gateway.createSession();
		sessionIdRef.current = session.sessionId;
		setSessionId(session.sessionId);

		return session.sessionId;
	}, []);

	const newChat = useCallback(() => {
		sessionIdRef.current = null;
		setSessionId(null);
		setMessages([]);
		setStatus("ready");
		currentAssistantIdRef.current = null;
		messageIdMapRef.current.clear();
		useSessionStore.getState().setTitle(null);
	}, []);

	const loadSession = useCallback(async (info: { sessionId: string; title?: string }) => {
		if (sessionIdRef.current === info.sessionId) return;

		setMessages([]);
		setStatus("ready");
		currentAssistantIdRef.current = null;
		messageIdMapRef.current.clear();
		sessionIdRef.current = info.sessionId;
		setSessionId(info.sessionId);
		useSessionStore.getState().setTitle(info.title ?? null);
	}, []);

	const sendMessage = useCallback(
		async (text: string) => {
			if (!text.trim() || status === "streaming" || status === "submitted") return;

			setStatus("submitted");

			try {
				const sid = await ensureSession();

				setMessages((prev) => [...prev, { id: nanoid(), role: "user", parts: [{ type: "text", text }] }]);

				currentAssistantIdRef.current = null;
				setStatus("streaming");

				const controller = new AbortController();
				abortRef.current = controller;

				await gateway.sendMessage(
					sid,
					text,
					(event) => handleSSEEvent(event, currentAssistantIdRef, setMessages, messageIdMapRef),
					controller.signal,
				);
			} catch (err) {
				console.error("[gateway] prompt failed:", err);
				setStatus("error");
				return;
			}

			abortRef.current = null;
			setStatus("ready");
		},
		[status, ensureSession],
	);

	const setModel = useCallback((modelId: string) => {
		setCurrentModelId(modelId);
	}, []);

	const stop = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		if (sessionIdRef.current) {
			gateway.abort(sessionIdRef.current).catch(() => {});
		}
		setStatus("ready");
	}, []);

	return {
		messages,
		sendMessage,
		status,
		stop,
		availableModels,
		currentModelId,
		setModel,
		sessionId,
		newChat,
		loadSession,
	};
}
