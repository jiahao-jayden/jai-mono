import type { PermissionApprovalDecision, PermissionRequest } from "./approval";
import {
	duplicatePermissionRequestError,
	permissionAbortedError,
	permissionRegistryClosedError,
	permissionRequestNotFoundError,
} from "./errors";

export interface ApprovalRequest {
	readonly requestId: string;
	readonly sessionId: string;
	readonly toolName: string;
}

export interface PendingPermissionApproval<
	TRequest extends ApprovalRequest = PermissionRequest,
	TDecision = PermissionApprovalDecision,
> {
	readonly request: TRequest;
	readonly result: Promise<TDecision>;
}

interface PendingEntry<TRequest extends ApprovalRequest, TDecision> {
	readonly request: TRequest;
	readonly resolve: (decision: TDecision) => void;
	readonly reject: (error: unknown) => void;
	readonly signal?: AbortSignal;
	readonly abort?: () => void;
}

export class PermissionApprovalRegistry<
	TRequest extends ApprovalRequest = PermissionRequest,
	TDecision = PermissionApprovalDecision,
> {
	readonly #pending = new Map<string, PendingEntry<TRequest, TDecision>>();
	#closed = false;

	register(request: TRequest, signal?: AbortSignal): PendingPermissionApproval<TRequest, TDecision> {
		if (this.#closed) throw permissionRegistryClosedError();
		if (this.#pending.has(request.requestId)) throw duplicatePermissionRequestError(request.requestId);
		if (signal?.aborted) throw permissionAbortedError(request.toolName);

		let resolveResult!: (decision: TDecision) => void;
		let rejectResult!: (error: unknown) => void;
		const result = new Promise<TDecision>((resolve, reject) => {
			resolveResult = resolve;
			rejectResult = reject;
		});
		const abort = signal
			? () => {
					const entry = this.#take(request.requestId);
					entry?.reject(permissionAbortedError(request.toolName));
				}
			: undefined;
		const entry: PendingEntry<TRequest, TDecision> = {
			request: structuredClone(request),
			resolve: resolveResult,
			reject: rejectResult,
			signal,
			abort,
		};
		this.#pending.set(request.requestId, entry);
		signal?.addEventListener("abort", abort!, { once: true });
		return { request: structuredClone(entry.request), result };
	}

	resolve(resolution: { readonly requestId: string; readonly decision: TDecision }): TRequest {
		const entry = this.#take(resolution.requestId);
		if (!entry) throw permissionRequestNotFoundError(resolution.requestId);
		entry.resolve(resolution.decision);
		return structuredClone(entry.request);
	}

	cancelSession(sessionId: string): number {
		let cancelled = 0;
		for (const [requestId, entry] of this.#pending) {
			if (entry.request.sessionId !== sessionId) continue;
			this.#take(requestId)?.reject(permissionAbortedError(entry.request.toolName));
			cancelled++;
		}
		return cancelled;
	}

	list(sessionId?: string): TRequest[] {
		return [...this.#pending.values()]
			.filter((entry) => sessionId === undefined || entry.request.sessionId === sessionId)
			.map((entry) => structuredClone(entry.request));
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		for (const requestId of [...this.#pending.keys()]) {
			const entry = this.#take(requestId);
			entry?.reject(permissionRegistryClosedError());
		}
	}

	#take(requestId: string): PendingEntry<TRequest, TDecision> | undefined {
		const entry = this.#pending.get(requestId);
		if (!entry) return undefined;
		this.#pending.delete(requestId);
		if (entry.abort) entry.signal?.removeEventListener("abort", entry.abort);
		return entry;
	}
}
