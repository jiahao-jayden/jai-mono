import type { TelemetryContext, TelemetrySpan, TelemetrySpanStatus } from "@jai/telemetry";
import type { PermissionTelemetryEvent, PermissionTelemetryObserver } from "../permissions";
import type { CodingAgentEvent, CodingAssistantMessage, CodingStopReason } from "./types";

type TelemetryOutcome = "completed" | "discarded" | "failed" | "aborted";

interface ActiveTurn {
	readonly span: TelemetrySpan<"jai.turn">;
}

interface ActiveModelStream {
	readonly span: TelemetrySpan<"jai.model_stream">;
	readonly startedAtMs: number;
	firstOutputAtMs?: number;
}

interface ActiveModelAttempt {
	readonly assistantEntryId: string;
	readonly span: TelemetrySpan<"jai.model_attempt">;
	stream?: ActiveModelStream;
}

interface ActiveToolCall {
	readonly span: TelemetrySpan<"jai.tool_call">;
	readonly startedAtMs: number;
}

interface ActivePermission {
	readonly span: TelemetrySpan<"jai.permission">;
}

interface ActiveApproval {
	readonly span: TelemetrySpan<"jai.approval">;
	readonly startedAtMs: number;
}

interface ReservedToolCall {
	readonly toolCallId: string;
	readonly toolName: string;
}

/** Server effect-boundary 观察到的稳定 identity；绝不携带参数、结果或内容。 */
export type CodingAgentTelemetryEffectEvent =
	| {
			readonly type: "model_reserved";
			readonly assistantEntryId: string;
			readonly attemptId: string;
			readonly model: string;
			readonly provider: string;
	  }
	| {
			readonly type: "tool_reserved";
			readonly assistantEntryId: string;
			readonly resultEntryId: string;
			readonly toolCallId: string;
			readonly toolName: string;
	  };

export interface CodingAgentTelemetryObserverOptions {
	readonly telemetry: TelemetryContext;
	readonly operationId: string;
	readonly sessionId: string;
	/** 测试可注入单调时钟；生产缺省使用 Date.now。 */
	readonly now?: () => number;
}

/**
 * 把 Coding Agent 的公开生命周期与 Server 已持久化的 effect identity 投影为 span。
 * 只保存一次运行期间的可丢弃状态；任何观察异常都被 containment 在本对象内。
 */
export interface CodingAgentTelemetryObserver extends PermissionTelemetryObserver {
	observeAgentEvent(event: CodingAgentEvent): void;
	observeEffectEvent(event: CodingAgentTelemetryEffectEvent): void;
	close(): void;
}

export function createCodingAgentTelemetryObserver(
	options: CodingAgentTelemetryObserverOptions,
): CodingAgentTelemetryObserver {
	return new DefaultCodingAgentTelemetryObserver(options);
}

class DefaultCodingAgentTelemetryObserver implements CodingAgentTelemetryObserver {
	readonly #now: () => number;
	readonly #modelAttempts = new Map<string, ActiveModelAttempt>();
	readonly #pendingModelAttemptIds: string[] = [];
	readonly #reservedTools = new Map<string, ReservedToolCall>();
	readonly #activeTools = new Map<string, ActiveToolCall>();
	readonly #activePermissions = new Map<string, ActivePermission>();
	readonly #activeApprovals = new Map<string, ActiveApproval>();
	#run?: TelemetrySpan<"jai.run">;
	#turn?: ActiveTurn;
	#turnCount = 0;
	#lastOutcome: TelemetryOutcome = "completed";
	#closed = false;

	constructor(private readonly options: CodingAgentTelemetryObserverOptions) {
		this.#now = options.now ?? Date.now;
	}

