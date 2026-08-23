import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@jai/agent";
import { CodingEventProjector } from "../src/sdk/project";

describe("CodingEventProjector", () => {
	test("resolves presentation once at start and reuses it for the entire tool call", () => {
		let resolveCalls = 0;
		const projector = new CodingEventProjector(
			new Map([
				[
					"connector__execute_action",
					{
						title: () => "Create record",
						resolveActivityKind: () => {
							resolveCalls++;
							return resolveCalls === 1 ? "call" : "operation";
						},
					},
				],
			]),
		);
		const start: Extract<AgentEvent, { type: "tool_execution_start" }> = {
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "connector__execute_action",
			args: { actionId: "crm.create" },
		};

		expect(projector.project(start)).toMatchObject({
			type: "tool_execution_start",
			activityKind: "call",
			title: "Create record",
		});
		expect(
			projector.project({
				type: "tool_execution_update",
				toolCallId: "call-1",
				toolName: "connector__execute_action",
				partial: { content: [] },
			}),
		).toMatchObject({ activityKind: "call" });
		expect(
			projector.project({
				type: "tool_execution_end",
				toolCallId: "call-1",
				toolName: "connector__execute_action",
				result: { content: [] },
				isError: false,
			}),
		).toMatchObject({ activityKind: "call" });
		expect(resolveCalls).toBe(1);
	});

	test("uses the generic operation presentation when no Coding Agent descriptor is registered", () => {
		const projector = new CodingEventProjector(new Map());
		expect(
			projector.project({
				type: "tool_execution_start",
				toolCallId: "call-1",
				toolName: "unknown_tool",
				args: {},
			}),
		).toMatchObject({ activityKind: "operation", title: "unknown_tool" });
	});
});
