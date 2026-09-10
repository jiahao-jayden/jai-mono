import { expect, test } from "bun:test";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { createCodingAgent, defineExtension, type CodingAgentEvent } from "@jai/coding-agent";
import { Type } from "@sinclair/typebox";
import { Result } from "better-result";
import { createSubagentExtension } from "../../src/subagent";
import { createTodoExtension } from "../../src/todo";
import { assistant, assistantToolCall, createInput, temporaryDirectory } from "../sdk-fixture";

test("Subagent installs with Todo, isolates history and catalog search, streams progress and returns text", async () => {
	const root = await temporaryDirectory();
	const requests: any[] = [];
	let turnStarts = 0;
	const catalog = defineExtension({
		id: "catalog",
		hooks: {
			turnStart() {
				turnStarts++;
			},
		},
		catalogs: [
			{
				id: "echo",
				discover: () =>
					Result.ok({
						tools: [
							{
								name: "Echo",
								description: "Echo a discovered result",
								parameters: Type.Object({}),
								authorization: { owner: "extension" as const },
								execute: () => ({ content: [{ type: "text" as const, text: "echoed" }] }),
							},
						],
					}),
			},
		],
	});
	const created = await createCodingAgent({
		...createInput(
			root,
			[
				assistantToolCall("SpawnAgent", "spawn", { title: "Inspect", task: "child-only task" }),
				assistantToolCall("SearchTools", "search", { query: "Echo" }),
				assistant("child final"),
				assistant("parent final"),
			],
			requests,
		),
		extensions: [createTodoExtension(), createSubagentExtension(), catalog],
	});
	if (created.isErr()) throw created.error;
	const events: CodingAgentEvent[] = [];
	created.value.subscribe((event) => {
		events.push(event);
	});
	try {
		expect((await created.value.prompt("parent secret history")).isOk()).toBe(true);
		const parentTools = requests[0].tools.map((tool: any) => tool.name);
		const childTools = requests[1].tools.map((tool: any) => tool.name);
		expect(parentTools).toContain("SpawnAgent");
		expect(parentTools).toContain("UpdateTodos");
		expect(childTools).not.toContain("SpawnAgent");
		expect(childTools).not.toContain("UpdateTodos");
		expect(JSON.stringify(requests[1])).not.toContain("parent secret history");
		expect(JSON.stringify(requests[1])).toContain("child-only task");
		expect(requests[2].tools.map((tool: any) => tool.name)).toEqual(childTools);
		expect(JSON.stringify(requests[3].messages)).toContain("child final");
		expect(turnStarts).toBe(2);
		expect(
			events.filter((event) => event.type === "tool_execution_update").map((event) => JSON.stringify(event)),
		).toEqual(expect.arrayContaining([expect.stringContaining('"activityTitle":"SearchTools"')]));
		const end = events.find((event) => event.type === "tool_execution_end");
		expect(end).toMatchObject({ isError: false });
		expect(JSON.stringify(end)).not.toContain('"cause"');
		expect(JSON.stringify(end)).not.toContain('"stack"');
	} finally {
		await created.value.close();
	}
});

for (const mode of ["plan", "dontAsk", "default"] as const) {
	test(`child Write keeps ${mode} permissions`, async () => {
		const root = await temporaryDirectory();
		const file = join(root, "child.txt");
		let approvals = 0;
		const created = await createCodingAgent({
			...createInput(root, [
				assistantToolCall("SpawnAgent", "spawn", { title: "Write", task: "write child.txt" }),
				assistantToolCall("Write", "write", { path: file, content: "child" }),
				assistant("child result"),
				assistant("parent result"),
			]),
			permissionMode: mode,
			requestApproval: async (request) => {
				approvals++;
				expect(request.toolName).toBe("Write");
				return "allowOnce" as const;
			},
			extensions: [createSubagentExtension()],
		});
		if (created.isErr()) throw created.error;
		try {
			await created.value.prompt("delegate");
			if (mode === "default") {
				await access(file);
				expect(approvals).toBe(1);
			} else {
				await expect(access(file)).rejects.toThrow();
				expect(approvals).toBe(0);
			}
		} finally {
			await created.value.close();
		}
	});
}

