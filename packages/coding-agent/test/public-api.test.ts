import { afterEach, describe, expect, test } from "bun:test";
import { type AssistantMessage, zeroUsage } from "@jai/ai";
import { InMemorySessionStore } from "@jai/agent";
import { Type } from "@sinclair/typebox";
import { Result } from "better-result";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CodingExtensionOperationFailed,
	CodingCommandExecutionFailed,
	createCodingAgent,
	defineExtension,
	type CodingAgentCreateOptions,
} from "../src/sdk";

const roots: string[] = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];
const sessionStores = new Map<string, InMemorySessionStore>();

afterEach(async () => {
	sessionStores.clear();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	for (const server of servers.splice(0)) server.stop(true);
});

async function openStore(root: string): Promise<InMemorySessionStore> {
	const existing = sessionStores.get(root);
	if (existing) return existing;
	const store = new InMemorySessionStore();
	sessionStores.set(root, store);
	return store;
}

describe("public Coding Agent SDK", () => {
	test("creates a runnable Agent and persists a session", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const input = createInput(root, [assistant("done")]);

		const created = await createCodingAgent({
			...input,
			session: { kind: "new", id: "public-session", store: await openStore(root) },
			permissionMode: "default",
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		const events: string[] = [];
		const entryIds: string[] = [];
		const unsubscribe = created.value.subscribe((event) => {
			events.push(event.type);
			if (event.type === "message_end" && event.entryId) entryIds.push(event.entryId);
		});
		const result = await created.value.prompt("hello");
		unsubscribe();

		expect(result.isOk()).toBe(true);
		expect(events).toContain("agent_start");
		expect(events).toContain("agent_end");
		expect(entryIds).toEqual(["public-session:0", "public-session:1"]);
		expect(created.value.state.messages.at(-1)).toMatchObject({ role: "assistant" });
		expect(await created.value.navigate("missing-entry")).toMatchObject({
			status: "error",
			error: { code: "session.unknown_entry", phase: "navigation" },
		});
		const closed = await created.value.close();
		expect(closed.isOk()).toBe(true);

		const resumed = await createCodingAgent({
			...input,
			session: { kind: "resume", id: "public-session", store: await openStore(root) },
		});
		expect(resumed.isOk()).toBe(true);
		if (resumed.isOk()) await resumed.value.close();
	});

	test("writes a Host-reserved queued input at its exact Session Journal identity", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const store = await openStore(root);
		const created = await createCodingAgent({
			...createInput(root, [assistant("steering consumed")]),
			session: { kind: "new", id: "reserved-input-session", store },
			permissionMode: "bypassPermissions",
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		const advanced = await created.value.advance([
			{ text: "change direction", entryId: "host-steer-entry-1" },
		]);
		expect(advanced.isOk()).toBe(true);
		const stored = await store.load("reserved-input-session");
		expect(stored?.snapshot.entries.at(0)).toMatchObject({
			type: "message",
			id: "host-steer-entry-1",
			parentId: null,
			message: { role: "user", content: "change direction" },
		});
		expect(stored?.snapshot.entries.filter((entry) => entry.id === "host-steer-entry-1")).toHaveLength(1);
		await created.value.close();
	});

	test("resume never silently creates a missing session", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const result = await createCodingAgent({
			...createInput(root, [assistant("unused")]),
			session: { kind: "resume", id: "missing", store: await openStore(root) },
		});

		expect(result).toMatchObject({
			status: "error",
			error: { code: "coding_sdk.session_not_found", phase: "session" },
		});
	});

	test("persistent sessions require Host-provided file capabilities", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const { fileCapabilities: _fileCapabilities, ...input } = createInput(root, [assistant("unused")]);

		const result = await createCodingAgent({
			...input,
			session: { kind: "new", id: "missing-file-capabilities", store: await openStore(root) },
		});

		expect(result).toMatchObject({
			status: "error",
			error: {
				code: "coding_sdk.file_capabilities_required",
				phase: "runtime_creation",
			},
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

	test("dispatches Extension commands with raw args, stable duplicate suffixes, and unknown slash fallback", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-commands-"));
		roots.push(root);
		const observed: Array<{
			readonly args: string;
			readonly cwd: string;
			readonly extensionId: string;
			readonly sessionId: string;
			readonly sessionStateCount?: number;
		}> = [];
		const created = await createCodingAgent({
			...createInput(root, [assistant("unknown slash reached the model")]),
			session: { kind: "ephemeral" },
			extensions: [
				defineExtension({
					id: "first-review-command",
					sessionState: {
						schema: Type.Object({ invocations: Type.Number() }),
						defaultValue: { invocations: 0 },
					},
					lifecycle: {
						activate: (context) => {
							const registered = context.registerCommand({
								name: "review",
								description: "Run the first review",
								handler: async (args, commandContext) => {
									const updated = await commandContext.sessionState.update((current) => ({
										invocations: current.invocations + 1,
									}));
									if (updated.isErr()) return Result.err(new CodingCommandExecutionFailed({ message: updated.error.message }));
									observed.push({
										args,
										cwd: commandContext.cwd,
										extensionId: commandContext.extensionId,
										sessionId: commandContext.sessionId,
										sessionStateCount: updated.value.invocations,
									});
									return Result.ok({ kind: "handled" });
								},
							});
								return registered.isErr() ? Result.err(registered.error) : Result.ok(undefined);
						},
					},
				}),
				defineExtension({
					id: "second-review-command",
					lifecycle: {
						activate: (context) => {
							const registered = context.registerCommand({
								name: "review",
								description: "Run the second review",
								handler: (args, commandContext) => {
									observed.push({
										args,
										cwd: commandContext.cwd,
										extensionId: commandContext.extensionId,
										sessionId: commandContext.sessionId,
									});
									return Result.ok({ kind: "handled" });
								},
							});
								return registered.isErr() ? Result.err(registered.error) : Result.ok(undefined);
						},
					},
				}),
			],
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		expect(await created.value.prompt("/review:1  inspect first  ")).toMatchObject({ status: "ok" });
		expect(await created.value.prompt("/review:2 inspect second")).toMatchObject({ status: "ok" });
		expect(await created.value.prompt("/unknown keep this text")).toMatchObject({ status: "ok" });
		expect(observed).toEqual([
			{
				args: "inspect first  ",
				cwd: root,
				extensionId: "first-review-command",
				sessionId: expect.any(String),
				sessionStateCount: 1,
			},
			{
				args: "inspect second",
				cwd: root,
				extensionId: "second-review-command",
				sessionId: expect.any(String),
			},
		]);
		expect(created.value.state.messages[0]).toMatchObject({
			role: "user",
			content: "/unknown keep this text",
		});
		await created.value.close();
	});

	test("runs prompt-result Extension commands through the model pipeline with safe invocation metadata", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-command-prompt-"));
		roots.push(root);
		const requests: unknown[] = [];
		const created = await createCodingAgent({
			...createInput(root, [assistant("expanded command complete")], requests),
			session: { kind: "ephemeral" },
			extensions: [
				defineExtension({
					id: "prompt-command",
					lifecycle: {
						activate: (context) => {
							const registered = context.registerCommand({
								name: "template",
								description: "Expand a prompt template",
								handler: (args) => Result.ok({ kind: "prompt", prompt: `Template context: ${args}` }),
							});
								return registered.isErr() ? Result.err(registered.error) : Result.ok(undefined);
						},
					},
				}),
			],
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		const run = await created.value.prompt("/template preserve these args");
		expect(run).toMatchObject({ status: "ok" });
		expect(JSON.stringify(requests)).toContain("Template context: preserve these args");
		expect(created.value.state.messages[0]).toMatchObject({
			role: "user",
			content: "/template preserve these args",
			metadata: {
				slashInvocation: {
					name: "template",
					kind: "command",
					commandKind: "extension",
				},
			},
		});
		expect(JSON.stringify(created.value.state)).not.toContain("Template context:");
		await created.value.close();
	});

	test("projects command handler failures without their diagnostic cause", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-command-failure-"));
		roots.push(root);
		const created = await createCodingAgent({
			...createInput(root, [assistant("unused")]),
			session: { kind: "ephemeral" },
			extensions: [
				defineExtension({
					id: "failing-command",
					lifecycle: {
						activate: (context) => {
							const registered = context.registerCommand({
								name: "fail",
								description: "Fail for test coverage",
								handler: () =>
									Result.err(
										new CodingCommandExecutionFailed({
											message: "Command failed safely",
											cause: { secret: "must not project" },
										}),
									),
							});
								return registered.isErr() ? Result.err(registered.error) : Result.ok(undefined);
						},
					},
				}),
			],
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		const run = await created.value.prompt("/fail");
		expect(run).toMatchObject({ status: "error", error: { code: "coding_command.execution_failed" } });
		expect(JSON.stringify(run)).not.toContain("must not project");
		await created.value.close();
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
			session: { kind: "new", id: "artifact-session", store: await openStore(root) },
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
			session: { kind: "resume", id: "artifact-session", store: await openStore(root) },
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

	test("runs typed Extension lifecycle hooks and settles only after the admitted queue drains", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const calls: string[] = [];
		let settled!: () => void;
		const settledPromise = new Promise<void>((resolve) => {
			settled = resolve;
		});
		const created = await createCodingAgent({
			...createInput(root, [assistant("first"), assistant("second")]),
			extensions: [
				defineExtension({
					id: "lifecycle-hooks",
					hooks: {
						beforeAgentStart: (_runtime, { prompt }) => {
							calls.push(`before-agent:${prompt}`);
							return { kind: "continue" };
						},
						turnStart: () => {
							calls.push("turn-start");
						},
						beforeModelCall: () => {
							calls.push("before-model");
							return { context: "Extension request context" };
						},
						turnEnd: (_runtime, { outcome }) => {
							calls.push(`turn-end:${outcome}`);
						},
						afterModelCall: (_runtime, { outcome }) => {
							calls.push(`after-model:${outcome}`);
						},
						agentSettled: (_runtime, { idleEpoch, outcome }) => {
							calls.push(`settled:${idleEpoch}:${outcome}`);
							settled();
						},
					},
				}),
			],
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		const [first, second] = await Promise.all([created.value.prompt("first"), created.value.prompt("second")]);
		expect(first.isOk()).toBe(true);
		expect(second.isOk()).toBe(true);
		await settledPromise;
		expect(calls).toEqual([
			"before-agent:first",
			"turn-start",
			"before-model",
			"turn-end:completed",
			"after-model:completed",
			"before-agent:second",
			"turn-start",
			"before-model",
			"turn-end:completed",
			"after-model:completed",
			"settled:2:completed",
		]);
		await created.value.close();
	});

	test("fails closed when beforeAgentStart blocks a public prompt", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const created = await createCodingAgent({
			...createInput(root, [assistant("unused")]),
			extensions: [
				defineExtension({
					id: "prompt-policy",
					hooks: {
						beforeAgentStart: () => ({ kind: "block", reason: "Prompt violates host policy" }),
					},
				}),
			],
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;
		const result = await created.value.prompt("blocked");
		expect(result).toMatchObject({
			status: "error",
			error: { code: "coding_extension.policy_blocked", phase: "admission" },
		});
		await created.value.close();
	});

	test("projects observer hook failures as diagnostics without failing the run", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const diagnostics: unknown[] = [];
		const created = await createCodingAgent({
			...createInput(root, [assistant("done")]),
			extensionRuntime: {
				reportDiagnostic: (diagnostic) => {
					diagnostics.push(diagnostic);
				},
			},
			extensions: [
				defineExtension({
					id: "failing-observer",
					hooks: {
						turnEnd: () => {
							throw new Error("telemetry unavailable");
						},
					},
				}),
			],
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;
		expect((await created.value.prompt("run")).isOk()).toBe(true);
		expect(diagnostics).toEqual([
			{
				code: "coding_extension.hook_failed",
				message: "Extension \"failing-observer\" turn_end hook failed",
				extensionId: "failing-observer",
			},
		]);
		await created.value.close();
	});

	test("persists isolated Extension session state across resume and concurrent updates", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const observed: number[] = [];
		const updated: number[] = [];
		const extension = defineExtension({
			id: "counter-state",
			sessionState: {
				schema: Type.Object({ count: Type.Integer({ minimum: 0 }) }),
				defaultValue: { count: 0 },
			},
			lifecycle: {
				activate: async (context) => {
					observed.push(context.sessionState.value.count);
					const persisted = await Promise.all([
						context.sessionState.update((current) => ({ count: current.count + 1 })),
						context.sessionState.update((current) => ({ count: current.count + 1 })),
					]);
					for (const result of persisted) if (result.isErr()) throw result.error;
					updated.push(context.sessionState.value.count);
					return Result.ok(undefined);
				},
			},
		});
		const session = { kind: "new" as const, id: "extension-state", store: await openStore(root) };
		const first = await createCodingAgent({ ...createInput(root, [assistant("unused")]), session, extensions: [extension] });
		expect(first.isOk()).toBe(true);
		if (first.isErr()) return;
		expect(first.value.state.appState).toEqual({});
		await first.value.close();

		const resumed = await createCodingAgent({
			...createInput(root, [assistant("unused")]),
			session: { kind: "resume", id: "extension-state", store: await openStore(root) },
			extensions: [extension],
		});
		expect(resumed.isOk()).toBe(true);
		if (resumed.isErr()) return;
		await resumed.value.close();
		expect(observed).toEqual([0, 2]);
		expect(updated).toEqual([2, 4]);
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
				lifecycle: {
					activate: async () => {
						calls.push(`activate:${name}`);
						return Result.ok(undefined);
					},
					deactivate: async () => {
						calls.push(`dispose:${name}`);
					},
				},
			});
		const created = await createCodingAgent({
			...createInput(root, [assistant("done")]),
			extensions: [extension("first"), extension("second")],
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;
		await created.value.close();
		expect(calls).toEqual(["activate:first", "activate:second", "dispose:second", "dispose:first"]);
	});

	test("rolls back initialized extensions for initialization and capability conflicts", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-coding-agent-public-"));
		roots.push(root);
		const calls: string[] = [];
		const disposable = (name: string, toolName?: string) =>
			defineExtension({
				id: `disposable-${name}`,
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
				lifecycle: {
					activate: async () => {
						calls.push(`activate:${name}`);
						return Result.ok(undefined);
					},
					deactivate: async () => {
						calls.push(`dispose:${name}`);
					},
				},
			});
		const initializationFailed = await createCodingAgent({
			...createInput(root, [assistant("unused")]),
			extensions: [
				disposable("first"),
				defineExtension({
					id: "broken-extension",
					lifecycle: {
						activate: async () => Result.err(new CodingExtensionOperationFailed({ message: "broken extension" })),
					},
				}),
			],
		});
		expect(initializationFailed.isErr()).toBe(true);
		expect(initializationFailed).toMatchObject({
			status: "error",
			error: { code: "coding_extension.activation_failed", phase: "runtime_creation" },
		});
		expect(calls).toEqual(["activate:first", "dispose:first"]);

		calls.length = 0;
		const conflicted = await createCodingAgent({
			...createInput(root, [assistant("unused")]),
			extensions: [disposable("first", "ExtensionRead"), disposable("second", "ExtensionRead")],
		});
			expect(conflicted).toMatchObject({
				status: "error",
				error: { code: "coding_extension.capability_conflict" },
			});
		expect(calls).toEqual([]);
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
					tools: [
							{
								name: "ExtensionWrite",
								description: "Writes extension state",
								parameters: Type.Object({ value: Type.String() }),
								authorization: {
									owner: "core",
									permission: { sideEffect: "write", reason: "Writes extension state" },
								},
								execute: async (_runtime, { args }) => {
									executed.push(String(args.value));
									order.push("execute");
									return { content: [{ type: "text", text: "written" }] };
								},
							},
						],
						hooks: {
						beforeToolCall: (_runtime, { args }) => {
							order.push(`before:first:${args.value}`);
							return { kind: "continue", args: { value: "first" } };
						},
						afterToolCall: () => {
							order.push("after:first");
						},
						},
				}),
				defineExtension({
					id: "extension-hooks-second",
					hooks: {
						beforeToolCall: (_runtime, { args }) => {
							order.push(`before:second:${args.value}`);
							return { kind: "continue", args: { value: "second" } };
						},
						afterToolCall: () => {
							order.push("after:second");
						},
						},
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
					tools: [
						{
							name: "DynamicExtensionWrite",
							description: "Writes dynamic extension state",
							parameters: Type.Object({ value: Type.String() }),
							authorization: {
								owner: "core",
								permission: async (_runtime, { toolCallId, args }) => {
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
	requests?: unknown[],
): Omit<CodingAgentCreateOptions, "session"> {
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			if (requests) requests.push(await request.json());
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
		fileCapabilities: {
			homeDirectory: root,
			workspaceDirectory: root,
			workspaceTrusted: false,
		},
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
