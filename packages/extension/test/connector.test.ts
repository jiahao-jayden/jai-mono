import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type { CodingExtensionRuntime } from "@jai/coding-agent";
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
	readonly connectors?: Readonly<Record<string, { readonly enabled?: boolean; readonly credentials?: Readonly<Record<string, string>> }>>;
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
				connectors: {},
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

	test("declares a presentation category on every registered tool", () => {
		const extension = createConnectorExtension({ client: clientFor({ prepared: preparedAction("allow") }) });
		const kinds = Object.fromEntries(
			(extension.tools ?? []).map((tool) => [tool.name, tool.activityKind]),
		);

		expect(kinds).toEqual({
			connector__list_apps: "call",
			connector__list_connections: "call",
			connector__search_actions: "call",
			connector__get_action_guide: "call",
			connector__execute_action: "call",
		});
	});

	test("does not vary external-call presentation by a Connector Action side effect", () => {
		const extension = createConnectorExtension({ client: clientFor({ prepared: preparedAction("allow") }) });
		const tool = extension.tools?.find((candidate) => candidate.name === "connector__execute_action");

		expect(tool?.activityKind).toBe("call");
		expect(tool?.resolveActivityKind).toBeUndefined();
	});
});

async function executeAction(client: ConnectorService, context: ConnectorContext) {
	const extension = createConnectorExtension({ client });
	const tool = extension.tools?.find((candidate) => candidate.name === "connector__execute_action");
	if (!tool) throw new Error("Connector execute tool is unavailable");
	return tool.execute(context, {
		toolCallId: "tool-call-1",
		args: { actionId: "demo.create", input: { name: "record" } },
	});
}

function extensionContext(input: {
	readonly permissionMode?: ConnectorContext["permissionMode"];
	readonly requestApproval: ConnectorContext["requestApproval"];
	readonly onConfigurationUpdate?: (value: unknown) => void;
}): ConnectorContext {
	let value: ConnectorContext["configuration"]["value"] = {
		policy: { default: "ask" as const, actions: {} as Record<string, "allow" | "ask" | "deny"> },
		connectors: {},
	};
	return {
		sessionId: "session-1",
		cwd: "/workspace",
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
		searchActions: async (_input: SearchActionsInput) => Result.ok<SearchActionsResponse>({ actions: [], nextCursor: null }),
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
			inputSchema: { type: "object" },
			outputSchema: { type: "object" },
			requiredScopes: [],
			sideEffect: "write",
			dataSensitivity: "sensitive",
		},
		policy: "ask",
	};
}