	observeAgentEvent(event: CodingAgentEvent): void {
		try {
			if (this.#closed) return;
			this.#observeAgentEvent(event);
		} catch {
			return;
		}
	}

	observeEffectEvent(event: CodingAgentTelemetryEffectEvent): void {
		try {
			if (this.#closed) return;
			this.#observeEffectEvent(event);
		} catch {
			return;
		}
	}

	observePermissionEvent(event: PermissionTelemetryEvent): void {
		try {
			if (this.#closed) return;
			this.#observePermissionEvent(event);
		} catch {
			return;
		}
	}

	close(): void {
		try {
			if (this.#closed) return;
			this.#closed = true;
			this.#settleAll("aborted");
		} catch {
			return;
		}
	}

	#observeAgentEvent(event: CodingAgentEvent): void {
		switch (event.type) {
			case "agent_start":
				this.#startRun();
				return;
			case "agent_end":
				this.#finishRun();
				return;
			case "turn_start":
				this.#startTurn();
				return;
			case "turn_end":
				this.#finishTurn(outcomeForStopReason(event.message.stopReason));
				return;
			case "message_start":
				if (event.message.role === "assistant") this.#startModelStream();
				return;
			case "message_update":
				this.#observeModelOutput(event);
				return;
			case "message_end":
				if (event.message.role === "assistant") {
					this.#finishModelAttempt(outcomeForStopReason(event.message.stopReason), event.message);
				}
				return;
			case "message_discard":
				this.#finishModelAttempt("discarded");
				return;
			case "tool_execution_start":
				this.#startToolCall(event.toolCallId, event.toolName);
				return;
			case "tool_execution_end":
				this.#finishToolCall(event.toolCallId, event.isError ? "failed" : "completed");
				return;
			case "tool_execution_update":
			case "compaction_start":
			case "compaction_end":
				return;
		}
	}

	#observeEffectEvent(event: CodingAgentTelemetryEffectEvent): void {
		if (event.type === "model_reserved") {
			this.#reserveModelAttempt(event);
			return;
		}
		this.#reservedTools.set(event.toolCallId, { toolCallId: event.toolCallId, toolName: event.toolName });
	}

	#observePermissionEvent(event: PermissionTelemetryEvent): void {
		switch (event.type) {
			case "permission_decided":
				this.#observePermissionDecision(event);
				return;
			case "permission_settled":
				this.#settlePermission(event.toolCallId, event.outcome);
				return;
			case "approval_requested":
				this.#startApproval(event);
				return;
			case "approval_decided":
				this.#settleApproval(event.approvalId, event.decision === "deny" ? "denied" : "approved", event.decision);
				return;
			case "approval_cancelled":
				this.#settleApproval(event.approvalId, "cancelled");
				return;
			case "approval_failed":
				this.#settleApproval(event.approvalId, "failed");
				return;
		}
	}

	#observePermissionDecision(event: Extract<PermissionTelemetryEvent, { readonly type: "permission_decided" }>): void {
		const permission = this.#activePermissions.get(event.toolCallId) ?? this.#startPermission(event);
		if (!permission) return;
		permission.span.setAttributes({ decision: event.decision, risk: event.risk, source: event.source });
		permission.span.addEvent({
			name: "jai.permission.decided",
			attributes: { decision: event.decision, phase: event.phase, risk: event.risk, source: event.source },
		});
	}

