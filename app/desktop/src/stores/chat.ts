import { create } from "zustand";
import type { DesktopAgentMode } from "../../shared/desktop-rpc";

/** A queued message keeps the model and mode it was queued with, independent of the run in progress. */
export interface QueuedMessage {
	readonly id: string;
	readonly text: string;
	readonly mode: DesktopAgentMode;
	readonly modelRef: string;
}

interface DesktopChatStore {
	activeSessionId: string | null;
	drafts: Record<string, string>;
	queue: QueuedMessage[];
	selectedProjectId: string | null;
	/** null until the user picks one this run; the Runtime Host remembers the last pick across launches. */
	selectedModelRef: string | null;
	selectedAgentMode: DesktopAgentMode | null;
	openSession(sessionId: string): void;
	newChat(): void;
	setDraft(value: string): void;
	clearDraft(sessionId: string): void;
	sessionCreated(sessionId: string): void;
	enqueueMessage(text: string, mode: DesktopAgentMode, modelRef: string): void;
	acceptQueuedMessage(messageId: string): void;
	/** Moves the message back into the draft and returns it so its model and mode can be restored. */
	editQueuedMessage(messageId: string): QueuedMessage | undefined;
	removeQueuedMessage(messageId: string): void;
	reorderQueuedMessages(orderedIds: readonly string[]): void;
	setSelectedProjectId(projectId: string | null): void;
	setSelectedModelRef(modelRef: string): void;
	setSelectedAgentMode(mode: DesktopAgentMode): void;
}

const NEW_CHAT_DRAFT_KEY = "__new_chat__";

export const useDesktopChatStore = create<DesktopChatStore>((set, get) => ({
	activeSessionId: null,
	drafts: {},
	queue: [],
	selectedProjectId: null,
	selectedModelRef: null,
	selectedAgentMode: null,

	openSession(sessionId) {
		if (get().activeSessionId === sessionId) return;
		set({ activeSessionId: sessionId, queue: [] });
	},

	newChat() {
		if (get().activeSessionId === null) return;
		set({ activeSessionId: null, queue: [] });
	},

	setDraft(value) {
		const key = draftKey(get().activeSessionId);
		set((state) => ({ drafts: { ...state.drafts, [key]: value } }));
	},

	clearDraft(sessionId) {
		set((state) => ({
			drafts: { ...state.drafts, [sessionId]: "" },
		}));
	},

	sessionCreated(sessionId) {
		const state = get();
		const newChatDraft = state.drafts[NEW_CHAT_DRAFT_KEY] ?? "";
		set({
			activeSessionId: sessionId,
			drafts: {
				...state.drafts,
				[sessionId]: newChatDraft,
				[NEW_CHAT_DRAFT_KEY]: "",
			},
			queue: [],
		});
	},

	enqueueMessage(text, mode, modelRef) {
		set((state) => ({
			queue: [...state.queue, { id: crypto.randomUUID(), text, mode, modelRef }],
		}));
	},

	acceptQueuedMessage(messageId) {
		set((state) => ({
			queue: state.queue.filter((message) => message.id !== messageId),
		}));
	},

	editQueuedMessage(messageId) {
		const state = get();
		const message = state.queue.find((candidate) => candidate.id === messageId);
		if (!message) return undefined;
		const key = draftKey(state.activeSessionId);
		set({
			drafts: { ...state.drafts, [key]: message.text },
			queue: state.queue.filter((candidate) => candidate.id !== messageId),
		});
		return message;
	},

	removeQueuedMessage(messageId) {
		set((state) => ({
			queue: state.queue.filter((message) => message.id !== messageId),
		}));
	},

	reorderQueuedMessages(orderedIds) {
		set((state) => {
			const messages = new Map(state.queue.map((message) => [message.id, message]));
			const ordered = orderedIds.flatMap((id) => {
				const message = messages.get(id);
				return message ? [message] : [];
			});
			if (ordered.length !== state.queue.length) return {};
			return { queue: ordered };
		});
	},

	setSelectedProjectId(selectedProjectId) {
		set({ selectedProjectId });
	},

	setSelectedModelRef(selectedModelRef) {
		set({ selectedModelRef });
	},

	setSelectedAgentMode(selectedAgentMode) {
		set({ selectedAgentMode });
	},
}));

export function selectDraft(state: Pick<DesktopChatStore, "activeSessionId" | "drafts">): string {
	return state.drafts[draftKey(state.activeSessionId)] ?? "";
}

function draftKey(sessionId: string | null): string {
	return sessionId ?? NEW_CHAT_DRAFT_KEY;
}
