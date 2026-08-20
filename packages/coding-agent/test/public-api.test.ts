import { afterEach, describe, expect, test } from "bun:test";
import { type AssistantMessage, zeroUsage } from "@jai/ai";
import { Type } from "@sinclair/typebox";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodingAgent, defineExtension, type CodingAgentCreateOptions } from "../src/sdk";

const roots: string[] = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	for (const server of servers.splice(0)) server.stop(true);
});

describe("public Coding Agent SDK", () => {
	test("creates a runnable Agent and persists a session", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const input = createInput(root, [assistant("done")]);

		const created = await createCodingAgent({
			...input,
			session: { kind: "new", id: "public-session", directory: join(root, "sessions") },
			permissionMode: "default",
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		const events: string[] = [];
		const unsubscribe = created.value.subscribe((event) => events.push(event.type));
		const result = await created.value.prompt("hello");
		unsubscribe();

		expect(result.isOk()).toBe(true);
		expect(events).toContain("agent_start");
		expect(events).toContain("agent_end");
		expect(created.value.state.messages.at(-1)).toMatchObject({ role: "assistant" });
		const closed = await created.value.close();
		expect(closed.isOk()).toBe(true);

		const resumed = await createCodingAgent({
			...input,
			session: { kind: "resume", id: "public-session", directory: join(root, "sessions") },
		});
		expect(resumed.isOk()).toBe(true);
		if (resumed.isOk()) await resumed.value.close();
	});

	test("resume never silently creates a missing session", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const result = await createCodingAgent({
			...createInput(root, [assistant("unused")]),
			session: { kind: "resume", id: "missing", directory: join(root, "sessions") },
		});

		expect(result).toMatchObject({
			status: "error",
			error: { code: "coding_sdk.session_not_found", phase: "session" },
		});
	});

	test("accepts plan mode and defers read-only enforcement to the permission layer", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const result = await createCodingAgent({
			...createInput(root, [assistant("unused")]),
			session: { kind: "ephemeral" },
			permissionMode: "plan",
		});

		expect(result.status).toBe("ok");
		if (result.status === "ok") await result.value.close();
	});

	test("owns Artifact state and persists it without a Desktop projection subscriber", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const input = createInput(root, [
			assistantToolCall("Write", "write-1", { path: "report.md", content: "# Report" }),
			assistant("done"),
		]);
		const created = await createCodingAgent({
			...input,
			session: { kind: "new", id: "artifact-session", directory: join(root, "sessions") },
			permissionMode: "bypassPermissions",
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		const run = await created.value.prompt("Write the report");
		expect(run.isOk()).toBe(true);
		expect(created.value.state.artifacts).toEqual([
			expect.objectContaining({ id: "artifact:report.md", path: "report.md", format: "markdown" }),
		]);
		await created.value.close();

		const resumed = await createCodingAgent({
			...input,
			session: { kind: "resume", id: "artifact-session", directory: join(root, "sessions") },
		});
		expect(resumed.isOk()).toBe(true);
		if (resumed.isErr()) return;
		expect(resumed.value.state.artifacts).toEqual([
			expect.objectContaining({ id: "artifact:report.md", path: "report.md", format: "markdown" }),
		]);
		await resumed.value.close();
	});

	test("serializes public prompts and waitForIdle drains the admitted queue", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const responses = [assistant("first"), assistant("second")];
		const input = createInput(root, responses);
		const created = await createCodingAgent({
			...input,
			session: { kind: "ephemeral" },
			permissionMode: "bypassPermissions",
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		const first = created.value.prompt("first request");
		const second = created.value.prompt("second request");
		const idle = created.value.waitForIdle();
		const [firstResult, secondResult, idleResult] = await Promise.all([first, second, idle]);

		expect(firstResult.isOk()).toBe(true);
		expect(secondResult.isOk()).toBe(true);
		expect(idleResult.isOk()).toBe(true);
		expect(created.value.state.messages.filter((message) => message.role === "user")).toHaveLength(2);
		await created.value.close();
	});

	test("projects public events, state, and failures as JSON-safe DTOs", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const input = createInput(root, [assistant("done")]);
		const created = await createCodingAgent({
			...input,
			session: { kind: "ephemeral" },
			permissionMode: "bypassPermissions",
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		const events: unknown[] = [];
		const unsubscribe = created.value.subscribe((event) => events.push(event));
		const run = await created.value.prompt("hello");
		unsubscribe();
		expect(run.isOk()).toBe(true);
		assertJsonSafe(JSON.parse(JSON.stringify({ events, state: created.value.state, run })));
		await created.value.close();

		const failed = await createCodingAgent({
			...input,
			model: "unsupported/test",
			session: { kind: "ephemeral" },
		});
		expect(failed.isErr()).toBe(true);
		assertJsonSafe(JSON.parse(JSON.stringify(failed)));
	});

	test("initializes extensions in order and closes them in reverse order", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const calls: string[] = [];
		const extension = (name: string) =>
			defineExtension({
				id: `lifecycle-${name}`,
				initialize: async () => {
					calls.push(`init:${name}`);
					return {
						dispose: async () => {
							calls.push(`dispose:${name}`);
						},
					};
				},
			});
		const created = await createCodingAgent({
			...createInput(root, [assistant("done")]),
			extensions: [extension("first"), extension("second")],
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;
		await created.value.close();
		expect(calls).toEqual(["init:first", "init:second", "dispose:second", "dispose:first"]);
	});

	test("rolls back initialized extensions for initialization and capability conflicts", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const calls: string[] = [];
		const disposable = (name: string, toolName?: string) =>
			defineExtension({
				id: `disposable-${name}`,
				initialize: async () => {
					calls.push(`init:${name}`);
					return {
						...(toolName
							? {
									tools: [
										{
											name: toolName,
											description: toolName,
											parameters: Type.Object({}),
											authorization: {
												owner: "core" as const,
												permission: { sideEffect: "read" as const, reason: "Read test data" },
											},
											execute: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
										},
									],
								}
							: {}),
						dispose: async () => {
							calls.push(`dispose:${name}`);
						},
					};
				},
			});
		const initializationFailed = await createCodingAgent({
			...createInput(root, [assistant("unused")]),
			extensions: [
				disposable("first"),
				defineExtension({
					id: "broken-extension",
					initialize: async () => {
						throw new Error("broken extension");
					},
				}),
			],
		});
		expect(initializationFailed.isErr()).toBe(true);
		expect(calls).toEqual(["init:first", "dispose:first"]);

		calls.length = 0;
		const conflicted = await createCodingAgent({
			...createInput(root, [assistant("unused")]),
			extensions: [disposable("first", "ExtensionRead"), disposable("second", "ExtensionRead")],
		});
		expect(conflicted).toMatchObject({
			status: "error",
			error: { code: "coding_sdk.extension_capability_conflict" },
		});
		expect(calls).toEqual(["init:first", "init:second", "dispose:second", "dispose:first"]);
	});

	test("runs extension hooks in declaration order, validates transformed arguments, then asks permission", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const order: string[] = [];
		const executed: string[] = [];
		let approvals = 0;
		const created = await createCodingAgent({
			...createInput(root, [
				assistantToolCall("ExtensionWrite", "extension-write", { value: "original" }),
				assistant("done"),
			]),
			permissionMode: "acceptEdits",
			requestApproval: () => {
				approvals++;
				return "allowOnce";
			},
			extensions: [
				defineExtension({
					id: "extension-hooks-first",
					initialize: async () => ({
						tools: [
							{
								name: "ExtensionWrite",
								description: "Writes extension state",
								parameters: Type.Object({ value: Type.String() }),
								authorization: {
									owner: "core",
									permission: { sideEffect: "write", reason: "Writes extension state" },
								},
								execute: async ({ args }) => {
									executed.push(String(args.value));
									order.push("execute");
									return { content: [{ type: "text", text: "written" }] };
								},
							},
						],
						hooks: {
						beforeToolCall: ({ args }) => {
							order.push(`before:first:${args.value}`);
							return { kind: "continue", args: { value: "first" } };
						},
						afterToolCall: () => {
							order.push("after:first");
						},
						},
					}),
				}),
				defineExtension({
					id: "extension-hooks-second",
					initialize: async () => ({
						hooks: {
						beforeToolCall: ({ args }) => {
							order.push(`before:second:${args.value}`);
							return { kind: "continue", args: { value: "second" } };
						},
						afterToolCall: () => {
							order.push("after:second");
						},
						},
					}),
				}),
			],
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;
		const run = await created.value.prompt("write state");
		expect(run.isOk()).toBe(true);
		if (run.isErr()) throw new Error(`${run.error.code}: ${run.error.message}`);
		await created.value.close();
		expect(approvals).toBe(1);
		expect(executed).toEqual(["second"]);
		expect(order).toEqual([
			"before:first:original",
			"before:second:first",
			"execute",
			"after:first",
			"after:second",
		]);
	});

	test("uses asynchronous Extension permission metadata in the core approval path", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const observed: string[] = [];
		const approvals: string[] = [];
		const created = await createCodingAgent({
			...createInput(root, [
				assistantToolCall("DynamicExtensionWrite", "dynamic-write", { value: "record" }),
				assistant("done"),
			]),
			requestApproval: (request) => {
				approvals.push(request.reason);
				return "allowOnce";
			},
			extensions: [
				defineExtension({
					id: "dynamic-extension-write",
					initialize: async () => ({
						tools: [
						{
							name: "DynamicExtensionWrite",
							description: "Writes dynamic extension state",
							parameters: Type.Object({ value: Type.String() }),
							authorization: {
								owner: "core",
								permission: async ({ toolCallId, args }) => {
								observed.push(`${toolCallId}:${args.value}`);
								return {
									sideEffect: "write",
									reason: `Writes ${args.value}`,
								};
								},
							},
							execute: async () => ({ content: [{ type: "text", text: "written" }] }),
						},
					],
					}),
				}),
			],
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;
		const run = await created.value.prompt("write dynamic state");
		expect(run.isOk()).toBe(true);
		if (run.isErr()) throw new Error(`${run.error.code}: ${run.error.message}`);
		await created.value.close();
		expect(observed).toEqual(["dynamic-write:record"]);
		expect(approvals).toEqual(["Writes record"]);
	});

	test("rejects invalid transformed arguments before permission and never bypasses extension permissions", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		let approvals = 0;
		let executions = 0;
		const invalid = defineExtension({
			id: "invalid-extension-write",
			initialize: async () => ({
				tools: [
				{
					name: "ExtensionWrite",
					description: "Writes extension state",
					parameters: Type.Object({ value: Type.String() }),
					authorization: {
						owner: "core",
						permission: { sideEffect: "write", reason: "Writes extension state" },
					},
					execute: async () => {
						executions++;
						return { content: [{ type: "text", text: "written" }] };
					},
				},
				],
				hooks: {
				beforeToolCall: () => ({ kind: "continue", args: {} }),
			},
			}),
		});
		const invalidCreated = await createCodingAgent({
			...createInput(root, [
				assistantToolCall("ExtensionWrite", "invalid-arguments", { value: "original" }),
				assistant("done"),
			]),
			requestApproval: () => {
				approvals++;
				return "allowOnce";
			},
			extensions: [invalid],
		});
		expect(invalidCreated.isOk()).toBe(true);
		if (invalidCreated.isErr()) return;
		await invalidCreated.value.prompt("write state");
		await invalidCreated.value.close();
		expect({ approvals, executions }).toEqual({ approvals: 0, executions: 0 });

		const destructive = defineExtension({
			id: "destructive-extension",
			initialize: async () => ({
				tools: [
				{
					name: "ExtensionDestroy",
					description: "Destroys extension state",
					parameters: Type.Object({}),
					authorization: {
						owner: "core",
						permission: { sideEffect: "destructive", reason: "Destroys extension state" },
					},
					execute: async () => {
						executions++;
						return { content: [{ type: "text", text: "destroyed" }] };
					},
				},
				],
			}),
		});
		const destructiveCreated = await createCodingAgent({
			...createInput(root, [assistantToolCall("ExtensionDestroy", "destroy", {}), assistant("done")]),
			permissionMode: "bypassPermissions",
			extensions: [destructive],
		});
		expect(destructiveCreated.isOk()).toBe(true);
		if (destructiveCreated.isErr()) return;
		await destructiveCreated.value.prompt("destroy state");
		await destructiveCreated.value.close();
		expect(executions).toBe(0);

		let planApprovals = 0;
		const planCreated = await createCodingAgent({
			...createInput(root, [assistantToolCall("ExtensionPlanWrite", "plan-write", {}), assistant("done")]),
			permissionMode: "plan",
			requestApproval: () => {
				planApprovals++;
				return "allowOnce";
			},
			extensions: [
				defineExtension({
					id: "plan-extension-write",
					initialize: async () => ({
						tools: [
						{
							name: "ExtensionPlanWrite",
							description: "Writes extension state",
							parameters: Type.Object({}),
							authorization: {
								owner: "core",
								permission: { sideEffect: "write", reason: "Writes extension state" },
							},
							execute: async () => {
								executions++;
								return { content: [{ type: "text", text: "written" }] };
							},
						},
						],
					}),
				}),
			],
		});
		expect(planCreated.isOk()).toBe(true);
		if (planCreated.isErr()) return;
		await planCreated.value.prompt("write state");
		await planCreated.value.close();
		expect({ planApprovals, executions }).toEqual({ planApprovals: 0, executions: 0 });
	});
});

function createInput(
	root: string,
	responses: AssistantMessage[],
): Omit<CodingAgentCreateOptions, "session"> {
	const server = Bun.serve({
		port: 0,
		fetch() {
			const response = responses.shift();
			if (!response) return new Response("No fake provider response left", { status: 500 });
			return new Response(anthropicEvents(response), {
				headers: { "content-type": "text/event-stream" },
			});
		},
	});
	servers.push(server);
	return {
		model: "anthropic/test-model",
		cwd: root,
		provider: { apiKey: "test", baseUrl: server.url.toString() },
	};
}

function anthropicEvents(message: AssistantMessage): string {
	const events = [
		sse("message_start", {
			type: "message_start",
			message: {
				id: "message-id",
				type: "message",
				role: "assistant",
				model: message.model,
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { input_tokens: 1, output_tokens: 0 },
			},
		}),
	];
	for (const [index, content] of message.content.entries()) {
		if (content.type === "text") {
			events.push(
				sse("content_block_start", {
					type: "content_block_start",
					index,
					content_block: { type: "text", text: "" },
				}),
				sse("content_block_delta", {
					type: "content_block_delta",
					index,
					delta: { type: "text_delta", text: content.text },
				}),
			);
		} else if (content.type === "toolCall") {
			events.push(
				sse("content_block_start", {
					type: "content_block_start",
					index,
					content_block: { type: "tool_use", id: content.id, name: content.name, input: {} },
				}),
				sse("content_block_delta", {
					type: "content_block_delta",
					index,
					delta: { type: "input_json_delta", partial_json: JSON.stringify(content.arguments) },
				}),
			);
		}
		events.push(sse("content_block_stop", { type: "content_block_stop", index }));
	}
	events.push(
		sse("message_delta", {
			type: "message_delta",
			delta: {
				stop_reason: message.stopReason === "toolUse" ? "tool_use" : "end_turn",
				stop_sequence: null,
			},
			usage: { output_tokens: 1 },
		}),
		sse("message_stop", { type: "message_stop" }),
	);
	return events.join("");
}

function sse(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		provider: "test",
		model: "test-model",
		usage: zeroUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function assistantToolCall(
	name: string,
	id: string,
	argumentsValue: Readonly<Record<string, unknown>>,
): AssistantMessage {
	return {
		...assistant(""),
		content: [{ type: "toolCall", id, name, arguments: argumentsValue }],
		stopReason: "toolUse",
	};
}

function assertJsonSafe(value: unknown): void {
	if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return;
	expect(typeof value).not.toBe("undefined");
	expect(typeof value).not.toBe("function");
	if (Array.isArray(value)) {
		for (const item of value) assertJsonSafe(item);
		return;
	}
	expect(typeof value).toBe("object");
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		expect(key).not.toBe("stack");
		expect(key).not.toBe("cause");
		assertJsonSafe(item);
	}
}
