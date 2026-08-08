import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { createConnectorTools, type ConnectorApprovalRequest } from "../../src/connector";
import type {
	ActionGuideResponse,
	ConnectorService,
	ExecuteActionInput,
	ExecuteActionResponse,
	HealthResponse,
	ListAppsResponse,
	ListConnectionsResponse,
	RequestContext,
	SearchActionsInput,
	SearchActionsResponse,
} from "@jai/connector";

function createFakeClient(): ConnectorService & { calls: ExecuteActionInput[] } {
	const calls: ExecuteActionInput[] = [];
	const response: ExecuteActionResponse = {
		status: "approval_required",
		actionId: "demo.create",
		approvalId: "approval-1",
		approval: {
			actionId: "demo.create",
			connectionAlias: "default",
			description: "Create a demo record.",
			sideEffect: "write",
			dataSensitivity: "normal",
			inputKeys: ["name"],
			expiresAt: Date.now() + 60_000,
		},
	};
	return {
		calls,
		listApps: async (_context: RequestContext) => Result.ok<ListAppsResponse>({ apps: [] }),
		listConnections: async (_context: RequestContext) => Result.ok<ListConnectionsResponse>({ connections: [] }),
		searchActions: async (_input: SearchActionsInput, _context: RequestContext) => Result.ok<SearchActionsResponse>({ actions: [], nextCursor: null }),
		getActionGuide: async (_input: { actionId: string }, _context: RequestContext) => Result.ok<ActionGuideResponse>({
			action: {
				providerId: "demo",
				actionId: "create",
				description: "Create a demo record.",
				inputSchema: { type: "object" },
				outputSchema: { type: "object" },
				requiredScopes: [],
				sideEffect: "write",
				dataSensitivity: "normal",
			},
			policy: "confirm",
		}),
		executeAction: async (input: ExecuteActionInput, _context: RequestContext) => {
			calls.push(input);
			return Result.ok<ExecuteActionResponse>(input.approvalId ? { status: "completed", actionId: input.actionId, output: { ok: true } } : response);
		},
		health: async (_context: RequestContext) => Result.ok<HealthResponse>({ status: "ready", protocolVersion: 1, providerCount: 1, actionCount: 1 }),
	};
}

describe("Connector Agent tools", () => {
	test("registers only the five discovery-oriented tools", () => {
		const tools = createConnectorTools({ client: createFakeClient(), sessionId: "session-1" });
		expect(tools.map((tool) => tool.name)).toEqual([
			"connector__list_apps",
			"connector__list_connections",
			"connector__search_actions",
			"connector__get_action_guide",
			"connector__execute_action",
		]);
	});

	test("keeps approval private and retries the same action after approval", async () => {
		const client = createFakeClient();
		let approvalRequest: ConnectorApprovalRequest | undefined;
		const tools = createConnectorTools({
			client,
			sessionId: "session-1",
			requestApproval: async (request) => {
				approvalRequest = request;
				return "allowOnce" as const;
			},
		});
		const execute = tools.find((tool) => tool.name === "connector__execute_action");
		expect(execute).toBeDefined();
		if (!execute) return;

		const result = await execute.execute("tool-call-1", {
			actionId: "demo.create",
			connectionAlias: "default",
			input: { name: "record" },
		});
		expect(result.content[0]).toEqual({ type: "text", text: '{"status":"completed","actionId":"demo.create","output":{"ok":true}}' });
		expect(approvalRequest?.approvalId).toBe("approval-1");
		expect(client.calls).toHaveLength(2);
		expect(client.calls[1]?.approvalId).toBe("approval-1");
	});
});