	#startPermission(
		event: Extract<PermissionTelemetryEvent, { readonly type: "permission_decided" }>,
	): ActivePermission | undefined {
		const turn = this.#turn;
		if (!turn) return undefined;
		const span = this.options.telemetry.startSpan({
			name: "jai.permission",
			parent: turn.span,
			attributes: { toolCallId: event.toolCallId, toolName: event.toolName },
		});
		const permission = { span };
		this.#activePermissions.set(event.toolCallId, permission);
		return permission;
	}

	#startApproval(event: Extract<PermissionTelemetryEvent, { readonly type: "approval_requested" }>): void {
		const permission = this.#activePermissions.get(event.toolCallId);
		if (!permission || this.#activeApprovals.has(event.approvalId)) return;
		const span = this.options.telemetry.startSpan({
			name: "jai.approval",
			parent: permission.span,
			attributes: { approvalId: event.approvalId, toolCallId: event.toolCallId, toolName: event.toolName },
		});
		span.addEvent({ name: "jai.approval.requested" });
		this.#activeApprovals.set(event.approvalId, { span, startedAtMs: this.#readNow() });
	}

	#settleApproval(
		approvalId: string,
		outcome: "approved" | "denied" | "cancelled" | "failed",
		decision?: "deny" | "allowOnce" | "alwaysAllow",
	): void {
		const approval = this.#activeApprovals.get(approvalId);
		if (!approval) return;
		const waitMs = elapsedSince(approval.startedAtMs, this.#readNow());
		approval.span.setAttributes({
			...(decision ? { decision } : {}),
			outcome,
			waitMs,
		});
		if (decision) approval.span.addEvent({ name: "jai.approval.decided", attributes: { decision } });
		approval.span.addEvent({ name: "jai.approval.settled", attributes: { outcome, waitMs } });
		approval.span.setStatus(approvalStatusForOutcome(outcome));
		this.#activeApprovals.delete(approvalId);
	}

	#settlePermission(
		toolCallId: string,
		outcome: "allowed" | "denied" | "recheck_denied" | "cancelled" | "failed",
	): void {
		const permission = this.#activePermissions.get(toolCallId);
		if (!permission) return;
		permission.span.setAttributes({ outcome });
		permission.span.addEvent({ name: "jai.permission.settled", attributes: { outcome } });
		permission.span.setStatus(permissionStatusForOutcome(outcome));
		this.#activePermissions.delete(toolCallId);
	}

	#startRun(): void {
		if (this.#run) return;
		this.#run = this.options.telemetry.startSpan({
			name: "jai.run",
			attributes: {
				operationId: this.options.operationId,
				runId: this.options.operationId,
				sessionId: this.options.sessionId,
			},
		});
		this.#run.addEvent({ name: "jai.run.started" });
	}

	#startTurn(): void {
		const run = this.#run;
		if (!run || this.#turn) return;
		const turnId = `${this.options.operationId}:turn:${++this.#turnCount}`;
		const span = this.options.telemetry.startSpan({ name: "jai.turn", parent: run, attributes: { turnId } });
		span.addEvent({ name: "jai.turn.started" });
		this.#turn = { span };
	}

	#reserveModelAttempt(event: Extract<CodingAgentTelemetryEffectEvent, { readonly type: "model_reserved" }>): void {
		const turn = this.#turn;
		if (!turn || this.#modelAttempts.has(event.assistantEntryId)) return;
		const span = this.options.telemetry.startSpan({
			name: "jai.model_attempt",
			parent: turn.span,
			attributes: { attemptId: event.attemptId, model: event.model, provider: event.provider },
		});
		span.addEvent({ name: "jai.model_attempt.started" });
		this.#modelAttempts.set(event.assistantEntryId, { assistantEntryId: event.assistantEntryId, span });
		this.#pendingModelAttemptIds.push(event.assistantEntryId);
	}

	#startModelStream(): void {
		const assistantEntryId = this.#pendingModelAttemptIds.shift();
		if (!assistantEntryId) return;
		const attempt = this.#modelAttempts.get(assistantEntryId);
		if (!attempt || attempt.stream) return;
		const startedAtMs = this.#readNow();
		const span = this.options.telemetry.startSpan({
			name: "jai.model_stream",
			parent: attempt.span,
			attributes: { streamId: attempt.assistantEntryId },
		});
		attempt.stream = { span, startedAtMs };
	}

	#observeModelOutput(event: Extract<CodingAgentEvent, { readonly type: "message_update" }>): void {
		if (!isFirstModelOutput(event.assistantEvent.type)) return;
		const attempt = this.#activeModelAttempt();
		const stream = attempt?.stream;
		if (!stream || stream.firstOutputAtMs !== undefined) return;
		const firstOutputMs = elapsedSince(stream.startedAtMs, this.#readNow());
		stream.firstOutputAtMs = firstOutputMs;
		stream.span.setAttributes({ firstOutputMs });
		stream.span.addEvent({ name: "jai.model_stream.first_output", attributes: { firstOutputMs } });
	}

	#finishModelAttempt(outcome: TelemetryOutcome, message?: CodingAssistantMessage): void {
		const attempt = this.#activeModelAttempt();
		if (!attempt) return;
		this.#settleModelAttempt(attempt, outcome, message?.usage);
	}

	#startToolCall(toolCallId: string, toolName: string): void {
		const turn = this.#turn;
		const reservation = this.#reservedTools.get(toolCallId);
		if (!turn || !reservation || reservation.toolName !== toolName || this.#activeTools.has(toolCallId)) return;
		const span = this.options.telemetry.startSpan({
			name: "jai.tool_call",
			parent: turn.span,
			attributes: { toolCallId: reservation.toolCallId, toolName: reservation.toolName },
		});
		span.addEvent({ name: "jai.tool_call.dispatched" });
		this.#activeTools.set(toolCallId, { span, startedAtMs: this.#readNow() });
	}

	#finishToolCall(toolCallId: string, outcome: Extract<TelemetryOutcome, "completed" | "failed" | "aborted">): void {
		const active = this.#activeTools.get(toolCallId);
		if (!active) return;
		const durationMs = elapsedSince(active.startedAtMs, this.#readNow());
		active.span.setAttributes({ durationMs });
		active.span.addEvent({ name: "jai.tool_call.settled", attributes: { durationMs } });
		active.span.setStatus(statusForOutcome(outcome));
		this.#activeTools.delete(toolCallId);
		this.#reservedTools.delete(toolCallId);
		this.#lastOutcome = worstOutcome(this.#lastOutcome, outcome);
	}

	#finishTurn(outcome: TelemetryOutcome): void {
		const turn = this.#turn;
		if (!turn) return;
		this.#settleOutstandingChildren(outcome);
		turn.span.addEvent({ name: "jai.turn.finished" });
		turn.span.setStatus(statusForOutcome(outcome));
		this.#turn = undefined;
		this.#lastOutcome = worstOutcome(this.#lastOutcome, outcome);
	}

	#finishRun(): void {
		if (!this.#run) return;
		this.#settleAll(this.#lastOutcome);
		this.#closed = true;
	}

	#settleAll(outcome: TelemetryOutcome): void {
		this.#settleOutstandingChildren(outcome);
		const settledOutcome = worstOutcome(outcome, this.#lastOutcome);
		this.#lastOutcome = settledOutcome;
		const turn = this.#turn;
		if (turn) {
			turn.span.addEvent({ name: "jai.turn.finished" });
			turn.span.setStatus(statusForOutcome(settledOutcome));
			this.#turn = undefined;
		}
		const run = this.#run;
		if (run) {
			run.addEvent({ name: "jai.run.finished" });
			run.setStatus(statusForOutcome(settledOutcome));
			this.#run = undefined;
		}
	}

	#settleOutstandingChildren(outcome: TelemetryOutcome): void {
		for (const [approvalId] of [...this.#activeApprovals]) {
			this.#settleApproval(approvalId, "cancelled");
		}
		for (const [toolCallId] of [...this.#activePermissions]) {
			this.#settlePermission(toolCallId, outcome === "failed" ? "failed" : "cancelled");
		}
		for (const attempt of [...this.#modelAttempts.values()]) {
			this.#settleModelAttempt(attempt, outcome);
		}
		for (const [toolCallId] of [...this.#activeTools]) {
			this.#finishToolCall(toolCallId, outcome === "discarded" ? "failed" : outcome);
		}
	}

	#settleModelAttempt(
		attempt: ActiveModelAttempt,
		outcome: TelemetryOutcome,
		usage?: CodingAssistantMessage["usage"],
	): void {
		if (usage) {
			attempt.span.setAttributes({
				cacheReadCost: usage.cost.cacheRead,
				cacheReadTokens: usage.cacheRead,
				cacheWriteCost: usage.cost.cacheWrite,
				cacheWriteTokens: usage.cacheWrite,
				inputCost: usage.cost.input,
				inputTokens: usage.input,
				outputCost: usage.cost.output,
				outputTokens: usage.output,
				...(usage.reasoning === undefined ? {} : { reasoningTokens: usage.reasoning }),
				totalCost: usage.cost.total,
				totalTokens: usage.totalTokens,
			});
		}
		const stream = attempt.stream;
		if (stream) {
			const durationMs = elapsedSince(stream.startedAtMs, this.#readNow());
			stream.span.setAttributes({ durationMs, outcome });
			stream.span.addEvent({ name: "jai.model_stream.settled", attributes: { durationMs } });
			stream.span.setStatus(statusForOutcome(outcome));
			attempt.stream = undefined;
		}
		attempt.span.addEvent({ name: "jai.model_attempt.settled", attributes: { outcome } });
		attempt.span.setStatus(statusForOutcome(outcome));
		this.#modelAttempts.delete(attempt.assistantEntryId);
		this.#removePendingModelAttempt(attempt.assistantEntryId);
		this.#lastOutcome = worstOutcome(this.#lastOutcome, outcome);
	}

	#activeModelAttempt(): ActiveModelAttempt | undefined {
		for (const attempt of this.#modelAttempts.values()) {
			if (attempt.stream) return attempt;
		}
		return undefined;
	}

	#removePendingModelAttempt(assistantEntryId: string): void {
		const index = this.#pendingModelAttemptIds.indexOf(assistantEntryId);
		if (index >= 0) this.#pendingModelAttemptIds.splice(index, 1);
	}

	#readNow(): number {
		try {
			const value = this.#now();
			return Number.isFinite(value) ? value : Date.now();
		} catch {
			return Date.now();
		}
	}
}

