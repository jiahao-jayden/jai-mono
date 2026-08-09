import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import {
	MemoryConnectorService,
	type ActionDefinition,
	type JsonValue,
	type ProviderAdapter,
	type ProviderDefinition,
	type ConnectionRecord,
} from "../src";

const provider: ProviderDefinition = {
	id: "demo",
	displayName: "Demo",
	authTypes: ["api_key"],
};

const queryAction: ActionDefinition = {
	providerId: "demo",
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
	providerId: "demo",
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
	providerId: "demo",
	displayName: "Demo account",
	status: "connected",
	scopes: ["demo.write"],
};

function createService(): MemoryConnectorService {
	const adapter: ProviderAdapter = {
		definition: provider,
		actions: [queryAction, writeAction, hiddenAction],
		execute: async (action, input) =>
			Result.ok<JsonValue>({ actionId: action.actionId, input }),
	};
	return new MemoryConnectorService({
		adapters: [adapter],
		connections: [connection],
		policy: {
			default: "ask",
			actions: {
				"demo.search": "allow",
				"demo.internal_check": "deny",
			},
		},
	});
}

describe("MemoryConnectorService", () => {
	test("executes a query action without approval", async () => {
		const service = createService();
		const result = await service.executeAction(
			{ actionId: "demo.search", input: { query: "jai" } },
			{ sessionId: "session-1", requestId: "request-1" },
		);

		expect(result.isOk()).toBe(true);
		if (result.isOk()) expect(result.value.status).toBe("completed");
	});

	test("requires approval for a write action and executes after approval", async () => {
		const service = createService();
		const pending = await service.executeAction(
			{ actionId: "demo.create", input: { name: "record" } },
			{ sessionId: "session-1", requestId: "request-1" },
		);

		expect(pending.isOk()).toBe(true);
		if (pending.isOk()) {
			expect(pending.value.status).toBe("approval_required");
			if (pending.value.status !== "approval_required") return;
			const completed = await service.executeAction(
				{
					actionId: "demo.create",
					input: { name: "record" },
					approvalId: pending.value.approvalId,
				},
				{ sessionId: "session-1", requestId: "request-2" },
			);

			expect(completed.isOk()).toBe(true);
			if (completed.isOk()) expect(completed.value.status).toBe("completed");
		}
	});

	test("keeps the default ask policy and hides secret actions", async () => {
		const adapter: ProviderAdapter = {
			definition: provider,
			actions: [writeAction, secretAction],
			execute: async (action, input) => Result.ok<JsonValue>({ actionId: action.actionId, input }),
		};
		const service = new MemoryConnectorService({
			adapters: [adapter],
			connections: [connection],
			policy: { default: "ask" },
		});

		const write = await service.executeAction(
			{ actionId: "demo.create", input: { name: "record" } },
			{ sessionId: "session-1", requestId: "request-1" },
		);
		expect(write.isOk() && write.value.status).toBe("approval_required");

		const secret = await service.searchActions({ query: "secret" }, { sessionId: "session-1", requestId: "request-2" });
		expect(secret.isOk()).toBe(true);
		if (secret.isOk()) expect(secret.value.actions).toHaveLength(0);
	});

	test("rejects approval replay and input changes", async () => {
		const service = createService();
		const pending = await service.executeAction(
			{ actionId: "demo.create", input: { name: "record" } },
			{ sessionId: "session-1", requestId: "request-1" },
		);
		expect(pending.isOk()).toBe(true);
		if (!pending.isOk() || pending.value.status !== "approval_required") return;

		const changed = await service.executeAction(
			{
				actionId: "demo.create",
				input: { name: "different" },
				approvalId: pending.value.approvalId,
			},
			{ sessionId: "session-1", requestId: "request-2" },
		);
		 expect(changed.isErr()).toBe(true);

		const replay = await service.executeAction(
			{
				actionId: "demo.create",
				input: { name: "record" },
				approvalId: pending.value.approvalId,
			},
			{ sessionId: "session-1", requestId: "request-3" },
		);
		 expect(replay.isErr()).toBe(true);
	});

	test("exposes denied actions but does not execute them", async () => {
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

		const result = await service.executeAction(
			{ actionId: "demo.internal_check", input: {} },
			{ sessionId: "session-1", requestId: "request-1" },
		);
		expect(result.isErr()).toBe(true);
	});

	test("rejects invalid input before the adapter executes", async () => {
		const service = createService();
		const result = await service.executeAction(
			{ actionId: "demo.search", input: {} },
			{ sessionId: "session-1", requestId: "request-1" },
		);
		expect(result.isErr()).toBe(true);
	});
});
