import type { DesktopAgentEventEnvelope, DesktopAgentSnapshot } from "../../shared/desktop-rpc";
import { invalidateRecentSessions } from "./desktop-query";

export type DesktopAgentProjectionUpdate =
	| { readonly type: "snapshot"; readonly snapshot: DesktopAgentSnapshot }
	| { readonly type: "event"; readonly envelope: DesktopAgentEventEnvelope };

export type DesktopAgentProjectionListener = (update: DesktopAgentProjectionUpdate) => void;

export class DesktopAgentEventDispatcher {
	readonly #listeners = new Map<string, Set<DesktopAgentProjectionListener>>();
	readonly #lastSeq = new Map<string, number>();
	readonly #refreshes = new Map<string, Promise<void>>();
	readonly #pending = new Map<string, DesktopAgentEventEnvelope>();
	readonly #stopBridge: () => void;

	constructor(
		onEvent: (listener: (event: DesktopAgentEventEnvelope) => void) => () => void,
		readonly loadSnapshot: (sessionId: string) => Promise<DesktopAgentSnapshot>,
	) {
		this.#stopBridge = onEvent((envelope) => this.#dispatch(envelope));
	}

	subscribe(sessionId: string, listener: DesktopAgentProjectionListener): () => void {
		const listeners = this.#listeners.get(sessionId) ?? new Set();
		listeners.add(listener);
		this.#listeners.set(sessionId, listeners);
		void this.refresh(sessionId);
		return () => {
			listeners.delete(listener);
			if (listeners.size === 0) {
				this.#listeners.delete(sessionId);
				this.#lastSeq.delete(sessionId);
			}
		};
	}

	refresh(sessionId: string): Promise<void> {
		const active = this.#refreshes.get(sessionId);
		if (active) return active;
		const refresh = this.loadSnapshot(sessionId)
			.then((snapshot) => {
				if (!this.#listeners.has(sessionId)) return;
				this.#lastSeq.set(sessionId, snapshot.lastSeq);
				this.#notify(sessionId, { type: "snapshot", snapshot });
			})
			.finally(() => {
				this.#refreshes.delete(sessionId);
				const pending = this.#pending.get(sessionId);
				this.#pending.delete(sessionId);
				if (pending) this.#dispatch(pending);
			});
		this.#refreshes.set(sessionId, refresh);
		return refresh;
	}

	close(): void {
		this.#stopBridge();
		this.#listeners.clear();
		this.#lastSeq.clear();
		this.#refreshes.clear();
		this.#pending.clear();
	}

	#dispatch(envelope: DesktopAgentEventEnvelope): void {
		if (envelope.event.type === "status") void invalidateRecentSessions();
		if (envelope.event.type === "model_catalog_updated") {
			for (const sessionId of this.#listeners.keys()) void this.refresh(sessionId);
			return;
		}
		if (!this.#listeners.has(envelope.sessionId)) return;
		if (this.#refreshes.has(envelope.sessionId)) {
			const pending = this.#pending.get(envelope.sessionId);
			if (!pending || envelope.seq > pending.seq) this.#pending.set(envelope.sessionId, envelope);
			return;
		}
		const lastSeq = this.#lastSeq.get(envelope.sessionId);
		if (lastSeq === undefined || envelope.seq > lastSeq + 1) {
			void this.refresh(envelope.sessionId);
			return;
		}
		if (envelope.seq <= lastSeq) return;
		this.#lastSeq.set(envelope.sessionId, envelope.seq);
		this.#notify(envelope.sessionId, { type: "event", envelope });
	}

	#notify(sessionId: string, update: DesktopAgentProjectionUpdate): void {
		for (const listener of this.#listeners.get(sessionId) ?? []) listener(update);
	}
}

export function createDesktopAgentEventDispatcher(): DesktopAgentEventDispatcher {
	return new DesktopAgentEventDispatcher(
		(listener) => window.desktopRpc.onAgentEvent(listener),
		async (sessionId) => {
			const { desktop } = await import("./desktop");
			return desktop.agent.getSnapshot(sessionId);
		},
	);
}
