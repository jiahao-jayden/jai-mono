import { TaggedError } from "better-result";

export interface ApprovalRequest {
	readonly requestId: string;
	readonly sessionId: string;
	readonly toolName?: string;
}

export interface PendingApproval<TRequest extends ApprovalRequest, TDecision> {
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

class ApprovalRegistryClosed extends TaggedError("desktop_agent.approval_registry_closed")<{
	readonly message: string;
}> {}
class DuplicateApprovalRequest extends TaggedError("desktop_agent.approval_duplicate_request")<{
	readonly message: string;
	readonly data: { readonly requestId: string };
}> {}
class ApprovalRequestNotFound extends TaggedError("desktop_agent.approval_request_not_found")<{
	readonly message: string;
	readonly data: { readonly requestId: string };
}> {}
class ApprovalAborted extends TaggedError("desktop_agent.approval_aborted")<{
	readonly message: string;
	readonly data: { readonly toolName: string };
}> {}

/** Coordinates Desktop renderer approval decisions for one Agent host. */
export class DesktopApprovalRegistry<TRequest extends ApprovalRequest, TDecision> {
	readonly #pending = new Map<string, PendingEntry<TRequest, TDecision>>();
	#closed = false;

	register(request: TRequest, signal?: AbortSignal): PendingApproval<TRequest, TDecision> {
		if (this.#closed) throw new ApprovalRegistryClosed({ message: "Approval registry is closed" });
		if (this.#pending.has(request.requestId)) {
			throw new DuplicateApprovalRequest({
				message: `Approval request "${request.requestId}" is already pending`,
				data: { requestId: request.requestId },
			});
		}
		if (signal?.aborted) throw approvalAborted(request.toolName);

		let resolveResult!: (decision: TDecision) => void;
		let rejectResult!: (error: unknown) => void;
		const result = new Promise<TDecision>((resolve, reject) => {
			resolveResult = resolve;
			rejectResult = reject;
		});
		const abort = signal
			? () => {
					const entry = this.#take(request.requestId);
					entry?.reject(approvalAborted(request.toolName));
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
		if (!entry) {
			throw new ApprovalRequestNotFound({
				message: `Approval request "${resolution.requestId}" was not found`,
				data: { requestId: resolution.requestId },
			});
		}
		entry.resolve(resolution.decision);
		return structuredClone(entry.request);
	}

	cancelSession(sessionId: string): number {
		let cancelled = 0;
		for (const [requestId, entry] of this.#pending) {
			if (entry.request.sessionId !== sessionId) continue;
			this.#take(requestId)?.reject(approvalAborted(entry.request.toolName));
			cancelled++;
		}
		return cancelled;
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		for (const requestId of [...this.#pending.keys()]) {
			this.#take(requestId)?.reject(new ApprovalRegistryClosed({ message: "Approval registry is closed" }));
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

function approvalAborted(toolName: string | undefined): ApprovalAborted {
	return new ApprovalAborted({
		message: `Approval for ${toolName ?? "request"} was aborted`,
		data: { toolName: toolName ?? "request" },
	});
}
