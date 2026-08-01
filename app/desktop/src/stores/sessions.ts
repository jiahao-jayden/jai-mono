import type { CodingSession, SessionListCursor } from "@jai/coding/business";
import type { PermissionResolution } from "@jai/coding/permissions/approval";
import { defineCodedError, getErrorMessage } from "@jai/common";
import { create } from "zustand";
import type {
	DesktopAgentEvent,
	DesktopAgentSnapshot,
	DesktopAgentStatus,
	DesktopTranscriptItem,
} from "../../shared/desktop-rpc";
import { desktop } from "../lib/desktop";
import { createDesktopAgentEventDispatcher, type DesktopAgentProjectionUpdate } from "../lib/desktop-agent";

const sessionStoreError = defineCodedError("desktop_session_store", ["no_active_session"] as const);

interface SessionListState {
	sessions: CodingSession[];
	runningSessionIds: string[];
	nextCursor?: SessionListCursor;
	loading: boolean;
	error?: string;
	refresh(): Promise<void>;
	loadMore(): Promise<void>;
}

export const useSessionListStore = create<SessionListState>((set, get) => ({
	sessions: [],
	runningSessionIds: [],
	loading: false,

	async refresh() {
		set({ loading: true, error: undefined });
		try {
			const page = await desktop.session.list({ limit: 50 });
			set({
				sessions: orderSessions(page.sessions, page.runningSessionIds),
				runningSessionIds: [...page.runningSessionIds],
				nextCursor: page.nextCursor,
				loading: false,
			});
		} catch (error) {
			set({ loading: false, error: getErrorMessage(error) });
		}
	},

	async loadMore() {
		const cursor = get().nextCursor;
		if (!cursor || get().loading) return;
		set({ loading: true, error: undefined });
		try {
			const page = await desktop.session.list({ limit: 50, cursor });
			const sessions = mergeSessions(get().sessions, page.sessions);
			set({
				sessions: orderSessions(sessions, page.runningSessionIds),
				runningSessionIds: [...page.runningSessionIds],
				nextCursor: page.nextCursor,
				loading: false,
			});
		} catch (error) {
			set({ loading: false, error: getErrorMessage(error) });
		}
	},
}));

interface ActiveSessionState {
	sessionId: string | null;
	status: DesktopAgentStatus;
	items: DesktopTranscriptItem[];
	lastSeq: number;
	loading: boolean;
	error?: string;
	open(sessionId: string): void;
	newChat(): void;
	createAndSend(workspaceId: string | null, message: string): Promise<string>;
	send(message: string): Promise<void>;
	abort(): Promise<void>;
	resolvePermission(resolution: PermissionResolution): Promise<void>;
}

let activeSubscription: (() => void) | undefined;
let dispatcher: ReturnType<typeof createDesktopAgentEventDispatcher> | undefined;

export const useActiveSessionStore = create<ActiveSessionState>((set, get) => ({
	sessionId: null,
	status: "idle",
	items: [],
	lastSeq: 0,
	loading: false,

	open(sessionId) {
		activeSubscription?.();
		set({
			sessionId,
			status: "idle",
			items: [],
			lastSeq: 0,
			loading: true,
			error: undefined,
		});
		activeSubscription = getDispatcher().subscribe(sessionId, (update) => {
			set((state) => applyProjectionUpdate(state, update));
		});
	},

	newChat() {
		activeSubscription?.();
		activeSubscription = undefined;
		set({
			sessionId: null,
			status: "idle",
			items: [],
			lastSeq: 0,
			loading: false,
			error: undefined,
		});
	},

	async createAndSend(workspaceId, message) {
		const session = await desktop.session.create({ workspaceId, firstMessage: message });
		get().open(session.id);
		await desktop.agent.send({ sessionId: session.id, message });
		void useSessionListStore.getState().refresh();
		return session.id;
	},

	async send(message) {
		const sessionId = requireActiveSession(get().sessionId);
		await desktop.agent.send({ sessionId, message });
	},

	async abort() {
		const sessionId = requireActiveSession(get().sessionId);
		await desktop.agent.abort(sessionId);
	},

	async resolvePermission(resolution) {
		await desktop.agent.resolvePermission(resolution);
	},
}));

export function applyProjectionUpdate(
	state: Pick<ActiveSessionState, "sessionId" | "status" | "items" | "lastSeq" | "loading" | "error">,
	update: DesktopAgentProjectionUpdate,
): Partial<ActiveSessionState> {
	if (update.type === "snapshot") {
		return snapshotState(update.snapshot);
	}
	return applyAgentEvent(state, update.envelope.seq, update.envelope.event);
}

function applyAgentEvent(
	state: Pick<ActiveSessionState, "status" | "items" | "lastSeq">,
	seq: number,
	event: DesktopAgentEvent,
): Partial<ActiveSessionState> {
	switch (event.type) {
		case "status":
			void useSessionListStore.getState().refresh();
			return { status: event.status, lastSeq: seq, loading: false };
		case "transcript_upsert":
			return {
				items: upsertTranscriptItem(state.items, event.item),
				lastSeq: seq,
				loading: false,
			};
		case "runtime_error":
			return {
				status: "idle",
				lastSeq: seq,
				loading: false,
				error: event.error.message,
			};
	}
}

function snapshotState(snapshot: DesktopAgentSnapshot): Partial<ActiveSessionState> {
	return {
		sessionId: snapshot.sessionId,
		status: snapshot.status,
		items: [...snapshot.items],
		lastSeq: snapshot.lastSeq,
		loading: false,
		error: undefined,
	};
}

function upsertTranscriptItem(
	items: readonly DesktopTranscriptItem[],
	item: DesktopTranscriptItem,
): DesktopTranscriptItem[] {
	const index = items.findIndex((candidate) => candidate.id === item.id);
	if (index < 0) return [...items, item];
	const next = [...items];
	next[index] = item;
	return next;
}

function orderSessions(sessions: readonly CodingSession[], runningSessionIds: readonly string[]): CodingSession[] {
	const running = new Set(runningSessionIds);
	return [...sessions].sort((left, right) => {
		const runningDifference = Number(running.has(right.id)) - Number(running.has(left.id));
		return runningDifference || right.lastActivityAt - left.lastActivityAt || right.id.localeCompare(left.id);
	});
}

function mergeSessions(current: readonly CodingSession[], incoming: readonly CodingSession[]): CodingSession[] {
	const byId = new Map(current.map((session) => [session.id, session]));
	for (const session of incoming) byId.set(session.id, session);
	return [...byId.values()];
}

function getDispatcher() {
	dispatcher ??= createDesktopAgentEventDispatcher();
	return dispatcher;
}

function requireActiveSession(sessionId: string | null): string {
	if (sessionId) return sessionId;
	throw sessionStoreError("no_active_session", {
		message: "No active Session",
	});
}
