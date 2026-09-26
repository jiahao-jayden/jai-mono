import { type Static, Type } from "@sinclair/typebox";
import { type Result as ResultType, TaggedError } from "better-result";
import type { PermissionRisk } from "./approval";
import type { PermissionTelemetryObserver } from "./telemetry";
import type { PermissionAction, PermissionDecision } from "./types";

/**
 * Automatic permission review for `auto` mode.
 *
 * The permission evaluator stays the only source of `allow / ask / deny`. A
 * reviewer is consulted only for a built-in `ask` (no user rule matched and the
 * Danger Layer did not flag the call) and answers in place of the user:
 * `allow` runs the call once, `deny` rejects it, `ask` hands it to the user.
 * Every failure — deadline, cancellation, missing model, invalid output or a
 * thrown reviewer — also becomes `ask`, so review can never silently allow.
 */
export const permissionReviewVerdictSchema = Type.Object(
	{
		decision: Type.Union([Type.Literal("allow"), Type.Literal("deny"), Type.Literal("ask")]),
		reason: Type.String({ minLength: 1, maxLength: 500 }),
	},
	{ additionalProperties: false },
);

export type PermissionReviewVerdict = Static<typeof permissionReviewVerdictSchema>;

/**
 * The only facts a reviewer receives about one gated call. It is projected
 * from the evaluated request rather than raw tool arguments, so file contents
 * never reach a reviewer; the reviewer adapter still redacts `command` before
 * anything leaves the process.
 */
export interface PermissionReviewRequest {
	readonly toolName: string;
	readonly action: PermissionAction;
	readonly workspaceRoot: string;
	/** The evaluator's reason for asking, e.g. which rule did not match. */
	readonly reason: string;
	readonly risk: PermissionRisk;
	readonly command?: string;
	readonly path?: string;
	/** Side effect declared by an Extension tool; absent for built-in tools. */
	readonly sideEffect?: "read" | "write" | "destructive";
}

export type PermissionReviewFailureReason = "timeout" | "unavailable" | "failed" | "invalid_output" | "aborted";

/** In-process diagnostic only; the middleware converts it to an `ask` and never forwards it. */
export class PermissionReviewFailed extends TaggedError("coding_permission.review_failed")<{
	readonly message: string;
	readonly reason: PermissionReviewFailureReason;
	readonly cause?: unknown;
}> {}

export type PermissionReviewer = (
	request: PermissionReviewRequest,
	signal: AbortSignal,
) => Promise<ResultType<PermissionReviewVerdict, PermissionReviewFailed>>;

export interface PermissionReviewOptions {
	readonly review: PermissionReviewer;
	/** A review still pending after this many milliseconds is aborted and counts as `ask`. */
	readonly timeoutMs: number;
}

export interface PermissionReviewOutcome {
	readonly decision: PermissionReviewVerdict["decision"];
	/** Reviewer-written, length-bounded explanation; present only for a real verdict. */
	readonly reason?: string;
}

/** Only a built-in `ask` may be reviewed; explicit `ask` rules and the Danger Layer always reach the user. */
export function isReviewableDecision(decisions: readonly PermissionDecision[]): boolean {
	return decisions.every((decision) => decision.behavior !== "ask" || decision.source === "built-in");
}

/**
 * Runs one review under a deadline tied to the approval slot's signal, so an
 * aborted Operation cancels the reviewer's model call as well.
 */
export async function reviewPermission(
	options: PermissionReviewOptions,
	request: PermissionReviewRequest,
	signal: AbortSignal,
	toolCallId: string,
	observer: PermissionTelemetryObserver | undefined,
): Promise<PermissionReviewOutcome> {
	const fallback = (failure: PermissionReviewFailureReason): PermissionReviewOutcome => {
		observe(observer, { type: "permission_reviewed", toolCallId, verdict: "ask", failure });
		return { decision: "ask" };
	};
	if (signal.aborted) return fallback("aborted");
	const controller = new AbortController();
	const abort = () => controller.abort();
	signal.addEventListener("abort", abort, { once: true });
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => {
			controller.abort();
			resolve("timeout");
		}, options.timeoutMs);
	});
	try {
		const settled = await Promise.race([
			Promise.resolve().then(() => options.review(request, controller.signal)),
			deadline,
		]);
		if (settled === "timeout") return fallback("timeout");
		if (signal.aborted) return fallback("aborted");
		if (settled.isErr()) return fallback(settled.error.reason);
		observe(observer, { type: "permission_reviewed", toolCallId, verdict: settled.value.decision });
		return { decision: settled.value.decision, reason: singleLine(settled.value.reason) };
	} catch {
		// A throwing reviewer is a defect of that reviewer, not a permission fact: fail closed to the user.
		return fallback(signal.aborted ? "aborted" : "failed");
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", abort);
	}
}

function singleLine(value: string): string {
	return value.replace(/\s+/g, " ").trim().slice(0, 300);
}

function observe(
	observer: PermissionTelemetryObserver | undefined,
	event: Parameters<PermissionTelemetryObserver["observePermissionEvent"]>[0],
): void {
	try {
		observer?.observePermissionEvent(event);
	} catch {
		return;
	}
}
