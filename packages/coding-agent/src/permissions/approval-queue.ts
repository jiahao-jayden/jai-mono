import { permissionAbortedError } from "./errors";

/**
 * Serializes one live Operation's approval work (automatic review and user
 * prompts alike), so a Session shows at most one request at a time and a
 * cancelled Operation aborts whatever approval is in flight.
 */
export interface PermissionApprovalQueue {
	enqueue<T>(run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>;
	cancel(error: unknown): void;
}

/** Runs each approval immediately; a caller without a FIFO has nothing to serialize against. */
export const unqueuedApprovals: PermissionApprovalQueue = {
	enqueue: (run, signal) =>
		signal?.aborted
			? Promise.reject(permissionAbortedError("permission"))
			: run(signal ?? new AbortController().signal),
	cancel: () => {},
};

/** A small in-memory FIFO. It owns no durable facts and is scoped to one live Operation. */
export function createPermissionApprovalQueue(): PermissionApprovalQueue {
	type Entry = {
		readonly run: (signal: AbortSignal) => Promise<unknown>;
		readonly controller: AbortController;
		readonly signal?: AbortSignal;
		readonly resolve: (value: unknown) => void;
		readonly reject: (reason: unknown) => void;
		onAbort?: () => void;
		started: boolean;
		settled: boolean;
	};
	const entries: Entry[] = [];
	let running = false;
	let active: Entry | undefined;
	let cancellation: unknown;

	const pump = (): void => {
		if (running) return;
		const entry = entries.shift();
		if (!entry) return;
		if (entry.settled || entry.signal?.aborted || cancellation !== undefined) {
			if (!entry.settled) {
				entry.settled = true;
				entry.reject(cancellation ?? permissionAbortedError("permission"));
			}
			pump();
			return;
		}
		running = true;
		active = entry;
		entry.started = true;
		void Promise.resolve()
			.then(() => entry.run(entry.controller.signal))
			.then(
				(value) => settle(entry, undefined, value),
				(error) => settle(entry, error),
			);
	};

	const settle = (entry: Entry, error: unknown, value?: unknown): void => {
		if (entry.onAbort) entry.signal?.removeEventListener("abort", entry.onAbort);
		if (!entry.settled) {
			entry.settled = true;
			if (error === undefined) entry.resolve(value);
			else entry.reject(error);
		}
		if (active === entry) {
			active = undefined;
			running = false;
			pump();
		}
	};

	return {
		enqueue<T>(run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
			return new Promise<T>((resolve, reject) => {
				const entry: Entry = {
					run,
					controller: new AbortController(),
					signal,
					resolve: (value) => resolve(value as T),
					reject,
					started: false,
					settled: false,
				};
				entry.onAbort = () => {
					if (entry.settled) return;
					entry.controller.abort();
					settle(entry, permissionAbortedError("permission"));
				};
				if (signal?.aborted) {
					entry.onAbort();
					return;
				}
				signal?.addEventListener("abort", entry.onAbort, { once: true });
				entries.push(entry);
				pump();
			});
		},
		cancel(error: unknown): void {
			cancellation = error;
			if (active) {
				active.controller.abort();
				settle(active, error);
			}
			for (const entry of entries.splice(0)) {
				if (entry.onAbort) entry.signal?.removeEventListener("abort", entry.onAbort);
				if (!entry.settled) {
					entry.settled = true;
					entry.reject(error);
				}
			}
			if (!running) pump();
		},
	};
}
