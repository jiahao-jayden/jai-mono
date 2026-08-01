import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AssistantMessageEventStream,
	type AssistantMessage,
	type Context,
	type Model,
	type Provider,
	zeroUsage,
} from "@jai/ai";
import { Type } from "@sinclair/typebox";
import { defineCodingConfig } from "../src/config";
import { permissionConfigFields, permissionSettingsSchema } from "../src/permissions";
import { createCodingAgent } from "../src/runtime";

const roots: string[] = [];

const definition = defineCodingConfig({
	schemaVersion: 1,
	schemaUrl: "https://jai.test/coding-agent-settings-v1.json",
	schema: Type.Object({ permissions: permissionSettingsSchema }, { additionalProperties: false }),
	fields: { permissions: permissionConfigFields },
	migrations: [],
});

const model: Model = {
	id: "test-model",
	name: "Test Model",
	api: "test",
	provider: "test",
	baseUrl: "http://localhost",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 10_000,
	maxTokens: 1_000,
};

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("createCodingAgent", () => {
	test("组装配置、provider、内置 tools 与 FileSessionStore", async () => {
		const fixture = await createFixture();
		const contexts: Context[] = [];
		let resolvedMode: unknown;
		const codingAgent = await createCodingAgent({
			...fixture,
			resolveProvider(snapshot) {
				resolvedMode = snapshot.settings.permissions.defaultMode;
				return { provider: providerFor([assistant("done")], contexts), model };
			},
		});

		try {
			const messages = await codingAgent.invoke("hello");
			expect(messages.at(-1)?.role).toBe("assistant");
			expect(resolvedMode).toBe("default");
			expect(contexts[0]?.tools.map((tool) => tool.name)).toEqual(["Read", "Glob", "Grep", "Write", "Edit", "Bash"]);
			expect(await readFile(join(fixture.sessionDirectory, "session-1.jsonl"), "utf8")).toContain('"type":"message"');
		} finally {
			codingAgent.close();
		}
	});

	test("在 aroundToolCall 切点请求权限并执行一次性授权", async () => {
		const fixture = await createFixture();
		const target = join(fixture.executionContext.cwd, "approved.txt");
		const requests: string[] = [];
		const codingAgent = await createCodingAgent({
			...fixture,
			resolveProvider: () => ({
				provider: providerFor([
					assistantToolCall("Write", { path: target, content: "approved" }),
					assistant("written"),
				]),
				model,
			}),
			permissions: {
				requestApproval(request) {
					requests.push(request.suggestedRule ?? "");
					return "allowOnce";
				},
			},
		});

		try {
			await codingAgent.invoke("write the file");
			expect(requests).toEqual([`Edit(//${target.replace(/^\/+/, "")})`]);
			expect(await readFile(target, "utf8")).toBe("approved");
		} finally {
			codingAgent.close();
		}
	});

	test("未归属 execution context 不向 Agent 暴露本地工具", async () => {
		const fixture = await createFixture();
		const contexts: Context[] = [];
		const codingAgent = await createCodingAgent({
			...fixture,
			executionContext: { localFileAccess: false },
			resolveProvider: () => ({
				provider: providerFor([assistant("done")], contexts),
				model,
			}),
		});

		try {
			await codingAgent.invoke("hello");
			expect(contexts[0]?.tools).toEqual([]);
			expect(codingAgent.configSnapshot.settings.permissions.defaultMode).toBe("default");
		} finally {
			codingAgent.close();
		}
	});
});

async function createFixture() {
	const root = await mkdtemp(join(tmpdir(), "jai-coding-runtime-"));
	roots.push(root);
	const workspaceRoot = join(root, "workspace");
	await mkdir(workspaceRoot);
	return {
		executionContext: {
			localFileAccess: true as const,
			cwd: workspaceRoot,
			configRoot: workspaceRoot,
			defaultAllowedDirectories: [workspaceRoot] as [string],
		},
		sessionId: "session-1",
		sessionDirectory: join(root, "sessions"),
		configDefinition: definition,
		configOptions: { homeDir: join(root, "home") },
	};
}

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		provider: "test",
		model: model.id,
		usage: zeroUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function assistantToolCall(name: string, args: Record<string, unknown>): AssistantMessage {
	return {
		...assistant(""),
		content: [{ type: "toolCall", id: "call-1", name, arguments: args }],
		stopReason: "toolUse",
	};
}

function providerFor(responses: AssistantMessage[], contexts: Context[] = []): Provider {
	let index = 0;
	return {
		id: "test",
		stream(_model, context) {
			contexts.push({ ...context, messages: [...context.messages], tools: [...context.tools] });
			const response = responses[index++];
			if (!response) throw new Error("Unexpected provider call");
			const stream = new AssistantMessageEventStream();
			stream.push({ type: "start", partial: response });
			if (response.stopReason === "error" || response.stopReason === "aborted") {
				stream.push({ type: "error", reason: response.stopReason, error: response });
			} else {
				stream.push({ type: "done", reason: response.stopReason, message: response });
			}
			return stream;
		},
	};
}