function isFirstModelOutput(
	type: Extract<CodingAgentEvent, { readonly type: "message_update" }>["assistantEvent"]["type"],
): boolean {
	return type === "text_start" || type === "thinking_start" || type === "toolcall_start";
}

function outcomeForStopReason(stopReason: CodingStopReason): TelemetryOutcome {
	if (stopReason === "aborted") return "aborted";
	if (stopReason === "error" || stopReason === "contextOverflow") return "failed";
	return "completed";
}

function elapsedSince(startedAtMs: number, now: number): number {
	return Math.max(0, now - startedAtMs);
}

function statusForOutcome(outcome: TelemetryOutcome): TelemetrySpanStatus {
	if (outcome === "completed" || outcome === "discarded") return { kind: "ok" };
	return { kind: "error", name: outcome === "aborted" ? "aborted" : "provider" };
}

function approvalStatusForOutcome(outcome: "approved" | "denied" | "cancelled" | "failed"): TelemetrySpanStatus {
	if (outcome === "approved" || outcome === "denied") return { kind: "ok" };
	return { kind: "error", name: outcome === "cancelled" ? "cancelled" : "permission" };
}

function permissionStatusForOutcome(
	outcome: "allowed" | "denied" | "recheck_denied" | "cancelled" | "failed",
): TelemetrySpanStatus {
	if (outcome === "allowed") return { kind: "ok" };
	return { kind: "error", name: outcome === "cancelled" ? "cancelled" : "permission" };
}

function worstOutcome(current: TelemetryOutcome, candidate: TelemetryOutcome): TelemetryOutcome {
	return outcomeRank(candidate) > outcomeRank(current) ? candidate : current;
}

function outcomeRank(outcome: TelemetryOutcome): number {
	switch (outcome) {
		case "completed":
			return 0;
		case "discarded":
			return 1;
		case "aborted":
			return 2;
		case "failed":
			return 3;
	}
}
