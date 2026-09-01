import { describe, expect, test } from "bun:test";
import { InMemoryTelemetryContext } from "@jai/telemetry";
import { createCodingAgentTelemetryObserver } from "../src/sdk";
import type { CodingAssistantMessage } from "../src/sdk/types";

describe("Coding Agent telemetry observer", () => {
	test("使用 effect identity 建立 run、turn、模型与工具的因果树，且不记录内容", async () => {
		let now = 100;
		const telemetry = new InMemoryTelemetryContext({ now: () => now++ });
		const observer = createCodingAgentTelemetryObserver({
			telemetry,
			operationId: "operation-1",
			sessionId: "session-1",
			now: () => now++,
		});
		const toolUse = assistant("toolUse");
		const completed = assistant("stop");

		observer.observeAgentEvent({ type: "agent_start" });
		observer.observeAgentEvent({ type: "turn_start" });
		observer.observeEffectEvent({
			type: "model_reserved",
			attemptId: "attempt-1",
			assistantEntryId: "assistant-1",
			model: "test-model",
			provider: "test",
		});
		observer.observeAgentEvent({ type: "message_start", message: toolUse });
		observer.observeAgentEvent({
			type: "message_update",
			message: toolUse,
			assistantEvent: { type: "toolcall_start", contentIndex: 0 },
		});
		observer.observeAgentEvent({ type: "message_end", message: toolUse, entryId: "assistant-1" });
		observer.observeEffectEvent({
			type: "tool_reserved",
			assistantEntryId: "assistant-1",
			resultEntryId: "result-1",
			toolCallId: "call-1",
			toolName: "Read",
		});
		observer.observeAgentEvent({
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "Read",
			activityKind: "read",
			title: "Read secret.txt",
			args: { path: "secret.txt", token: "private-tool-input" },
		});
		observer.observeAgentEvent({
			type: "tool_execution_end",
			toolCallId: "call-1",
			toolName: "Read",
			activityKind: "read",
			result: { content: "private-tool-output" },
			isError: false,
		});
		observer.observeAgentEvent({ type: "turn_end", message: toolUse, toolResults: [] });
		observer.observeAgentEvent({ type: "turn_start" });
		observer.observeEffectEvent({
			type: "model_reserved",
			attemptId: "attempt-2",
			assistantEntryId: "assistant-2",
			model: "test-model",
			provider: "test",
		});
		observer.observeAgentEvent({ type: "message_start", message: completed });
		observer.observeAgentEvent({
			type: "message_update",
			message: completed,
			assistantEvent: { type: "text_start", contentIndex: 0 },
		});
		observer.observeAgentEvent({ type: "message_end", message: completed, entryId: "assistant-2" });
		observer.observeAgentEvent({ type: "turn_end", message: completed, toolResults: [] });
		observer.observeAgentEvent({ type: "agent_end", messages: [completed] });
		await telemetry.waitForSettledSpans();

		const run = span(telemetry.spans, "jai.run");
		const turns = telemetry.spans.filter((record) => record.name === "jai.turn");
		const attempts = telemetry.spans.filter((record) => record.name === "jai.model_attempt");
		const streams = telemetry.spans.filter((record) => record.name === "jai.model_stream");
		const tool = span(telemetry.spans, "jai.tool_call");

		expect(run.attributes).toMatchObject({ operationId: "operation-1", runId: "operation-1", sessionId: "session-1" });
		expect(turns).toHaveLength(2);
		expect(turns.every((record) => record.parentId === run.id)).toBe(true);
		expect(attempts.map((record) => record.attributes.attemptId)).toEqual(["attempt-1", "attempt-2"]);
		expect(attempts.every((record) => turns.some((turn) => turn.id === record.parentId))).toBe(true);
		expect(streams.every((record) => attempts.some((attempt) => attempt.id === record.parentId))).toBe(true);
		expect(streams.every((record) => typeof record.attributes.firstOutputMs === "number")).toBe(true);
		expect(tool.parentId).toBe(turns[0]?.id);
		expect(tool.attributes).toMatchObject({ toolCallId: "call-1", toolName: "Read" });
		expect(telemetry.spans.every((record) => record.endedAtMs !== undefined)).toBe(true);
		expect(JSON.stringify(telemetry.spans)).not.toContain("private-tool");
	});

	test("已经流式发布又被丢弃的模型尝试独立结算", async () => {
		const telemetry = new InMemoryTelemetryContext();
		const observer = createCodingAgentTelemetryObserver({
			telemetry,
			operationId: "operation-1",
			sessionId: "session-1",
		});
		const discarded = assistant("error");
		const recovered = assistant("stop");

		observer.observeAgentEvent({ type: "agent_start" });
		observer.observeAgentEvent({ type: "turn_start" });
		observer.observeEffectEvent({
			type: "model_reserved",
			attemptId: "attempt-discarded",
			assistantEntryId: "assistant-discarded",
			model: "test-model",
			provider: "test",
		});
		observer.observeAgentEvent({ type: "message_start", message: discarded });
		observer.observeAgentEvent({
			type: "message_update",
			message: discarded,
			assistantEvent: { type: "text_start", contentIndex: 0 },
		});
		observer.observeAgentEvent({ type: "message_discard" });
		observer.observeEffectEvent({
			type: "model_reserved",
			attemptId: "attempt-recovered",
			assistantEntryId: "assistant-recovered",
			model: "test-model",
			provider: "test",
		});
		observer.observeAgentEvent({ type: "message_start", message: recovered });
		observer.observeAgentEvent({ type: "message_end", message: recovered, entryId: "assistant-recovered" });
		observer.observeAgentEvent({ type: "turn_end", message: recovered, toolResults: [] });
		observer.observeAgentEvent({ type: "agent_end", messages: [recovered] });
		await telemetry.waitForSettledSpans();

		const streams = telemetry.spans.filter((record) => record.name === "jai.model_stream");
		const attempts = telemetry.spans.filter((record) => record.name === "jai.model_attempt");
		expect(streams.map((record) => record.attributes.outcome)).toEqual(["discarded", "completed"]);
		expect(attempts[0]?.events).toContainEqual({
			name: "jai.model_attempt.settled",
			attributes: { outcome: "discarded" },
			timestampMs: expect.any(Number),
		});
	});

	test("权限与审批作为回合的子 span 记录等待、重检拒绝和取消", async () => {
		let now = 100;
		const telemetry = new InMemoryTelemetryContext({ now: () => now });
		const observer = createCodingAgentTelemetryObserver({
			telemetry,
			operationId: "operation-permission",
			sessionId: "session-permission",
			now: () => now,
		});
		const completed = assistant("stop");

		observer.observeAgentEvent({ type: "agent_start" });
		observer.observeAgentEvent({ type: "turn_start" });
		observer.observePermissionEvent({
			type: "permission_decided",
			toolCallId: "call-rechecked",
			toolName: "Write",
			decision: "ask",
			phase: "initial",
			risk: "medium",
			source: "built-in",
		});
		now += 25;
		observer.observePermissionEvent({
			type: "approval_requested",
			approvalId: "approval-rechecked",
			toolCallId: "call-rechecked",
			toolName: "Write",
		});
		now += 475;
		observer.observePermissionEvent({ type: "approval_decided", approvalId: "approval-rechecked", decision: "allowOnce" });
		observer.observePermissionEvent({
			type: "permission_decided",
			toolCallId: "call-rechecked",
			toolName: "Write",
			decision: "deny",
			phase: "recheck",
			risk: "medium",
			source: "rule",
		});
		observer.observePermissionEvent({
			type: "permission_settled",
			toolCallId: "call-rechecked",
			outcome: "recheck_denied",
		});
		observer.observePermissionEvent({
			type: "permission_decided",
			toolCallId: "call-cancelled",
			toolName: "Bash",
			decision: "ask",
			phase: "initial",
			risk: "high",
			source: "danger-layer",
		});
		observer.observePermissionEvent({
			type: "approval_requested",
			approvalId: "approval-cancelled",
			toolCallId: "call-cancelled",
			toolName: "Bash",
		});
		now += 15;
		observer.observePermissionEvent({ type: "approval_cancelled", approvalId: "approval-cancelled" });
		observer.observePermissionEvent({ type: "permission_settled", toolCallId: "call-cancelled", outcome: "cancelled" });
		observer.observeAgentEvent({ type: "turn_end", message: completed, toolResults: [] });
		observer.observeAgentEvent({ type: "agent_end", messages: [completed] });
		await telemetry.waitForSettledSpans();

		const turn = span(telemetry.spans, "jai.turn");
		const rechecked = telemetry.spans.find((record) => record.name === "jai.permission" && record.attributes.toolCallId === "call-rechecked");
		const approval = span(telemetry.spans, "jai.approval");
		const cancelledApproval = telemetry.spans.find(
			(record) => record.name === "jai.approval" && record.attributes.approvalId === "approval-cancelled",
		);

		expect(rechecked?.parentId).toBe(turn.id);
		expect(rechecked?.attributes).toMatchObject({
			toolCallId: "call-rechecked",
			decision: "deny",
			risk: "medium",
			source: "rule",
			outcome: "recheck_denied",
		});
		expect(rechecked?.events).toContainEqual({
			name: "jai.permission.decided",
			attributes: { decision: "deny", phase: "recheck", risk: "medium", source: "rule" },
			timestampMs: expect.any(Number),
		});
		expect(approval.parentId).toBe(rechecked?.id);
		expect(approval.attributes).toMatchObject({ decision: "allowOnce", outcome: "approved", waitMs: 475 });
		expect(cancelledApproval?.attributes).toMatchObject({ outcome: "cancelled", waitMs: 15 });
		expect(telemetry.spans.every((record) => record.endedAtMs !== undefined)).toBe(true);
	});
});

function assistant(stopReason: CodingAssistantMessage["stopReason"]): CodingAssistantMessage {
	return {
		role: "assistant",
		content: [],
		provider: "test",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 0,
	};
}

function span(
	spans: readonly import("@jai/telemetry").TelemetrySpanRecord[],
	name: import("@jai/telemetry").TelemetrySpanName,
): import("@jai/telemetry").TelemetrySpanRecord {
	const found = spans.find((record) => record.name === name);
	if (!found) throw new Error(`Expected ${name} span`);
	return found;
}
