import { describe, expect, test } from "bun:test";
import { Result, type Result as ResultType } from "better-result";
import type {
	AcpJsonRpcNotification,
	AcpJsonRpcRequest,
	AcpJsonRpcResponse,
	AcpLocalClientError,
	LocalAcpV2Client,
} from "@jai/server/acp-client";
import { DesktopAcpAgentHost } from "../electron/agent/acp-host";
import type { DesktopAgentEventEnvelope } from "../shared/desktop-rpc";

describe("DesktopAcpAgentHost", () => {
	test("connects through ACP, configures a session, and projects updates without a Coding Agent", async () => {
		const client = new FakeAcpClient();
		const events: DesktopAgentEventEnvelope[] = [];
		const host = await DesktopAcpAgentHost.open((event) => events.push(event), {
			client,
			resolveSessionCwd: async () => "/workspace",
		});

		await host.send({ sessionId: "session-1", modelRef: "profile/model", mode: "manual", message: "hello" });
		client.publish({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "user_message",
					messageId: "entry-1",
					content: [{ type: "text", text: "hello" }],
					slashInvocation: {
						name: "review",
						kind: "command",
						commandKind: "file",
						displayName: "Review a target",
						path: "/must-not-project",
					},
				},
			},
		});
		client.publish({
			jsonrpc: "2.0",
			method: "session/update",
			params: { sessionId: "session-1", update: { sessionUpdate: "state_update", state: "running" } },
		});

		expect(client.methods).toEqual([
			"initialize",
			"session/resume",
			"session/new",
			"session/set_config_option",
			"session/set_config_option",
			"session/prompt",
		]);
		expect(host.getSnapshot("session-1")).toMatchObject({
			status: "running",
			items: [
				{
					kind: "message",
					role: "user",
					text: "hello",
					slashInvocation: {
						name: "review",
						kind: "command",
						commandKind: "file",
						displayName: "Review a target",
					},
				},
			],
		});
		expect(events.map((event) => event.seq)).toEqual([1, 2]);
		host.close();
	});

	test("sends steering through ACP prompt admission instead of a Desktop memory queue", async () => {
		const client = new FakeAcpClient();
		const host = await DesktopAcpAgentHost.open(() => {}, {
			client,
			resolveSessionCwd: async () => "/workspace",
		});
		host.steer({ sessionId: "session-1", modelRef: "profile/model", mode: "manual", message: "change direction" });
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(client.methods).toContain("session/prompt");
		expect(client.params.at(-1)).toMatchObject({ delivery: "steer" });
		host.close();
	});

	test("admits follow-up through ACP prompt delivery instead of throwing", async () => {
		const client = new FakeAcpClient();
		const host = await DesktopAcpAgentHost.open(() => {}, {
			client,
			resolveSessionCwd: async () => "/workspace",
		});
		await host.followUp({
			sessionId: "session-1",
			modelRef: "profile/model",
			mode: "manual",
			message: "then summarize",
		});
		expect(client.methods).toContain("session/prompt");
		expect(client.params.at(-1)).toMatchObject({
			delivery: "follow_up",
			prompt: [{ type: "text", text: "then summarize" }],
		});
		host.close();
	});

	test("navigates through ACP then rebuilds the Session projection", async () => {
		const client = new FakeAcpClient();
		const host = await DesktopAcpAgentHost.open(() => {}, {
			client,
			resolveSessionCwd: async () => "/workspace",
		});
		await host.ensureSessionProjection("session-1");
		await host.navigate({
			sessionId: "session-1",
			entryId: "operation-1:input",
			modelRef: "profile/model",
			mode: "manual",
		});
		expect(client.methods).toContain("session/navigate");
		expect(client.params.find((params) => params && typeof params === "object" && "entryId" in params)).toMatchObject({
			entryId: "operation-1:input",
		});
		expect(client.methods.filter((method) => method === "session/resume")).toHaveLength(2);
		host.close();
	});

	test("projects the Host's ACP Todo plan as a disposable Desktop Todo read model", async () => {
		const client = new FakeAcpClient();
		const events: DesktopAgentEventEnvelope[] = [];
		const host = await DesktopAcpAgentHost.open((event) => events.push(event), {
			client,
			resolveSessionCwd: async () => "/workspace",
		});
		await host.ensureSessionProjection("session-1");
		client.publish({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "plan_update",
					plan: {
						planId: "todos",
						entries: [
							{ content: "Read the journal", status: "completed" },
							{ content: "Project ACP updates", status: "in_progress" },
							{ content: "Cancel the obsolete experiment", status: "cancelled" },
						],
					},
				},
			},
		});

		expect(host.getSnapshot("session-1").todos).toEqual([
			{ id: "acp-plan:0", content: "Read the journal", status: "completed" },
			{ id: "acp-plan:1", content: "Project ACP updates", status: "in_progress" },
			{ id: "acp-plan:2", content: "Cancel the obsolete experiment", status: "cancelled" },
		]);
		expect(events.at(-1)).toMatchObject({
			sessionId: "session-1",
			event: {
				type: "todos_replace",
				todos: [
					{ content: "Read the journal", status: "completed" },
					{ content: "Project ACP updates", status: "in_progress" },
					{ content: "Cancel the obsolete experiment", status: "cancelled" },
				],
			},
		});
		host.close();
	});

	test("cancels a pending ACP permission before cancelling the Session", async () => {
		const client = new FakeAcpClient();
		const events: DesktopAgentEventEnvelope[] = [];
		const host = await DesktopAcpAgentHost.open((event) => events.push(event), {
			client,
			resolveSessionCwd: async () => "/workspace",
		});
		await host.ensureSessionProjection("session-1");
		client.requestFromHost({
			jsonrpc: "2.0",
			id: 17,
			method: "session/request_permission",
			params: {
				sessionId: "session-1",
				title: "Run build",
				subject: { type: "tool_call", toolCall: { toolCallId: "tool-1", title: "Bash" } },
				options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
			},
		});

		host.abort("session-1");

		expect(client.responses).toContainEqual({
			jsonrpc: "2.0",
			id: 17,
			result: { outcome: { outcome: "cancelled" } },
		});
		expect(client.notifications).toContainEqual({
			method: "session/cancel",
			params: { sessionId: "session-1" },
		});
		expect(events.at(-1)).toMatchObject({
			sessionId: "session-1",
			event: { type: "transcript_upsert", item: { kind: "permission", status: "cancelled" } },
		});
		host.close();
	});

	test("round-trips the ACP v2 request-permission schema fixture", async () => {
		const client = new FakeAcpClient();
		const events: DesktopAgentEventEnvelope[] = [];
		const host = await DesktopAcpAgentHost.open((event) => events.push(event), {
			client,
			resolveSessionCwd: async () => "/workspace",
		});
		await host.ensureSessionProjection("session-1");
		const officialRequestPermissionFixture = {
			jsonrpc: "2.0" as const,
			id: 18,
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
		};
		client.requestFromHost(officialRequestPermissionFixture);

		host.resolvePermission({ requestId: "tool-1", decision: "alwaysAllow" });

		expect(client.responses).toContainEqual({
			jsonrpc: "2.0",
			id: 18,
			result: { outcome: { outcome: "selected", optionId: "allow-always" } },
		});
		expect(events.at(-1)).toMatchObject({
			sessionId: "session-1",
			event: { type: "transcript_upsert", item: { kind: "permission", status: "allowed" } },
		});
		host.close();
	});

	test("projects ACP display-terminal output onto its associated volatile tool item", async () => {
		const client = new FakeAcpClient();
		const host = await DesktopAcpAgentHost.open(() => {}, {
			client,
			resolveSessionCwd: async () => "/workspace",
		});
		await host.ensureSessionProjection("session-1");
		client.publish({
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
					content: [{ type: "terminal", terminalId: "terminal:tool-1" }],
				},
			},
		});
		client.publish({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: "session-1",
				update: { sessionUpdate: "terminal_output_chunk", terminalId: "terminal:tool-1", data: "MSBwYXNzCg==" },
			},
		});
		client.publish({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: "session-1",
				update: { sessionUpdate: "terminal_update", terminalId: "terminal:tool-1", output: { data: "dGFpbAo=" } },
			},
		});
		client.publish({
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
		});

		expect(host.getSnapshot("session-1").items).toEqual([
			expect.objectContaining({ kind: "tool", toolCallId: "tool-1", status: "complete", details: "1 pass" }),
		]);
		host.close();
	});

	test("retains an ACP durable diff as a read-only Desktop tool projection", async () => {
		const client = new FakeAcpClient();
		const host = await DesktopAcpAgentHost.open(() => {}, {
			client,
			resolveSessionCwd: async () => "/workspace",
		});
		await host.ensureSessionProjection("session-1");
		client.publish({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: "session-1",
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId: "tool-1",
					title: "Write index.ts",
					kind: "edit",
					status: "completed",
					content: [
						{ type: "content", content: { type: "text", text: "Created index.ts" } },
						{ type: "diff", changes: [{ operation: "add", path: "/workspace/index.ts" }] },
					],
				},
			},
		});

		expect(host.getSnapshot("session-1").items).toEqual([
			expect.objectContaining({
				kind: "tool",
				toolCallId: "tool-1",
				fileChanges: [{ operation: "add", path: "/workspace/index.ts" }],
			}),
		]);
		host.close();
	});

	test("projects the read-only trajectory protocol through ACP push without opening a Session controller", async () => {
		const client = new FakeAcpClient();
		const events: DesktopAgentEventEnvelope[] = [];
		const host = await DesktopAcpAgentHost.open((event) => events.push(event), {
			client,
			resolveSessionCwd: async () => "/workspace",
		});

		const snapshot = await host.trajectorySnapshot({ sessionId: "session-1" });
		expect(snapshot).toMatchObject({ ok: true, value: { snapshot: { session: { sessionId: "session-1" } } } });
		const subscription = await host.trajectorySubscribe({ sessionId: "session-1", cursor: "1" });
		expect(subscription).toEqual({ ok: true, value: { subscriptionId: "trajectory-1" } });
		expect(events).toContainEqual(
			expect.objectContaining({
				sessionId: "session-1",
				event: expect.objectContaining({ type: "trajectory_update", subscriptionId: "trajectory-1" }),
			}),
		);
		expect(client.methods).toEqual(["initialize", "jai/trajectory/snapshot", "jai/trajectory/subscribe"]);

		host.trajectoryUnsubscribe({ subscriptionId: "trajectory-1" });
		expect(client.methods.at(-1)).toBe("jai/trajectory/unsubscribe");
		host.close();
	});
});

