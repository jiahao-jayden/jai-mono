import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { AcpV2Agent } from "../../../src/protocol/acp-v2";
import {
	type RuntimeOperation,
	type RuntimeOperationDriver,
	RuntimeOperationExecutionFailed,
	type RuntimeOperationEvent,
	type RuntimeOperationOpenInput,
} from "../../../src/operations";
import { RuntimeHost } from "../../../src/runtime";
import {
	InMemoryProductSessionPersistence,
	RuntimeSessionConfigurationInvalid,
	type RuntimeSessionConfigurationPolicy,
} from "../../../src/sessions";

function ids(...values: string[]): () => string {
	let index = 0;
	return () => values[index++] ?? `id-${index}`;
}

describe("ACP v2 Agent adapter", () => {
	test("accepts an ACP prompt only after Runtime Host durable admission, then projects user and running updates", async () => {
		const host = new RuntimeHost({
			persistence: new InMemoryProductSessionPersistence(),
			createId: ids("session-1", "operation-1"),
		});
		const agent = new AcpV2Agent({ host, info: { name: "jai", title: "Jai", version: "0.0.0" } });

		const initialized = await agent.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "test-client", version: "1.0.0" } },
		});
		expect(initialized).toEqual([
			{
				jsonrpc: "2.0",
				id: 1,
				result: { protocolVersion: 2, capabilities: { session: {} }, info: { name: "jai", title: "Jai", version: "0.0.0" } },
			},
		]);

		const created = await agent.handle({
			jsonrpc: "2.0",
			id: 2,
			method: "session/new",
			params: { cwd: "/workspace" },
		});
		expect(created).toEqual([{ jsonrpc: "2.0", id: 2, result: { sessionId: "session-1" } }]);

		const prompted = await agent.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "session/prompt",
			params: {
				sessionId: "session-1",
				prompt: [
					{ type: "text", text: "inspect this" },
					{ type: "resource_link", name: "README", uri: "file:///workspace/README.md" },
				],
			},
		});

		expect(prompted).toEqual([
			{ jsonrpc: "2.0", id: 3, result: {} },
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "session-1",
					update: {
						sessionUpdate: "user_message",
						messageId: "operation-1:input",
						content: [
							{ type: "text", text: "inspect this" },
							{ type: "resource_link", name: "README", uri: "file:///workspace/README.md" },
						],
					},
				},
			},
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: { sessionId: "session-1", update: { sessionUpdate: "state_update", state: "running" } },
			},
		]);
	});

	test("does not accept session methods before initialize", async () => {
		const agent = new AcpV2Agent({
			host: new RuntimeHost({ persistence: new InMemoryProductSessionPersistence() }),
			info: { name: "jai", version: "0.0.0" },
		});

		const output = await agent.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "session/list",
			params: {},
		});

		expect(output).toEqual([
			{
				jsonrpc: "2.0",
				id: 1,
				error: { code: -32002, message: "ACP connection is not initialized" },
			},
		]);
	});

	test("lists Sessions without a Product title field", async () => {
		const host = new RuntimeHost({
			persistence: new InMemoryProductSessionPersistence(),
			createId: ids("session-1"),
			now: () => new Date("2026-08-25T10:00:00.000Z"),
		});
		const agent = new AcpV2Agent({ host, info: { name: "jai", version: "0.0.0" } });
		await agent.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "test-client", version: "1.0.0" } },
		});
		await agent.handle({
			jsonrpc: "2.0",
			id: 2,
			method: "session/new",
			params: { cwd: "/workspace" },
		});

		const listed = await agent.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "session/list",
			params: {},
		});

		expect(listed).toEqual([
			{
				jsonrpc: "2.0",
				id: 3,
				result: {
					sessions: [{ sessionId: "session-1", cwd: "/workspace", updatedAt: "2026-08-25T10:00:00.000Z" }],
				},
			},
		]);
		expect((listed[0] as { result: { sessions: readonly unknown[] } }).result.sessions[0]).not.toHaveProperty("title");
	});

	test("uses ACP v2 session config options to durably set a later Session model", async () => {
		const persistence = new InMemoryProductSessionPersistence();
		const agent = new AcpV2Agent({
			host: new RuntimeHost({
				persistence,
				configurationPolicy: configuredSessionPolicy(),
				createId: ids("session-1"),
			}),
			info: { name: "jai", version: "0.0.0" },
		});
		await agent.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "test-client", version: "1.0.0" } },
		});

		const created = await agent.handle({
			jsonrpc: "2.0",
			id: 2,
			method: "session/new",
			params: { cwd: "/workspace" },
		});
		expect(created).toMatchObject([
			{
				jsonrpc: "2.0",
				id: 2,
				result: {
					sessionId: "session-1",
					configOptions: [
						{ configId: "model", category: "model", type: "select", currentValue: "profile/model-a" },
						{ configId: "mode", category: "mode", type: "select", currentValue: "manual" },
					],
				},
			},
		]);

		const updated = await agent.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "session/set_config_option",
			params: { sessionId: "session-1", configId: "model", type: "id", value: "profile/model-b" },
		});
		expect(updated).toHaveLength(2);
		expect(updated[0]).toMatchObject({
			jsonrpc: "2.0",
			id: 3,
		});
		const responseOptions = (updated[0] as { readonly result: { readonly configOptions: readonly { readonly configId: string; readonly currentValue: string }[] } })
			.result.configOptions;
		expect(responseOptions.find((option) => option.configId === "model")).toMatchObject({
			currentValue: "profile/model-b",
		});
		expect(updated[1]).toMatchObject({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: "session-1",
				update: { sessionUpdate: "config_option_update" },
			},
		});
		const notificationOptions = (
			updated[1] as {
				readonly params: {
					readonly update: { readonly configOptions: readonly { readonly configId: string; readonly currentValue: string }[] };
				};
			}
		).params.update.configOptions;
		expect(notificationOptions.find((option) => option.configId === "model")).toMatchObject({
			currentValue: "profile/model-b",
		});

		const durable = await persistence.load("session-1");
		if (durable.isErr()) throw durable.error;
		expect(durable.value.runtimeConfiguration).toEqual({ model: "profile/model-b", mode: "manual" });
	});

	test("does not expose Desktop Catalog control methods through the ACP Agent adapter", async () => {
		const agent = new AcpV2Agent({
			host: new RuntimeHost({ persistence: new InMemoryProductSessionPersistence() }),
			info: { name: "jai", version: "0.0.0" },
		});
		await agent.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "test-client", version: "1.0.0" } },
		});

		const output = await agent.handle({
			jsonrpc: "2.0",
			id: 2,
			method: "jai/desktop-catalog/projects/list",
			params: {},
		});

		expect(output).toEqual([
			{
				jsonrpc: "2.0",
				id: 2,
				error: { code: -32601, message: 'Unsupported ACP method "jai/desktop-catalog/projects/list"' },
			},
		]);
	});

	test("projects a cumulative usage cost after settlement and replays it from the durable ledger", async () => {
		const livePersistence = new InMemoryProductSessionPersistence();
		const driver = new ProjectionDriver();
		const liveHost = new RuntimeHost({
			persistence: livePersistence,
			operationDriver: driver,
			createId: ids("session-1", "operation-1"),
		});
		const liveAgent = new AcpV2Agent({ host: liveHost, info: { name: "jai", version: "0.0.0" } });
		await liveAgent.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "test-client", version: "1.0.0" } },
		});
		await liveAgent.handle({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/workspace" } });
		await liveAgent.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "session/prompt",
			params: { sessionId: "session-1", prompt: [{ type: "text", text: "count usage" }] },
		});
		await driver.opened;
		driver.emit({ type: "usage_settled", cost: 0.0125 });
		expect(liveAgent.drain()).toEqual([
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: { sessionId: "session-1", update: { sessionUpdate: "usage_update", cost: 0.0125 } },
			},
		]);
		driver.finish("completed");
		await driver.closed;
		await liveAgent.close();

		const replayPersistence = new InMemoryProductSessionPersistence();
		const replayHost = new RuntimeHost({
			persistence: replayPersistence,
			createId: ids("session-2", "operation-2"),
		});
		const direct = await replayHost.openSession({ kind: "new", cwd: "/workspace" });
		if (direct.isErr()) throw direct.error;
		const admitted = await direct.value.prompt({ text: "persisted usage" });
		if (admitted.isErr()) throw admitted.error;
		const attempted = await replayPersistence.appendOperation({
			sessionId: "session-2",
			record: {
				type: "model_attempted",
				operationId: "operation-2",
				attemptId: "attempt-1",
				assistantEntryId: "assistant-1",
				modelSnapshotId: "test:test-model",
				timestamp: "2026-08-26T00:00:00.000Z",
			},
		});
		if (attempted.isErr()) throw attempted.error;
		const settled = await replayPersistence.appendOperation({
			sessionId: "session-2",
			record: {
				type: "usage_settled",
				operationId: "operation-2",
				attemptId: "attempt-1",
				usage: usage(0.0125),
				timestamp: "2026-08-26T00:00:01.000Z",
			},
		});
		if (settled.isErr()) throw settled.error;
		await direct.value.close();

		const replayAgent = new AcpV2Agent({ host: replayHost, info: { name: "jai", version: "0.0.0" } });
		await replayAgent.handle({
			jsonrpc: "2.0",
			id: 4,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "replay-client", version: "1.0.0" } },
		});
		const resumed = await replayAgent.handle({
			jsonrpc: "2.0",
			id: 5,
			method: "session/resume",
			params: { sessionId: "session-2", cwd: "/workspace", replayFrom: { type: "start" } },
		});
		expect(resumed).toContainEqual(
			expect.objectContaining({
				method: "session/update",
				params: { sessionId: "session-2", update: { sessionUpdate: "usage_update", cost: 0.0125 } },
			}),
		);
		await replayAgent.close();
	});

	test("projects the durable Coding Agent Todo list as an ACP plan with its cancelled status", async () => {
		const driver = new ProjectionDriver();
		const host = new RuntimeHost({
			persistence: new InMemoryProductSessionPersistence(),
			operationDriver: driver,
			createId: ids("session-1", "operation-1"),
		});
		const agent = new AcpV2Agent({ host, info: { name: "jai", version: "0.0.0" } });
		await agent.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "test-client", version: "1.0.0" } },
		});
		await agent.handle({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/workspace" } });
		await agent.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "session/prompt",
			params: { sessionId: "session-1", prompt: [{ type: "text", text: "make a plan" }] },
		});
		await driver.opened;
		await driver.appendTodos([
			{ id: "one", content: "Inspect the repository", status: "completed" },
			{ id: "two", content: "Implement the runtime", status: "in_progress" },
			{ id: "three", content: "Abandoned experiment", status: "cancelled" },
		]);
		expect(agent.drain()).toEqual([
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "session-1",
					update: {
						sessionUpdate: "plan_update",
						plan: {
							planId: "todos",
						entries: [
								{ content: "Inspect the repository", status: "completed" },
								{ content: "Implement the runtime", status: "in_progress" },
								{ content: "Abandoned experiment", status: "cancelled" },
							],
						},
					},
				},
			},
		]);
		driver.finish("completed");
		await driver.closed;
		await agent.close();
	});

	test("projects cancellation only after the Runtime Host records an aborted operation", async () => {
		const host = new RuntimeHost({
			persistence: new InMemoryProductSessionPersistence(),
			createId: ids("session-1", "operation-1"),
		});
		const agent = new AcpV2Agent({ host, info: { name: "jai", version: "0.0.0" } });
		await agent.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "test-client", version: "1.0.0" } },
		});
		await agent.handle({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/workspace" } });
		await agent.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "session/prompt",
			params: { sessionId: "session-1", prompt: [{ type: "text", text: "cancel me" }] },
		});

		const cancelled = await agent.handle({
			jsonrpc: "2.0",
			method: "session/cancel",
			params: { sessionId: "session-1" },
		});

		expect(cancelled).toEqual([
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "session-1",
					update: { sessionUpdate: "state_update", state: "idle", stopReason: "cancelled" },
				},
			},
		]);
	});

	test("rejects a session/cancel request because ACP v2 defines cancellation as a notification", async () => {
		const agent = new AcpV2Agent({
			host: new RuntimeHost({ persistence: new InMemoryProductSessionPersistence() }),
			info: { name: "jai", version: "0.0.0" },
		});
		await agent.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "test-client", version: "1.0.0" } },
		});

		const output = await agent.handle({
			jsonrpc: "2.0",
			id: 2,
			method: "session/cancel",
			params: { sessionId: "missing" },
		});

		expect(output).toEqual([
			{
				jsonrpc: "2.0",
				id: 2,
				error: { code: -32600, message: "session/cancel must be sent as an ACP notification" },
			},
		]);
	});

	test("drains durable Agent output and terminal state that arrive after prompt acknowledgement", async () => {
		const driver = new ProjectionDriver();
		const agent = new AcpV2Agent({
			host: new RuntimeHost({
				persistence: new InMemoryProductSessionPersistence(),
				operationDriver: driver,
				createId: ids("session-1", "operation-1"),
			}),
			info: { name: "jai", version: "0.0.0" },
		});
		await agent.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "test-client", version: "1.0.0" } },
		});
		await agent.handle({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/workspace" } });
		await agent.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "session/prompt",
			params: { sessionId: "session-1", prompt: [{ type: "text", text: "say done" }] },
		});
		await driver.opened;

		await driver.appendAssistant("done");
		expect(agent.drain()).toEqual([
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "session-1",
					update: {
						sessionUpdate: "agent_message",
						messageId: "assistant-1",
						content: [{ type: "text", text: "done" }],
					},
				},
			},
		]);

		driver.finish("completed");
		await driver.closed;
		expect(agent.drain()).toEqual([
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "session-1",
					update: { sessionUpdate: "state_update", state: "idle", stopReason: "end_turn" },
				},
			},
		]);
	});

	test("projects disposable live chunks while durable entries remain the replay frontier", async () => {
		const driver = new ProjectionDriver();
		const agent = new AcpV2Agent({
			host: new RuntimeHost({
				persistence: new InMemoryProductSessionPersistence(),
				operationDriver: driver,
				createId: ids("session-1", "operation-1"),
			}),
			info: { name: "jai", version: "0.0.0" },
		});
		await agent.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "test-client", version: "1.0.0" } },
		});
		await agent.handle({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/workspace" } });
		await agent.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "session/prompt",
			params: { sessionId: "session-1", prompt: [{ type: "text", text: "stream" }] },
		});
		await driver.opened;

		driver.emit({ type: "message_chunk", messageId: "assistant-1", channel: "agent", text: "partial" });
		driver.emit({
			type: "tool_started",
			toolCallId: "tool-1",
			toolName: "Read",
			title: "Read package.json",
			kind: "read",
			rawInput: { path: "package.json" },
		});
		driver.emit({
			type: "tool_content_chunk",
			toolCallId: "tool-1",
			content: { type: "text", text: "found it" },
		});

		expect(agent.drain()).toEqual([
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "session-1",
					update: {
						sessionUpdate: "agent_message_chunk",
						messageId: "assistant-1",
						content: { type: "text", text: "partial" },
					},
				},
			},
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "session-1",
					update: {
						sessionUpdate: "tool_call_update",
						toolCallId: "tool-1",
						title: "Read package.json",
						kind: "read",
						status: "in_progress",
						rawInput: { path: "package.json" },
					},
				},
			},
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "session-1",
					update: {
						sessionUpdate: "tool_call_content_chunk",
						toolCallId: "tool-1",
						content: { type: "content", content: { type: "text", text: "found it" } },
					},
				},
			},
		]);

		driver.finish("completed");
		await driver.closed;
	});

	test("projects Bash as a T1-gated display terminal and marks it exited only after the durable T2 result", async () => {
		const driver = new ProjectionDriver();
		const agent = new AcpV2Agent({
			host: new RuntimeHost({
				persistence: new InMemoryProductSessionPersistence(),
				operationDriver: driver,
				createId: ids("session-1", "operation-1"),
			}),
			info: { name: "jai", version: "0.0.0" },
		});
		await agent.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "test-client", version: "1.0.0" } },
		});
		await agent.handle({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/workspace" } });
		await agent.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "session/prompt",
			params: { sessionId: "session-1", prompt: [{ type: "text", text: "run build" }] },
		});
		await driver.opened;

		driver.emit({
			type: "tool_started",
			toolCallId: "tool-1",
			toolName: "Bash",
			title: "Run bun test",
			kind: "execute",
			rawInput: { command: "bun test" },
			terminal: { terminalId: "terminal:tool-1", command: "bun test", cwd: "/workspace" },
		});
		driver.emit({ type: "terminal_output_chunk", terminalId: "terminal:tool-1", text: "1 pass\n" });

		expect(agent.drain()).toEqual([
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "session-1",
					update: {
						sessionUpdate: "tool_call_update",
						toolCallId: "tool-1",
						title: "Run bun test",
						kind: "execute",
						status: "in_progress",
						rawInput: { command: "bun test" },
						content: [{ type: "terminal", terminalId: "terminal:tool-1" }],
					},
				},
			},
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "session-1",
					update: {
						sessionUpdate: "terminal_update",
						terminalId: "terminal:tool-1",
						command: "bun test",
						cwd: "/workspace",
					},
				},
			},
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "session-1",
					update: { sessionUpdate: "terminal_output_chunk", terminalId: "terminal:tool-1", data: "MSBwYXNzCg==" },
				},
			},
		]);
		driver.emit({ type: "terminal_output", terminalId: "terminal:tool-1", text: "tail\n" });
		expect(agent.drain()).toEqual([
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "session-1",
					update: { sessionUpdate: "terminal_update", terminalId: "terminal:tool-1", output: { data: "dGFpbAo=" } },
				},
			},
		]);

		await driver.appendToolResult({ toolCallId: "tool-1", toolName: "Bash", text: "1 pass", isError: false });
		expect(agent.drain()).toEqual([
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "session-1",
					update: {
						sessionUpdate: "tool_call_update",
						toolCallId: "tool-1",
						status: "completed",
						content: [
							{ type: "content", content: { type: "text", text: "1 pass" } },
							{ type: "terminal", terminalId: "terminal:tool-1" },
						],
					},
				},
			},
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "session-1",
					update: { sessionUpdate: "terminal_update", terminalId: "terminal:tool-1", exitStatus: {} },
				},
			},
		]);

		driver.finish("completed");
		await driver.closed;
	});

	test("projects durable T2 file changes as ACP diff content and replays the same diff", async () => {
		const persistence = new InMemoryProductSessionPersistence();
		const driver = new ProjectionDriver();
		const host = new RuntimeHost({
			persistence,
			operationDriver: driver,
			createId: ids("session-1", "operation-1"),
		});
		const live = new AcpV2Agent({ host, info: { name: "jai", version: "0.0.0" } });
		await live.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "live", version: "1.0.0" } },
		});
		await live.handle({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/workspace" } });
		await live.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "session/prompt",
			params: { sessionId: "session-1", prompt: [{ type: "text", text: "write a file" }] },
		});
		await driver.opened;

		driver.emit({
			type: "tool_started",
			toolCallId: "tool-1",
			toolName: "Write",
			title: "Write index.ts",
			kind: "edit",
			rawInput: { path: "index.ts", content: "export {};" },
		});
		expect(live.drain()).toEqual([
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "session-1",
					update: {
						sessionUpdate: "tool_call_update",
						toolCallId: "tool-1",
						title: "Write index.ts",
						kind: "edit",
						status: "in_progress",
						rawInput: { path: "index.ts", content: "export {};" },
					},
				},
			},
		]);

		await driver.appendToolResult({
			toolCallId: "tool-1",
			toolName: "Write",
			text: "Created 10 bytes to index.ts",
			isError: false,
			fileChanges: [{ operation: "add", path: "/workspace/index.ts" }],
		});
		const expectedResult = {
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId: "tool-1",
					status: "completed",
					content: [
						{ type: "content", content: { type: "text", text: "Created 10 bytes to index.ts" } },
						{ type: "diff", changes: [{ operation: "add", path: "/workspace/index.ts" }] },
					],
				},
			},
		} satisfies import("../../../src/protocol/acp-v2").AcpJsonRpcNotification;
		expect(live.drain()).toEqual([expectedResult]);

		driver.finish("completed");
		await driver.closed;
		await live.close();

		const resumed = new AcpV2Agent({ host, info: { name: "jai", version: "0.0.0" } });
		await resumed.handle({
			jsonrpc: "2.0",
			id: 4,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "replay", version: "1.0.0" } },
		});
		const replayed = await resumed.handle({
			jsonrpc: "2.0",
			id: 5,
			method: "session/resume",
			params: { sessionId: "session-1", cwd: "/workspace", replayFrom: { type: "start" } },
		});
		expect(replayed).toContainEqual(expectedResult);
		await resumed.close();
	});

	test("turns a Runtime approval into an ACP v2 reverse permission request and returns the selected decision", async () => {
		const driver = new ProjectionDriver();
		const requests: Array<{ readonly method: string; readonly params: unknown }> = [];
		const agent = new AcpV2Agent({
			host: new RuntimeHost({
				persistence: new InMemoryProductSessionPersistence(),
				operationDriver: driver,
				createId: ids("session-1", "operation-1"),
			}),
			info: { name: "jai", version: "0.0.0" },
			clientRequestSink: {
				async request(method, params) {
					requests.push({ method, params });
					if (requests.length === 3) return { outcome: { outcome: "cancelled" } };
					return { outcome: { outcome: "selected", optionId: "allow-always" } };
				},
			},
		});
		await agent.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "test-client", version: "1.0.0" } },
		});
		await agent.handle({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/workspace" } });
		await agent.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "session/prompt",
			params: { sessionId: "session-1", prompt: [{ type: "text", text: "approve this" }] },
		});
		const input = await driver.opened;
		try {
			const approval = input.requestApproval({
				requestId: "approval-1",
				sessionId: "session-1",
				operationId: "operation-1",
				toolCallId: "tool-1",
				toolName: "Bash",
				title: "Run build",
				description: "Runs the project build command",
				canAlwaysAllow: true,
			});
			expect(await approval).toBe("alwaysAllow");
			const unsupportedAlwaysAllow = input.requestApproval({
				requestId: "approval-2",
				sessionId: "session-1",
				operationId: "operation-1",
				toolCallId: "tool-2",
				toolName: "ExtensionTool",
				title: "Extension requests permission",
				canAlwaysAllow: false,
			});
			expect(await unsupportedAlwaysAllow).toBe("deny");
			const cancelledByClient = input.requestApproval({
				requestId: "approval-3",
				sessionId: "session-1",
				operationId: "operation-1",
				toolCallId: "tool-3",
				toolName: "Write",
				title: "Write configuration",
				canAlwaysAllow: true,
			});
			expect(await cancelledByClient).toBe("deny");
			expect(requests).toEqual([
				{
					method: "session/request_permission",
					params: {
						sessionId: "session-1",
						title: "Run build",
						description: "Runs the project build command",
						subject: {
							type: "tool_call",
							toolCall: { toolCallId: "tool-1", title: "Bash", kind: "other", status: "pending" },
						},
						options: [
							{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
							{ optionId: "allow-always", name: "Always allow", kind: "allow_always" },
							{ optionId: "reject", name: "Deny", kind: "reject_once" },
						],
					},
				},
				{
					method: "session/request_permission",
					params: {
						sessionId: "session-1",
						title: "Extension requests permission",
						subject: {
							type: "tool_call",
							toolCall: { toolCallId: "tool-2", title: "ExtensionTool", kind: "other", status: "pending" },
						},
						options: [
							{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
							{ optionId: "reject", name: "Deny", kind: "reject_once" },
						],
					},
				},
				{
					method: "session/request_permission",
					params: {
						sessionId: "session-1",
						title: "Write configuration",
						subject: {
							type: "tool_call",
							toolCall: { toolCallId: "tool-3", title: "Write", kind: "other", status: "pending" },
						},
						options: [
							{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
							{ optionId: "allow-always", name: "Always allow", kind: "allow_always" },
							{ optionId: "reject", name: "Deny", kind: "reject_once" },
						],
					},
				},
			]);
		} finally {
			driver.finish("completed");
			await driver.closed;
		}
	});

	test("replays durable messages before the session/resume response when replayFrom is start", async () => {
		const persistence = new InMemoryProductSessionPersistence();
		const host = new RuntimeHost({ persistence, createId: ids("session-1", "operation-1") });
		const first = new AcpV2Agent({ host, info: { name: "jai", version: "0.0.0" } });
		await first.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "first", version: "1.0.0" } },
		});
		await first.handle({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/workspace" } });
		await first.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "session/prompt",
			params: { sessionId: "session-1", prompt: [{ type: "text", text: "persist me" }] },
		});
		await first.close();

		const resumedAgent = new AcpV2Agent({ host, info: { name: "jai", version: "0.0.0" } });
		await resumedAgent.handle({
			jsonrpc: "2.0",
			id: 4,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "second", version: "1.0.0" } },
		});
		const replayed = await resumedAgent.handle({
			jsonrpc: "2.0",
			id: 5,
			method: "session/resume",
			params: { sessionId: "session-1", cwd: "/workspace", replayFrom: { type: "start" } },
		});

		expect(replayed).toEqual([
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "session-1",
					update: {
						sessionUpdate: "user_message",
						messageId: "operation-1:input",
						content: [{ type: "text", text: "persist me" }],
					},
				},
			},
			{
				jsonrpc: "2.0",
				method: "session/update",
				params: { sessionId: "session-1", update: { sessionUpdate: "state_update", state: "running" } },
			},
			{ jsonrpc: "2.0", id: 5, result: {} },
		]);
	});

	test("projects only the safe slash invocation DTO from durable user metadata", async () => {
		const persistence = new InMemoryProductSessionPersistence();
		const host = new RuntimeHost({ persistence, createId: ids("session-1", "operation-1") });
		const first = new AcpV2Agent({ host, info: { name: "jai", version: "0.0.0" } });
		await first.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "first", version: "1.0.0" } },
		});
		await first.handle({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/workspace" } });
		const stored = await persistence.load("session-1");
		if (stored.isErr()) throw stored.error;
		const appended = await persistence.appendEntry({
			sessionId: "session-1",
			expectedRevision: stored.value.revision,
			entry: {
				type: "message",
				id: "slash-input",
				parentId: stored.value.snapshot.leafId,
				timestamp: new Date(1).toISOString(),
				message: {
					role: "user",
					content: "/review target",
					timestamp: 1,
					metadata: {
						slashInvocation: {
							name: "review",
							kind: "command",
							commandKind: "file",
							displayName: "Review a target",
							path: "/must-not-project",
							cause: "must-not-project",
						},
					},
				},
			},
		});
		expect(appended.isOk()).toBe(true);
		await first.close();

		const resumed = new AcpV2Agent({ host, info: { name: "jai", version: "0.0.0" } });
		await resumed.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "second", version: "1.0.0" } },
		});
		const replayed = await resumed.handle({
			jsonrpc: "2.0",
			id: 4,
			method: "session/resume",
			params: { sessionId: "session-1", cwd: "/workspace", replayFrom: { type: "start" } },
		});

		expect(replayed).toContainEqual(
			expect.objectContaining({
				method: "session/update",
				params: expect.objectContaining({
					sessionId: "session-1",
					update: expect.objectContaining({
						sessionUpdate: "user_message",
						messageId: "slash-input",
						slashInvocation: {
							name: "review",
							kind: "command",
							commandKind: "file",
							displayName: "Review a target",
						},
					}),
				}),
			}),
		);
		expect(JSON.stringify(replayed)).not.toContain("must-not-project");
	});

	test("accepts a follow-up delivery on session/prompt while an Operation is live", async () => {
		const persistence = new InMemoryProductSessionPersistence();
		const driver = new ProjectionDriver();
		const host = new RuntimeHost({
			persistence,
			operationDriver: driver,
			createId: ids("session-1", "operation-1", "input-1", "entry-follow-1"),
		});
		const agent = new AcpV2Agent({ host, info: { name: "jai", version: "0.0.0" } });
		await agent.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "test-client", version: "1.0.0" } },
		});
		await agent.handle({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/workspace" } });
		await agent.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "session/prompt",
			params: { sessionId: "session-1", prompt: [{ type: "text", text: "start" }] },
		});
		await driver.opened;
		const followUp = await agent.handle({
			jsonrpc: "2.0",
			id: 4,
			method: "session/prompt",
			params: {
				sessionId: "session-1",
				delivery: "follow_up",
				prompt: [{ type: "text", text: "then summarize" }],
			},
		});
		expect(followUp).toContainEqual({ jsonrpc: "2.0", id: 4, result: {} });
		const durable = await persistence.load("session-1");
		if (durable.isErr()) throw durable.error;
		expect(durable.value.operationRecords.at(-1)).toMatchObject({
			type: "input_queued",
			delivery: "follow_up",
			inputEntryId: "entry-follow-1",
		});
	});

	test("session/navigate forks the current branch and resume replays only that branch", async () => {
		const persistence = new InMemoryProductSessionPersistence();
		const driver = new ProjectionDriver();
		const host = new RuntimeHost({
			persistence,
			operationDriver: driver,
			createId: ids("session-1", "operation-1", "branch-1"),
		});
		const agent = new AcpV2Agent({ host, info: { name: "jai", version: "0.0.0" } });
		await agent.handle({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 2, capabilities: {}, info: { name: "test-client", version: "1.0.0" } },
		});
		await agent.handle({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/workspace" } });
		await agent.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "session/prompt",
			params: { sessionId: "session-1", prompt: [{ type: "text", text: "start" }] },
		});
		await driver.opened;
		await driver.appendAssistant("done");
		driver.finish("completed");
		await driver.closed;

		const navigated = await agent.handle({
			jsonrpc: "2.0",
			id: 4,
			method: "session/navigate",
			params: { sessionId: "session-1", entryId: "operation-1:input" },
		});
		expect(navigated).toContainEqual({ jsonrpc: "2.0", id: 4, result: {} });

		const replayed = await agent.handle({
			jsonrpc: "2.0",
			id: 5,
			method: "session/resume",
			params: { sessionId: "session-1", cwd: "/workspace", replayFrom: { type: "start" } },
		});
		expect(JSON.stringify(replayed)).toContain("operation-1:input");
		expect(JSON.stringify(replayed)).not.toContain("assistant-1");
	});
});

