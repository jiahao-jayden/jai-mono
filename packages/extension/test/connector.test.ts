import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type { CodingExtensionRuntime } from "@jai/coding-agent";
import { Value } from "@sinclair/typebox/value";
import { createConnectorExtension } from "../src/connector/index";
import type {
	ActionGuideResponse,
	ActionSideEffect,
	ConnectorService,
	ExecuteActionResponse,
	HealthResponse,
	ListAppsResponse,
	ListConnectionsResponse,
	PreparedConnectorAction,
	RequestContext,
	SearchActionsInput,
	SearchActionsResponse,
} from "@jai/connector";

type ConnectorContext = CodingExtensionRuntime<{
	readonly policy?: {
		readonly default?: "allow" | "ask" | "deny";
		readonly actions?: Readonly<Record<string, "allow" | "ask" | "deny">>;
	};
}>;

describe("Connector Extension", () => {
	test("asks before executing an action whose Connector policy is ask", async () => {
		const calls: string[] = [];
	const context = extensionContext({
			requestApproval: async () => {
				calls.push("approve");
				return Result.ok("allowOnce");
			},
		});
		const client = clientFor({
			prepared: preparedAction("ask"),
			onPrepare: () => calls.push("prepare"),
			onExecute: () => calls.push("execute"),
		});

		const result = await executeAction(client, context);

		expect(calls).toEqual(["prepare", "approve", "execute"]);
		expect(result.content).toEqual([
			{ type: "text", text: '{"status":"completed","actionId":"demo.create","output":{"ok":true}}' },
		]);
	});

	test("persists allow for the exact Connector action before executing", async () => {
		const updates: unknown[] = [];
		const context = extensionContext({
		requestApproval: async () => Result.ok("allow"),
			onConfigurationUpdate: (value) => updates.push(value),
		});
		const executed: PreparedConnectorAction[] = [];
		const client = clientFor({
			prepared: preparedAction("ask"),
			onExecute: (prepared) => executed.push(prepared),
		});

		await executeAction(client, context);

		expect(updates).toEqual([
			{
				policy: { default: "ask", actions: { "demo.create": "allow" } },
			},
		]);
		expect(executed).toEqual([preparedAction("ask")]);
	});

	test("denial discards the prepared action and does not execute it", async () => {
		const discarded: PreparedConnectorAction[] = [];
		const executed: PreparedConnectorAction[] = [];
		const client = clientFor({
			prepared: preparedAction("ask"),
			onDiscard: (prepared) => discarded.push(prepared),
			onExecute: (prepared) => executed.push(prepared),
		});

		await expect(executeAction(client, extensionContext({ requestApproval: async () => Result.ok("deny") }))).rejects.toMatchObject({
			_tag: "connector_extension.permission_denied",
		});

		expect(discarded).toEqual([preparedAction("ask")]);
		expect(executed).toEqual([]);
	});

	test("plan mode blocks write actions before execution and releases the preparation", async () => {
		const discarded: PreparedConnectorAction[] = [];
		const executed: PreparedConnectorAction[] = [];
		const client = clientFor({
			prepared: preparedAction("allow"),
			onDiscard: (prepared) => discarded.push(prepared),
			onExecute: (prepared) => executed.push(prepared),
		});

		await expect(
			executeAction(client, extensionContext({ permissionMode: "plan", requestApproval: async () => Result.ok("allowOnce") })),
		).rejects.toMatchObject({ _tag: "connector_extension.permission_denied" });

		expect(discarded).toEqual([preparedAction("allow")]);
		expect(executed).toEqual([]);
	});

	test("discovers Connector Actions as catalog tools with call presentation", async () => {
		const extension = createConnectorExtension({ client: clientFor({ prepared: preparedAction("allow") }) });
		const catalog = extension.catalogs?.[0];
		if (!catalog) throw new Error("Connector action catalog is unavailable");
		const discovered = await catalog.discover(extensionContext({ requestApproval: async () => Result.ok("allowOnce") }));
		expect(discovered.isOk()).toBe(true);
		if (discovered.isErr()) return;

		expect(extension.tools).toBeUndefined();
		expect(discovered.value.tools).toEqual([
			expect.objectContaining({ name: "connector__demo__create", presentation: { activityKind: "call" } }),
		]);
		const tool = discovered.value.tools[0];
		if (!tool) throw new Error("Connector action tool is unavailable");
		expect(Value.Check(tool.parameters, { name: "record", kind: "issue" })).toBe(true);
		expect(Value.Check(tool.parameters, { kind: "issue" })).toBe(false);
		expect(Value.Check(tool.parameters, { name: "record", extra: true })).toBe(false);
	});

	test("does not vary external-call presentation by a Connector Action side effect", async () => {
		const extension = createConnectorExtension({ client: clientFor({ prepared: preparedAction("allow") }) });
		const catalog = extension.catalogs?.[0];
		if (!catalog) throw new Error("Connector action catalog is unavailable");
		const discovered = await catalog.discover(extensionContext({ requestApproval: async () => Result.ok("allowOnce") }));
		if (discovered.isErr()) return;
		const tool = discovered.value.tools[0];

		expect(tool?.presentation?.activityKind).toBe("call");
		expect(tool?.presentation?.resolveActivityKind).toBeUndefined();
	});
});

