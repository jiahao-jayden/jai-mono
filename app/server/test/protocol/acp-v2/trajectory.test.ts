import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { createAcpV2Agent } from "../../../src/protocol/acp-v2";
import { createRuntimeHost } from "../../../src/runtime";
import { InMemoryProductSessionPersistence } from "../../../src/sessions";
import { createTrajectoryFeed, type TrajectoryBrowserLauncher } from "../../../src/trajectory";

async function initializedAgent(input: { readonly clientName?: string; readonly browserLauncher?: TrajectoryBrowserLauncher } = {}) {
	const persistence = new InMemoryProductSessionPersistence();
	const created = await persistence.create({
		id: "session-1",
		appState: {},
		runtimeConfiguration: { model: "profile/model", mode: "manual" },
		cwd: "/workspace",
		createdAt: "2026-08-29T00:00:00.000Z",
	});
	if (created.isErr()) throw created.error;
	const admitted = await persistence.admitPrompt({
		sessionId: "session-1",
		inputEntry: {
			type: "message",
			id: "input-1",
			parentId: null,
			timestamp: "2026-08-29T00:00:01.000Z",
			message: { role: "user", content: "private prompt", timestamp: 0 },
		},
		operation: {
			type: "operation_accepted",
			operationId: "operation-1",
			kind: "prompt",
			inputEntryId: "input-1",
			startLeafId: null,
			timestamp: "2026-08-29T00:00:01.000Z",
		},
	});
	if (admitted.isErr()) throw admitted.error;
	const agent = createAcpV2Agent({
		host: createRuntimeHost({ persistence }),
		trajectoryFeed: createTrajectoryFeed({ persistence }),
		...(input.browserLauncher ? { trajectoryBrowserLauncher: input.browserLauncher } : {}),
		info: { name: "jai", version: "0.0.0" },
	});
	await agent.handle({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: { protocolVersion: 2, capabilities: {}, info: { name: input.clientName ?? "test", version: "1" } },
	});
	return { agent, persistence };
}

describe("JAI ACP trajectory protocol", () => {
	test("projects the same wire DTO with metadata-only default and explicit fixed scopes", async () => {
		const { agent } = await initializedAgent();
		const metadata = await agent.handle({
			jsonrpc: "2.0",
			id: 2,
			method: "jai/trajectory/snapshot",
			params: { sessionId: "session-1" },
		});
		expect(JSON.stringify(metadata)).not.toContain("private prompt");
		const content = await agent.handle({
			jsonrpc: "2.0",
			id: 3,
			method: "jai/trajectory/snapshot",
			params: { sessionId: "session-1", scopes: ["prompt"] },
		});
		expect(JSON.stringify(content)).toContain("private prompt");
		const invalid = await agent.handle({
			jsonrpc: "2.0",
			id: 4,
			method: "jai/trajectory/snapshot",
			params: { sessionId: "session-1", scopes: ["unknown"] },
		});
		expect(invalid).toEqual([{ jsonrpc: "2.0", id: 4, result: { ok: false, error: { code: "invalid_request", message: "Trajectory request includes an invalid content scope" } } }]);
		await agent.close();
	});

	test("publishes read-only updates after a cursor and stops them on unsubscribe", async () => {
		const { agent, persistence } = await initializedAgent();
		const subscribed = await agent.handle({
			jsonrpc: "2.0",
			id: 2,
			method: "jai/trajectory/subscribe",
			params: { sessionId: "session-1", cursor: "2" },
		});
		const subscriptionId = ((subscribed[0] as { readonly result: { readonly value: { readonly subscriptionId: string } } }).result.value.subscriptionId);
		const appended = await persistence.appendOperation({
			sessionId: "session-1",
			record: { type: "turn_started", operationId: "operation-1", turnId: "turn-1", timestamp: "2026-08-29T00:00:02.000Z" },
		});
		if (appended.isErr()) throw appended.error;
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(agent.drain()).toMatchObject([
			{ method: "jai/trajectory/update", params: { subscriptionId, sessionId: "session-1", item: { id: "operation:operation-1:turn_started:turn-1" } } },
		]);
		await agent.handle({ jsonrpc: "2.0", id: 3, method: "jai/trajectory/unsubscribe", params: { subscriptionId } });
		const later = await persistence.appendOperation({
			sessionId: "session-1",
			record: { type: "turn_finished", operationId: "operation-1", turnId: "turn-1", assistantEntryId: "assistant-1", outcome: "completed", timestamp: "2026-08-29T00:00:03.000Z" },
		});
		if (later.isErr()) throw later.error;
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(agent.drain()).toEqual([]);
		await agent.close();
	});

	test("lets only the CLI open a fixed-scope Browser capability without returning it over ACP", async () => {
		const launches: Array<{ readonly sessionId: string; readonly scopes: readonly string[] }> = [];
		const browserLauncher: TrajectoryBrowserLauncher = {
			async open(input) {
				launches.push(input);
				return Result.ok(undefined);
			},
		};
		const { agent } = await initializedAgent({ clientName: "jai-cli", browserLauncher });
		const opened = await agent.handle({
			jsonrpc: "2.0",
			id: 2,
			method: "jai/trajectory/browser/open",
			params: { sessionId: "session-1", scopes: ["final_text"] },
		});
		expect(opened).toEqual([{ jsonrpc: "2.0", id: 2, result: { ok: true, value: {} } }]);
		expect(launches).toEqual([{ sessionId: "session-1", scopes: ["final_text"] }]);
		expect(JSON.stringify(opened)).not.toContain("token");
		await agent.close();
	});

	test("does not expose Browser launch to non-CLI ACP clients", async () => {
		const { agent } = await initializedAgent({
			browserLauncher: { async open() { return Result.ok(undefined); } },
		});
		const opened = await agent.handle({
			jsonrpc: "2.0",
			id: 2,
			method: "jai/trajectory/browser/open",
			params: { sessionId: "session-1" },
		});
		expect(opened).toEqual([
			{ jsonrpc: "2.0", id: 2, result: { ok: false, error: { code: "forbidden", message: "Only the local CLI can open a trajectory browser" } } },
		]);
		await agent.close();
	});
});