class FakeAcpClient implements LocalAcpV2Client {
	readonly methods: string[] = [];
	readonly params: unknown[] = [];
	readonly notifications: Array<{ readonly method: string; readonly params: unknown }> = [];
	readonly responses: AcpJsonRpcResponse[] = [];
	readonly #listeners = new Set<(notification: AcpJsonRpcNotification) => void>();
	readonly #requests = new Set<(request: AcpJsonRpcRequest) => void>();
	#resumeCalls = 0;

	async request(method: string, params?: unknown): Promise<ResultType<unknown, AcpLocalClientError>> {
		this.methods.push(method);
		this.params.push(params);
		if (method === "jai/trajectory/snapshot") {
			return Result.ok({
				ok: true,
				value: { snapshot: { session: { sessionId: "session-1", cwd: "/workspace" }, cursor: { value: "1" }, items: [] } },
			});
		}
		if (method === "jai/trajectory/subscribe") {
			this.publish({
				jsonrpc: "2.0",
				method: "jai/trajectory/update",
				params: {
					subscriptionId: "trajectory-1",
					sessionId: "session-1",
					item: {
						id: "operation-1:chunk",
						cursor: { value: "2" },
						timestamp: "2026-08-29T00:00:00.000Z",
						type: "live_chunk",
						chunk: { messageId: "message-1", channel: "agent", text: "working" },
					},
				},
			});
			return Result.ok({ ok: true, value: { subscriptionId: "trajectory-1" } });
		}
		if (method === "session/resume") {
			this.#resumeCalls += 1;
			if (this.#resumeCalls === 1) return Result.err({} as AcpLocalClientError);
		}
		return Result.ok({});
	}

	notify(method: string, params?: unknown): ResultType<void, AcpLocalClientError> {
		this.notifications.push({ method, params });
		return Result.ok(undefined);
	}

	subscribe(listener: (notification: AcpJsonRpcNotification) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	subscribeRequest(listener: (request: AcpJsonRpcRequest) => void): () => void {
		this.#requests.add(listener);
		return () => this.#requests.delete(listener);
	}

	respond(response: AcpJsonRpcResponse): ResultType<void, AcpLocalClientError> {
		this.responses.push(response);
		return Result.ok(undefined);
	}

	async close(): Promise<void> {}

	publish(notification: AcpJsonRpcNotification): void {
		for (const listener of this.#listeners) listener(notification);
	}

	requestFromHost(request: AcpJsonRpcRequest): void {
		for (const listener of this.#requests) listener(request);
	}
}