async function executeAction(client: ConnectorService, context: ConnectorContext) {
	const extension = createConnectorExtension({ client });
	const catalog = extension.catalogs?.[0];
	if (!catalog) throw new Error("Connector action catalog is unavailable");
	const discovered = await catalog.discover(context);
	if (discovered.isErr()) throw discovered.error;
	const tool = discovered.value.tools.find((candidate) => candidate.name === "connector__demo__create");
	if (!tool) throw new Error("Connector execute tool is unavailable");
	return tool.execute(context, {
		runAgent: async () => Result.ok([]),
		toolCallId: "tool-call-1",
		args: { name: "record" },
	});
}

function extensionContext(input: {
	readonly permissionMode?: ConnectorContext["permissionMode"];
	readonly requestApproval: ConnectorContext["requestApproval"];
	readonly onConfigurationUpdate?: (value: unknown) => void;
}): ConnectorContext {
	let value: ConnectorContext["configuration"]["value"] = {
		policy: { default: "ask" as const, actions: {} as Record<string, "allow" | "ask" | "deny"> },
	};
	return {
		sessionId: "session-1",
		cwd: "/workspace",
		workspace: { directory: "/workspace", trusted: true },
		permissionMode: input.permissionMode ?? "default",
		configuration: {
			get value() {
				return structuredClone(value);
			},
			persistent: true,
			update: async (next) => {
				value = structuredClone(next);
				input.onConfigurationUpdate?.(value);
				return Result.ok(structuredClone(value));
			},
		},
		sessionState: {
			value: {},
			update: async () => Result.ok({}),
		},
		requestApproval: input.requestApproval,
		registerCommand: () => Result.ok({ unregister: () => {} }),
		instance: undefined,
	};
}

function preparedAction(approvalMode: PreparedConnectorAction["approvalMode"]): PreparedConnectorAction {
	return {
		preparationId: "prepared-1",
		actionId: "demo.create",
		description: "Create a demo record.",
		sideEffect: "write",
		dataSensitivity: "sensitive",
		approvalMode,
		expiresAt: 1_000_000_000_000,
	};
}

function clientFor(input: {
	readonly prepared: PreparedConnectorAction;
	readonly sideEffects?: Readonly<Record<string, ActionSideEffect>>;
	readonly onPrepare?: (context: RequestContext) => void;
	readonly onExecute?: (prepared: PreparedConnectorAction) => void;
	readonly onDiscard?: (prepared: PreparedConnectorAction) => void;
}): ConnectorService {
	return {
		actionSideEffect: (actionId: string) => input.sideEffects?.[actionId],
		listApps: async () => Result.ok<ListAppsResponse>({ apps: [] }),
		listConnections: async () => Result.ok<ListConnectionsResponse>({ connections: [] }),
		listActions: async () => Result.ok([actionGuide().action]),
		searchActions: async (_input: SearchActionsInput) =>
			Result.ok<SearchActionsResponse>({
				actions: [
					{
						actionId: "demo.create",
						connectorId: "demo",
						description: "Create a demo record.",
						policy: "ask",
						sideEffect: "write",
						dataSensitivity: "sensitive",
						requiredScopes: [],
						requiresGuide: true,
					},
				],
				nextCursor: null,
			}),
		getActionGuide: async () => Result.ok<ActionGuideResponse>(actionGuide()),
		prepareAction: async (_input, context) => {
			input.onPrepare?.(context);
			return Result.ok(input.prepared);
		},
		executePreparedAction: async (prepared) => {
			input.onExecute?.(prepared);
			return Result.ok<ExecuteActionResponse>({
				status: "completed",
				actionId: prepared.actionId,
				output: { ok: true },
			});
		},
		discardPreparedAction: async (prepared) => {
			input.onDiscard?.(prepared);
			return Result.ok(undefined);
		},
		health: async () => Result.ok<HealthResponse>({ status: "ready", protocolVersion: 1, connectorCount: 1, actionCount: 1 }),
	};
}

function actionGuide(): ActionGuideResponse {
	return {
		action: {
			connectorId: "demo",
			actionId: "create",
			description: "Create a demo record.",
			inputSchema: {
				type: "object",
				properties: {
					name: { type: "string" },
					kind: { enum: ["issue", "bug"] },
				},
				required: ["name"],
				additionalProperties: false,
			},
			outputSchema: { type: "object" },
			requiredScopes: [],
			sideEffect: "write",
			dataSensitivity: "sensitive",
		},
		policy: "ask",
	};
}