function configuredSessionPolicy(): RuntimeSessionConfigurationPolicy {
	const models = [
		{ value: "profile/model-a", name: "Model A" },
		{ value: "profile/model-b", name: "Model B" },
	] as const;
	return {
		async initialConfiguration() {
			return Result.ok({ model: "profile/model-a", mode: "manual" });
		},
		async listModels() {
			return Result.ok(models);
		},
		async validateModel(model) {
			return models.some((candidate) => candidate.value === model)
				? Result.ok(undefined)
				: Result.err(new RuntimeSessionConfigurationInvalid({ message: `Unknown model ${model}` }));
		},
	};
}

function usage(totalCost: number) {
	return {
		input: 1,
		output: 1,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 2,
		cost: { input: totalCost, output: 0, cacheRead: 0, cacheWrite: 0, total: totalCost },
	};
}

class ProjectionDriver implements RuntimeOperationDriver {
	readonly opened: Promise<RuntimeOperationOpenInput>;
	readonly closed: Promise<void>;
	#input?: RuntimeOperationOpenInput;
	#resolveOpened!: (input: RuntimeOperationOpenInput) => void;
	#resolveClosed!: () => void;
	#resolveOutcome!: (outcome: "completed" | "failed" | "aborted") => void;
	readonly #listeners = new Set<(event: RuntimeOperationEvent) => void>();
	#outcome = new Promise<"completed" | "failed" | "aborted">((resolve) => {
		this.#resolveOutcome = resolve;
	});

	constructor() {
		this.opened = new Promise((resolve) => {
			this.#resolveOpened = resolve;
		});
		this.closed = new Promise((resolve) => {
			this.#resolveClosed = resolve;
		});
	}

	async openOperation(input: RuntimeOperationOpenInput) {
		this.#input = input;
		this.#resolveOpened(input);
		return Result.ok<RuntimeOperation, never>({
			abort: async () => {
				this.finish("aborted");
				return Result.ok<void, RuntimeOperationExecutionFailed>(undefined);
			},
			enqueueInput: async () => Result.ok<void, RuntimeOperationExecutionFailed>(undefined),
			awaitOutcome: async () => Result.ok(await this.#outcome),
			subscribe: (listener) => {
				this.#listeners.add(listener);
				return () => {
					this.#listeners.delete(listener);
				};
			},
			close: async () => {
				this.#resolveClosed();
			},
		});
	}

	async appendAssistant(text: string): Promise<void> {
		const input = this.#input;
		if (!input) throw new Error("Operation was not opened");
		const stored = await input.sessionStore.load(input.sessionId);
		if (!stored) throw new Error("Session was not available");
		await input.sessionStore.append(
			input.sessionId,
			{
				type: "message",
				id: "assistant-1",
				parentId: stored.snapshot.leafId,
				timestamp: "2026-08-25T12:00:00.000Z",
				message: {
					role: "assistant",
					content: [{ type: "text", text }],
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
					stopReason: "stop",
					timestamp: Date.now(),
				},
			},
			stored.revision,
		);
	}

	async appendTodos(
		items: readonly { readonly id: string; readonly content: string; readonly status: "pending" | "in_progress" | "completed" | "cancelled" }[],
	): Promise<void> {
		const input = this.#input;
		if (!input) throw new Error("Operation was not opened");
		const stored = await input.sessionStore.load(input.sessionId);
		if (!stored) throw new Error("Session was not available");
		await input.sessionStore.append(
			input.sessionId,
			{
				type: "app_state",
				id: "todos-1",
				parentId: stored.snapshot.leafId,
				timestamp: "2026-08-26T12:00:00.000Z",
				value: {
					version: 1,
					appState: {},
					extensions: {},
					todos: { items: items.map((item) => ({ ...item })), updatedAt: 1_772_213_600_000 },
				},
			},
			stored.revision,
		);
	}

	async appendToolResult(input: {
		readonly toolCallId: string;
		readonly toolName: string;
		readonly text: string;
		readonly isError: boolean;
		readonly fileChanges?: readonly { readonly operation: "add" | "modify" | "delete"; readonly path: string }[];
	}): Promise<void> {
		const operation = this.#input;
		if (!operation) throw new Error("Operation was not opened");
		const stored = await operation.sessionStore.load(operation.sessionId);
		if (!stored) throw new Error("Session was not available");
		await operation.sessionStore.append(
			operation.sessionId,
			{
				type: "message",
				id: `result:${input.toolCallId}`,
				parentId: stored.snapshot.leafId,
				timestamp: "2026-08-26T12:00:00.000Z",
				message: {
					role: "toolResult",
					toolCallId: input.toolCallId,
					toolName: input.toolName,
					content: [{ type: "text", text: input.text }],
					...(input.fileChanges ? { fileChanges: input.fileChanges } : {}),
					isError: input.isError,
					timestamp: Date.now(),
				},
			},
			stored.revision,
		);
	}

	finish(outcome: "completed" | "failed" | "aborted"): void {
		this.#resolveOutcome(outcome);
	}

	emit(event: RuntimeOperationEvent): void {
		for (const listener of [...this.#listeners]) listener(event);
	}
}
