import { create } from "zustand";

export interface QueuedMessage {
	readonly id: string;
	readonly text: string;
}

interface DesktopChatStore {
	activeSessionId: string | null;
	drafts: Record<string, string>;
	queue: QueuedMessage[];
	selectedWorkspaceId: string | null;
	selectedModelRef: string;
	openSession(sessionId: string): void;
	newChat(): void;
	setDraft(value: string): void;
	sessionCreated(sessionId: string): void;
	acceptDraft(): void;
	enqueueMessage(text: string): void;
	acceptQueuedMessage(messageId: string): void;
	editQueuedMessage(messageId: string): void;
	removeQueuedMessage(messageId: string): void;
	reorderQueuedMessages(orderedIds: readonly string[]): void;
	setSelectedWorkspaceId(workspaceId: string | null): void;
	setSelectedModelRef(modelRef: string): void;
}

const NEW_CHAT_DRAFT_KEY = "__new_chat__";

export const useDesktopChatStore = create<DesktopChatStore>((set, get) => ({
	activeSessionId: null,
	drafts: {},
	queue: [],
	selectedWorkspaceId: null,
	selectedModelRef: "",

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

	acceptDraft() {
		const key = draftKey(get().activeSessionId);
		set((state) => ({ drafts: { ...state.drafts, [key]: "" } }));
	},

	enqueueMessage(text) {
		const key = draftKey(get().activeSessionId);
		set((state) => ({
			drafts: { ...state.drafts, [key]: "" },
			queue: [...state.queue, { id: crypto.randomUUID(), text }],
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
		if (!message) return;
		const key = draftKey(state.activeSessionId);
		set({
			drafts: { ...state.drafts, [key]: message.text },
			queue: state.queue.filter((candidate) => candidate.id !== messageId),
		});
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

	setSelectedWorkspaceId(selectedWorkspaceId) {
		set({ selectedWorkspaceId });
	},

	setSelectedModelRef(selectedModelRef) {
		set({ selectedModelRef });
	},
}));

export function selectDraft(state: Pick<DesktopChatStore, "activeSessionId" | "drafts">): string {
	return state.drafts[draftKey(state.activeSessionId)] ?? "";
}

function draftKey(sessionId: string | null): string {
	return sessionId ?? NEW_CHAT_DRAFT_KEY;
}
