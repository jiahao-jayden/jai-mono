import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import {
	MemoryConnectorService,
	type ActionDefinition,
	type ConnectorAdapter,
	type ConnectorDefinition,
	type ConnectionRecord,
	type JsonValue,
} from "../src";

const connector: ConnectorDefinition = {
	id: "demo",
	displayName: "Demo",
	authTypes: ["api_key"],
};

const queryAction: ActionDefinition = {
	connectorId: "demo",
	actionId: "search",
	description: "Search demo records.",
	inputSchema: {
		type: "object",
		properties: { query: { type: "string" } },
		required: ["query"],
		additionalProperties: false,
	},
	outputSchema: { type: "object" },
	requiredScopes: [],
	sideEffect: "read",
	dataSensitivity: "normal",
};

const writeAction: ActionDefinition = {
	connectorId: "demo",
	actionId: "create",
	description: "Create a demo record.",
	inputSchema: {
		type: "object",
		properties: { name: { type: "string" } },
		required: ["name"],
		additionalProperties: false,
	},
	outputSchema: { type: "object" },
	requiredScopes: ["demo.write"],
	sideEffect: "write",
	dataSensitivity: "normal",
};

const hiddenAction: ActionDefinition = {
	...queryAction,
	actionId: "internal_check",
	description: "Internal credential check.",
};

const secretAction: ActionDefinition = {
	...queryAction,
	actionId: "secret_lookup",
	dataSensitivity: "secret",
};

const connection: ConnectionRecord = {
	connectorId: "demo",
	displayName: "Demo account",
	status: "connected",
	scopes: ["demo.write"],
};

function createService(): MemoryConnectorService {
	const adapter: ConnectorAdapter = {
		definition: connector,
		actions: [queryAction, writeAction, hiddenAction],
		execute: async (action, input) => Result.ok<JsonValue>({ actionId: action.actionId, input }),
	};
	return new MemoryConnectorService({
		adapters: [adapter],
		connections: [connection],
		policy: {
			default: "allow",
			actions: {
				"demo.internal_check": "deny",
			},
		},
	});
}

describe("MemoryConnectorService", () => {
	test("prepares then executes the same validated action", async () => {
		const service = createService();
		const prepared = await service.prepareAction(
			{ actionId: "demo.search", input: { query: "jai" } },
			{ sessionId: "session-1", requestId: "request-1" },
		);

		expect(prepared.isOk()).toBe(true);
		if (prepared.isErr()) return;
		expect(prepared.value).toMatchObject({
			actionId: "demo.search",
			sideEffect: "read",
			dataSensitivity: "normal",
		});
		const result = await service.executePreparedAction(prepared.value, {
			sessionId: "session-1",
			requestId: "request-1",
		});
		expect(result).toMatchObject({ status: "ok", value: { status: "completed", actionId: "demo.search" } });
	});

	test("preparation validates a write action before it can execute", async () => {
		const service = createService();
		const prepared = await service.prepareAction(
			{ actionId: "demo.create", input: { name: "record" } },
			{ sessionId: "session-1", requestId: "request-1" },
		);

		expect(prepared.isOk()).toBe(true);
		if (prepared.isErr()) return;
		expect(prepared.value.sideEffect).toBe("write");
		const completed = await service.executePreparedAction(prepared.value, {
			sessionId: "session-1",
			requestId: "request-1",
		});
		expect(completed).toMatchObject({ status: "ok", value: { status: "completed", actionId: "demo.create" } });
	});

	test("reports an explicitly allowed policy and hides secret actions", async () => {
		const adapter: ConnectorAdapter = {
			definition: connector,
			actions: [writeAction, secretAction],
			execute: async (action, input) => Result.ok<JsonValue>({ actionId: action.actionId, input }),
		};
		const service = new MemoryConnectorService({
			adapters: [adapter],
			connections: [connection],
			policy: { default: "allow" },
		});
		const write = await service.prepareAction(
			{ actionId: "demo.create", input: { name: "record" } },
			{ sessionId: "session-1", requestId: "request-1" },
		);
		expect(write.isOk()).toBe(true);

		const secret = await service.searchActions({ query: "secret" }, { sessionId: "session-1", requestId: "request-2" });
		expect(secret.isOk()).toBe(true);
		if (secret.isOk()) expect(secret.value.actions).toHaveLength(0);
	});

	test("rejects changed prepared actions and prevents replays after execution", async () => {
		const service = createService();
		const prepared = await service.prepareAction(
			{ actionId: "demo.create", input: { name: "record" } },
			{ sessionId: "session-1", requestId: "request-1" },
		);
		expect(prepared.isOk()).toBe(true);
		if (prepared.isErr()) return;

		const changed = await service.executePreparedAction(
			{ ...prepared.value, actionId: "demo.search" },
			{ sessionId: "session-1", requestId: "request-1" },
		);
		expect(changed.isErr()).toBe(true);
		const completed = await service.executePreparedAction(prepared.value, {
			sessionId: "session-1",
			requestId: "request-1",
		});
		expect(completed.isOk()).toBe(true);

		const replay = await service.executePreparedAction(prepared.value, {
			sessionId: "session-1",
			requestId: "request-1",
		});
		expect(replay.isErr()).toBe(true);
	});

	test("uses ask as the default action policy", async () => {
		const adapter: ConnectorAdapter = {
			definition: connector,
			actions: [writeAction],
			execute: async (action, input) => Result.ok<JsonValue>({ actionId: action.actionId, input }),
		};
		const service = new MemoryConnectorService({ adapters: [adapter], connections: [connection] });
		const prepared = await service.prepareAction(
			{ actionId: "demo.create", input: { name: "record" } },
			{ sessionId: "session-1", requestId: "request-1" },
		);

		expect(prepared).toMatchObject({ status: "ok", value: { approvalMode: "ask" } });
	});

	test("exposes denied actions but does not prepare them", async () => {
		const service = createService();
		const actions = await service.searchActions({ query: "internal" }, { requestId: "request-1", sessionId: "session-1" });
		expect(actions.isOk()).toBe(true);
		if (actions.isOk()) {
			expect(actions.value.actions).toHaveLength(1);
			expect(actions.value.actions[0]?.policy).toBe("deny");
		}
		const guide = await service.getActionGuide({ actionId: "demo.internal_check" }, { requestId: "request-1" });
		expect(guide.isOk()).toBe(true);
		if (guide.isOk()) expect(guide.value.policy).toBe("deny");

		const result = await service.prepareAction(
			{ actionId: "demo.internal_check", input: {} },
			{ sessionId: "session-1", requestId: "request-1" },
		);
		expect(result.isErr()).toBe(true);
	});

	test("rejects invalid input before it prepares the action", async () => {
		const service = createService();
		const result = await service.prepareAction(
			{ actionId: "demo.search", input: {} },
			{ sessionId: "session-1", requestId: "request-1" },
		);
		expect(result.isErr()).toBe(true);
	});
});
