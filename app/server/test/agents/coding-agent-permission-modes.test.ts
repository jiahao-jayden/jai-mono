import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { CodingAuxiliaryModel } from "@jai/coding-agent";
import { Result } from "better-result";
import { CodingAgentOperationDriver } from "../../src/agents";
import { RuntimeHost } from "../../src/runtime/host";
import {
	InMemoryProductSessionPersistence,
	type RuntimeSessionInteractionMode,
	type RuntimeSessionPermissionMode,
} from "../../src/sessions";

const roots: string[] = [];
const providers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(async () => {
	for (const provider of providers.splice(0)) provider.stop(true);
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * Each Session permission mode, observed end to end through the Runtime Host:
 * a model asks to Write a workspace file and the test records whether the user
 * was asked, whether the reviewer was consulted and whether the file exists.
 */
describe("Session permission modes through the Coding Agent Operation driver", () => {
	test.each([
			["ask", { approvals: 1, reviews: 0, written: true }],
			["allow", { approvals: 0, reviews: 0, written: true }],
			["auto", { approvals: 0, reviews: 0, written: true }],
	] as const)("%s", async (permissionMode, expected) => {
		const observed = await runWrite({ permissionMode });
		expect(observed).toMatchObject(expected);
	});

	test.each([
		["allow", { approvals: 0, reviews: 1, written: true }],
		["deny", { approvals: 0, reviews: 1, written: false }],
		["ask", { approvals: 1, reviews: 1, written: true }],
	] as const)("auto maps a reviewer %s onto execution", async (decision, expected) => {
		const observed = await runWrite({
			permissionMode: "auto",
			review: () => anthropicTextEvents(JSON.stringify({ decision, reason: `Reviewer says ${decision}` })),
		});
		expect(observed).toMatchObject(expected);
	});

	test("auto asks the user when the chosen auxiliary model is unavailable", async () => {
		const observed = await runWrite({
			permissionMode: "auto",
			auxiliaryModel: { kind: "unavailable" },
			review: () => anthropicTextEvents('{"decision":"allow","reason":"must not be used"}'),
		});
		expect(observed).toMatchObject({ approvals: 1, reviews: 0, written: true });
	});

	test("auto asks the user when the reviewer answers outside the verdict schema", async () => {
		const observed = await runWrite({
			permissionMode: "auto",
			review: () => anthropicTextEvents('{"decision":"yes","reason":"looks fine"}'),
		});
		expect(observed).toMatchObject({ approvals: 1, reviews: 1, written: true });
	});

	test("Plan intent blocks the write whatever the permission mode", async () => {
		const observed = await runWrite({ permissionMode: "allow", interactionMode: "plan" });
		expect(observed).toMatchObject({ approvals: 0, reviews: 0, written: false });
	});

	test("allow still asks before a destructive command and never consults a reviewer", async () => {
		const observed = await runWrite({
			permissionMode: "allow",
			toolCall: { name: "Bash", arguments: { command: "rm -rf build" } },
		});
		expect(observed).toMatchObject({ approvals: 1, reviews: 0 });
	});

	test("allow keeps the workspace boundary: a Write outside the workspace asks first", async () => {
		const observed = await runWrite({
			permissionMode: "allow",
			toolCall: ({ outsideFile }) => ({ name: "Write", arguments: { path: outsideFile, content: "hi" } }),
		});
		expect(observed).toMatchObject({ approvals: 1, reviews: 0 });
	});

	test("allow keeps the process sandbox: approved Bash still cannot write outside the workspace", async () => {
		// Control: the same approved redirect succeeds inside the workspace, so the sandbox is what blocks it below.
		const inside = await runWrite({
			permissionMode: "allow",
			toolCall: { name: "Bash", arguments: { command: "printf hi > note.txt" } },
		});
		expect(inside).toMatchObject({ written: true });
		const outside = await runWrite({
			permissionMode: "allow",
			toolCall: ({ outsideFile }) => ({ name: "Bash", arguments: { command: `printf hi > ${outsideFile}` } }),
		});
		expect(outside).toMatchObject({ approvals: 1, outsideWritten: false });
	});
});

type ToolCallInput = { readonly name: string; readonly arguments: Readonly<Record<string, unknown>> };

async function runWrite(input: {
	readonly permissionMode: RuntimeSessionPermissionMode;
	readonly interactionMode?: RuntimeSessionInteractionMode;
	readonly auxiliaryModel?: CodingAuxiliaryModel;
	readonly review?: () => string;
	readonly toolCall?: ToolCallInput | ((paths: { readonly outsideFile: string }) => ToolCallInput);
}): Promise<{ approvals: number; reviews: number; written: boolean; outsideWritten: boolean }> {
	// Deliberately not canonicalized: on macOS tmpdir sits under the `/var` symlink, which the
	// permission boundary must treat as the same workspace.
	const root = await mkdtemp(join(tmpdir(), "jai-permission-mode-"));
	roots.push(root);
	const outsideFile = join(root, "..", `${basename(root)}-outside.txt`);
	roots.push(outsideFile);
	const toolCall =
		typeof input.toolCall === "function"
			? input.toolCall({ outsideFile })
			: (input.toolCall ?? { name: "Write", arguments: { path: "note.txt", content: "hi" } });
	const agentResponses = [
		anthropicToolCallEvents({ id: "tool-1", name: toolCall.name, arguments: toolCall.arguments }),
		anthropicTextEvents("done"),
	];
	let reviews = 0;
	const provider = Bun.serve({
		port: 0,
		fetch: async (request) => {
			const body = JSON.stringify(await request.json());
			const isReview = body.includes("You review one tool call");
			if (isReview) reviews++;
			const response = isReview ? input.review?.() : agentResponses.shift();
			return new Response(response ?? "No fake provider response left", {
				status: response ? 200 : 500,
				headers: { "content-type": "text/event-stream" },
			});
		},
	});
	providers.push(provider);

	const persistence = new InMemoryProductSessionPersistence();
	const driver = new CodingAgentOperationDriver({
		resolveOptions: () =>
			Result.ok({
				model: "anthropic/test-model",
				provider: { apiKey: "test", baseUrl: provider.url.toString() },
				auxiliaryModel: input.auxiliaryModel,
			}),
		capabilitySource: {
			resolve: async () =>
				Result.ok({
					fileCapabilities: { homeDirectory: root, workspaceDirectory: root, workspaceTrusted: false },
					extensions: [],
				}),
		},
	});
	const host = new RuntimeHost({
		persistence,
		operationDriver: driver,
		initialAppState: () => ({ version: 1, appState: {}, extensions: {} }),
	});
	const opened = await host.openSession({ kind: "new", cwd: root });
	if (opened.isErr()) throw opened.error;
	const session = opened.value;
	let approvals = 0;
	const unsubscribe = session.subscribe((event) => {
		if (event.type !== "approval_requested") return;
		approvals++;
		void session.respondToApproval({ requestId: event.request.requestId, decision: "allowOnce" });
	});
	try {
		const permission = await session.setConfiguration({ configId: "permissionMode", value: input.permissionMode });
		if (permission.isErr()) throw permission.error;
		const interaction = await session.setConfiguration({
			configId: "interactionMode",
			value: input.interactionMode ?? "normal",
		});
		if (interaction.isErr()) throw interaction.error;
		const prompted = await session.prompt({ text: "Write a note saying hi" });
		if (prompted.isErr()) throw prompted.error;
		await waitFor(async () => {
			const durable = await persistence.load(session.id);
			return durable.isOk() && durable.value.operationRecords.some((record) => record.type === "operation_finished");
		});
	} finally {
		unsubscribe();
		await session.close();
	}
	const contains = (path: string) =>
		readFile(path, "utf8").then(
			(content) => content === "hi",
			() => false,
		);
	return {
		approvals,
		reviews,
		written: await contains(join(root, "note.txt")),
		outsideWritten: await contains(outsideFile),
	};
}

function anthropicTextEvents(text: string): string {
	return anthropicEvents({ content_block: { type: "text", text: "" }, delta: { type: "text_delta", text } }, "end_turn");
}

function anthropicToolCallEvents(call: {
	readonly id: string;
	readonly name: string;
	readonly arguments: Readonly<Record<string, unknown>>;
}): string {
	return anthropicEvents(
		{
			content_block: { type: "tool_use", id: call.id, name: call.name, input: {} },
			delta: { type: "input_json_delta", partial_json: JSON.stringify(call.arguments) },
		},
		"tool_use",
	);
}

function anthropicEvents(
	block: { readonly content_block: unknown; readonly delta: unknown },
	stopReason: "end_turn" | "tool_use",
): string {
	return [
		sse("message_start", {
			type: "message_start",
			message: {
				id: "message-id",
				type: "message",
				role: "assistant",
				model: "test-model",
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { input_tokens: 1, output_tokens: 0 },
			},
		}),
		sse("content_block_start", { type: "content_block_start", index: 0, content_block: block.content_block }),
		sse("content_block_delta", { type: "content_block_delta", index: 0, delta: block.delta }),
		sse("content_block_stop", { type: "content_block_stop", index: 0 }),
		sse("message_delta", {
			type: "message_delta",
			delta: { stop_reason: stopReason, stop_sequence: null },
			usage: { output_tokens: 1 },
		}),
		sse("message_stop", { type: "message_stop" }),
	].join("");
}

function sse(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function waitFor(condition: () => Promise<boolean>): Promise<void> {
	for (let attempt = 0; attempt < 400; attempt += 1) {
		if (await condition()) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Timed out waiting for the Coding Agent Operation to finish");
}