test("shared extension gets independent four-child limits per session", async () => {
	const root = await temporaryDirectory();
	const extension = createSubagentExtension();
	const gate = Promise.withResolvers<void>();
	const allStarted = Promise.withResolvers<void>();
	let running = 0;
	const input = createInput(root, async (request) => {
		if (request.tools?.some((tool: any) => tool.name === "SpawnAgent")) {
			if (request.messages.length > 1) return assistant("parent complete");
			return {
				...assistant(""),
				stopReason: "toolUse",
				content: Array.from({ length: 5 }, (_, index) => ({
					type: "toolCall" as const,
					id: `spawn-${index}`,
					name: "SpawnAgent",
					arguments: { title: `Task ${index}`, task: `Child ${index}` },
				})),
			};
		}
		if (++running === 8) allStarted.resolve();
		await gate.promise;
		return assistant("child complete");
	});
	const first = await createCodingAgent({ ...input, tools: [], extensions: [extension] });
	const second = await createCodingAgent({ ...input, tools: [], extensions: [extension] });
	if (first.isErr()) throw first.error;
	if (second.isErr()) throw second.error;
	const failures: CodingAgentEvent[] = [];
	for (const agent of [first.value, second.value])
		agent.subscribe((event) => {
			if (event.type === "tool_execution_end" && event.isError) failures.push(event);
		});
	try {
		const prompts = [first.value.prompt("parent one"), second.value.prompt("parent two")];
		await allStarted.promise;
		expect(running).toBe(8);
		gate.resolve();
		for (const result of await Promise.all(prompts)) expect(result.isOk()).toBe(true);
		expect(failures).toHaveLength(2);
		expect(JSON.stringify(failures)).toContain("At most 4 subagents");
	} finally {
		gate.resolve();
		await first.value.close();
		await second.value.close();
	}
});

for (const action of ["abort", "close"] as const) {
	test(`parent ${action} cancels and joins a child tool`, async () => {
		const root = await temporaryDirectory();
		const started = Promise.withResolvers<void>();
		let stopped = false;
		const created = await createCodingAgent({
			...createInput(root, [
				assistantToolCall("SpawnAgent", "spawn", { title: "Wait", task: "wait" }),
				assistantToolCall("Wait", "wait", {}),
			]),
			extensions: [
				createSubagentExtension(),
				defineExtension({
					id: "wait",
					tools: [
						{
							name: "Wait",
							description: "Wait until cancelled",
							parameters: Type.Object({}),
							authorization: { owner: "extension" },
							async execute(_runtime, call) {
								await new Promise<void>((resolve) => {
									const stop = () => {
										stopped = true;
										resolve();
									};
									if (call.signal?.aborted) stop();
									else call.signal?.addEventListener("abort", stop, { once: true });
									started.resolve();
								});
								return { content: [{ type: "text", text: "stopped" }] };
							},
						},
					],
				}),
			],
		});
		if (created.isErr()) throw created.error;
		try {
			const prompt = created.value.prompt("delegate waiting");
			await started.promise;
			await created.value[action]();
			await prompt;
			expect(stopped).toBe(true);
		} finally {
			await created.value.close();
		}
	});
}

test("blank tasks and children with no final text fail safely", async () => {
	const root = await temporaryDirectory();
	const created = await createCodingAgent({
		...createInput(root, [
			assistantToolCall("SpawnAgent", "blank", { title: "blank", task: "   " }),
			assistant("rejected"),
			assistantToolCall("SpawnAgent", "empty", { title: "empty", task: "say nothing" }),
			assistant(""),
			assistant("handled"),
		]),
		extensions: [createSubagentExtension()],
	});
	if (created.isErr()) throw created.error;
	const events: CodingAgentEvent[] = [];
	created.value.subscribe((event) => {
		if (event.type === "tool_execution_end") events.push(event);
	});
	try {
		await created.value.prompt("blank");
		await created.value.prompt("empty");
		expect(events).toHaveLength(2);
		for (const event of events) expect(event).toMatchObject({ isError: true });
		expect(JSON.stringify(events)).toContain("without a final response");
	} finally {
		await created.value.close();
	}
});

test("child provider failure reports a safe failure instead of successful empty output", async () => {
	const root = await temporaryDirectory();
	const created = await createCodingAgent({
		...createInput(root, [
			assistantToolCall("SpawnAgent", "spawn", { title: "Fail", task: "fail" }),
			{ ...assistant(""), stopReason: "error" },
			assistant("handled"),
		]),
		extensions: [createSubagentExtension()],
	});
	if (created.isErr()) throw created.error;
	const events: CodingAgentEvent[] = [];
	created.value.subscribe((event) => {
		if (event.type === "tool_execution_end") events.push(event);
	});
	try {
		await created.value.prompt("delegate");
		expect(events).toEqual([expect.objectContaining({ isError: true })]);
		expect(JSON.stringify(events)).toContain("Agent model execution failed");
		expect(JSON.stringify(events)).not.toContain("fake provider failure");
	} finally {
		await created.value.close();
	}
});

test("old built-in selection is rejected and repeated extension installation fails explicitly", async () => {
	for (const name of ["UpdateTodos", "SpawnAgent"]) {
		const created = await createCodingAgent({ model: "anthropic/test-model", tools: [name as never] });
		expect(created).toMatchObject({ status: "error", error: { code: "coding_sdk.invalid_tool_selection" } });
	}
	const root = await temporaryDirectory();
	const created = await createCodingAgent({
		...createInput(root, []),
		extensions: [createSubagentExtension(), createSubagentExtension()],
	});
	expect(created.isErr()).toBe(true);
	if (created.isOk()) await created.value.close();
});
