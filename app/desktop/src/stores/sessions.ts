import type { PermissionResolution } from "@jai/coding/permissions/approval";
import { TaggedError } from "better-result";
import { create } from "zustand";
import type {
	DesktopAgentEvent,
	DesktopAgentSnapshot,
	DesktopAgentStatus,
	DesktopTranscriptItem,
} from "../../shared/desktop-rpc";
import { desktop } from "../lib/desktop";
import { createDesktopAgentEventDispatcher, type DesktopAgentProjectionUpdate } from "../lib/desktop-agent";
import { invalidateRecentSessions, upsertRecentSession } from "../lib/desktop-query";

class NoActiveSession extends TaggedError("desktop_session_store.no_active_session")<{ readonly message: string }> {}

interface ActiveSessionState {
	sessionId: string | null;
	status: DesktopAgentStatus;
	items: DesktopTranscriptItem[];
	lastSeq: number;
	loading: boolean;
	error?: string;
	open(sessionId: string): void;
	newChat(): void;
	createAndSend(workspaceId: string | null, message: string, modelRef: string): Promise<string>;
	send(message: string, modelRef: string): Promise<void>;
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

	async createAndSend(workspaceId, message, modelRef) {
		const session = await desktop.session.create({ workspaceId, firstMessage: message });
		upsertRecentSession(session);
		get().open(session.id);
		await desktop.agent.send({ sessionId: session.id, message, modelRef });
		void invalidateRecentSessions();
		return session.id;
	},

	async send(message, modelRef) {
		const sessionId = requireActiveSession(get().sessionId);
		await desktop.agent.send({ sessionId, message, modelRef });
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

function getDispatcher() {
	dispatcher ??= createDesktopAgentEventDispatcher();
	return dispatcher;
}

function requireActiveSession(sessionId: string | null): string {
	if (sessionId) return sessionId;
	throw new NoActiveSession({
		message: "No active Session",
	});
}
