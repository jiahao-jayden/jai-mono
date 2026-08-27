import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemorySessionStore } from "@jai/agent";
import { type AssistantMessage, zeroUsage } from "@jai/ai";
import { defineExtension, createCodingAgent } from "@jai/coding-agent";
import { Result } from "better-result";
import { createSkillsExtension } from "../src/skills";

const roots: string[] = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	for (const server of servers.splice(0)) server.stop(true);
});

describe("Skills Extension", () => {
	test("explicitly provides the Skill tool and local /skill command", async () => {
		const root = await temporaryDirectory();
		await writeSkill(join(root, ".agents", "skills"), "review", "Review changes", "# Review instructions");
		const requests: unknown[] = [];
		const created = await createTestAgent({
			root,
			requests,
			responses: [
				assistant("slash command complete"),
				assistant("updated slash command complete"),
				assistantToolCall("Skill", "load-review", { skill: "review" }),
				assistant("skill tool complete"),
			],
			extensions: [
				createSkillsExtension({ homeDirectory: root, workspaceDirectory: root, workspaceTrusted: true }),
			],
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		expect(await created.value.prompt("/skill:review inspect <this> patch")).toMatchObject({ status: "ok" });
		await writeSkill(join(root, ".agents", "skills"), "review", "Review changes", "# Updated review instructions");
		await Bun.sleep(300);
		expect(await created.value.prompt("/skill:review inspect updated patch")).toMatchObject({ status: "ok" });
		expect(await created.value.prompt("load the review skill")).toMatchObject({ status: "ok" });
		expect(JSON.stringify(requests[0])).toContain("# Review instructions");
		expect(JSON.stringify(requests[0])).toContain("inspect &lt;this&gt; patch");
		expect(JSON.stringify(requests[1])).toContain("# Updated review instructions");
		expect(JSON.stringify(requests[3])).toContain("# Updated review instructions");
		expect(created.value.state.messages[0]).toMatchObject({
			metadata: { slashInvocation: { name: "skill:review", commandKind: "skill" } },
		});
		await created.value.close();
	});

	test("lists every valid Agent Skill and registers its local slash command", async () => {
		const root = await temporaryDirectory();
		const skillsDirectory = join(root, ".agents", "skills");
		await Promise.all([
			writeSkill(skillsDirectory, "visible-review", "Visible review", "# Visible instructions"),
			writeSkill(skillsDirectory, "manual-review", "Manual review", "# Manual instructions"),
			writeSkill(skillsDirectory, "private-review", "Private review", "# Private instructions"),
		]);
		const requests: unknown[] = [];
		const created = await createTestAgent({
			root,
			requests,
			responses: [assistant("automatic list complete"), assistant("manual command complete"), assistant("private command complete")],
			extensions: [
				createSkillsExtension({ homeDirectory: root, workspaceDirectory: root, workspaceTrusted: true }),
			],
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		expect(await created.value.prompt("work on the current request")).toMatchObject({ status: "ok" });
		expect(await created.value.prompt("/skill:manual-review inspect this")).toMatchObject({ status: "ok" });
		expect(await created.value.prompt("/skill:private-review inspect this")).toMatchObject({ status: "ok" });

		const automaticSkillList = JSON.stringify(requests[0]);
		expect(automaticSkillList).toContain("<name>visible-review</name>");
		expect(automaticSkillList).toContain("<name>manual-review</name>");
		expect(automaticSkillList).toContain("<name>private-review</name>");
		expect(JSON.stringify(requests[1])).toContain("# Manual instructions");
		expect(JSON.stringify(requests[2])).toContain("# Private instructions");
		const sessionMessages = JSON.stringify(created.value.state.messages);
		expect(sessionMessages).toContain('"name":"skill:manual-review"');
		expect(sessionMessages).toContain('"name":"skill:private-review"');
		await created.value.close();
	});

	test("registers Markdown prompt templates through the public command context", async () => {
		const root = await temporaryDirectory();
		const marker = join(root, "template-must-not-run");
		await writePromptCommand(
			join(root, ".agents", "commands"),
			"review",
			"Review a target",
			`Review $1 then $2. All: $ARGUMENTS. Literal shell text: $(touch ${marker})`,
		);
		const requests: unknown[] = [];
		let extensionArgs: string | undefined;
		const created = await createTestAgent({
			root,
			requests,
			responses: [assistant("file command complete")],
			extensions: [
				createSkillsExtension({ homeDirectory: root, workspaceDirectory: root, workspaceTrusted: true }),
				defineExtension({
					id: "same-name-extension-command",
					lifecycle: {
						activate: (context) => {
							const registered = context.registerCommand({
								name: "review",
								description: "Handle review directly",
								handler: (args) => {
									extensionArgs = args;
									return Result.ok({ kind: "handled" });
								},
							});
							return registered.isErr() ? Result.err(registered.error) : Result.ok(undefined);
						},
					},
				}),
			],
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		expect(await created.value.prompt("/review:1 first second")).toMatchObject({ status: "ok" });
		expect(await created.value.prompt("/review:2 extension args")).toMatchObject({ status: "ok" });
		expect(extensionArgs).toBe("extension args");
		expect(JSON.stringify(requests[0])).toContain("Review first then second. All: first second.");
		expect(JSON.stringify(requests[0])).toContain(`$(touch ${marker})`);
		expect(await Bun.file(marker).exists()).toBe(false);
		expect(created.value.state.messages[0]).toMatchObject({
			metadata: { slashInvocation: { name: "review:1", commandKind: "file" } },
		});
		await created.value.close();
	});

	test("excludes untrusted project Skills, keeps plugin cards tool-only, and contains resources", async () => {
		const root = await temporaryDirectory();
		const workspace = join(root, "workspace");
		await writeSkill(join(workspace, ".jai", "skills"), "project-review", "Project review", "# Project only");
		const pluginSkill = await createPluginSkill(root, "plugin-review", "# Plugin review instructions");
		const localDirectory = join(root, ".agents", "skills");
		await writeSkill(localDirectory, "review", "Review changes", "# Local review instructions");
		const secret = join(root, "secret.txt");
		await writeFile(secret, "must-not-leak");
		await symlink(secret, join(localDirectory, "review", "escape.txt"));
		const requests: unknown[] = [];
		const created = await createTestAgent({
			root: workspace,
			requests,
			responses: [
				assistant("plugin slash stayed ordinary"),
				assistantToolCall("Skill", "read-escape", { skill: "review", path: "escape.txt" }),
				assistant("resource denied"),
				assistantToolCall("Skill", "load-plugin", { skill: "plugin-review" }),
				assistant("plugin loaded"),
			],
			extensions: [
				createSkillsExtension({
					homeDirectory: root,
					workspaceDirectory: workspace,
					workspaceTrusted: false,
					pluginSkills: [pluginSkill],
				}),
			],
		});
		expect(created.isOk()).toBe(true);
		if (created.isErr()) return;

		expect(await created.value.prompt("/skill:plugin-review use plugin")).toMatchObject({ status: "ok" });
		expect(await created.value.prompt("read the escape resource")).toMatchObject({ status: "ok" });
		expect(await created.value.prompt("load the plugin skill")).toMatchObject({ status: "ok" });
		expect(JSON.stringify(requests[0])).not.toContain("# Plugin review instructions");
		expect(JSON.stringify(requests[2])).toContain("escapes");
		expect(JSON.stringify(requests[2])).not.toContain("must-not-leak");
		expect(JSON.stringify(requests[4])).toContain("# Plugin review instructions");
		expect(JSON.stringify(requests)).not.toContain("# Project only");
		await created.value.close();
	});
});

async function createTestAgent(input: {
	readonly root: string;
	readonly requests: unknown[];
	readonly responses: AssistantMessage[];
	readonly extensions: readonly ReturnType<typeof defineExtension>[];
}) {
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			input.requests.push(await request.json());
			const response = input.responses.shift();
			if (!response) return new Response("No fake provider response left", { status: 500 });
			return new Response(anthropicEvents(response), { headers: { "content-type": "text/event-stream" } });
		},
	});
	servers.push(server);
	return createCodingAgent({
		model: "anthropic/test-model",
		cwd: input.root,
		fileCapabilities: { homeDirectory: input.root, workspaceDirectory: input.root, workspaceTrusted: false },
		provider: { apiKey: "test", baseUrl: server.url.toString() },
		session: { kind: "ephemeral" },
		extensions: input.extensions,
	});
}

async function temporaryDirectory(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "jai-skills-extension-"));
	roots.push(root);
	return root;
}

async function writeSkill(
	directory: string,
	name: string,
	description: string,
	body: string,
): Promise<void> {
	const skillDirectory = join(directory, name);
	await mkdir(skillDirectory, { recursive: true });
	await writeFile(
		join(skillDirectory, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
	);
}

async function writePromptCommand(directory: string, name: string, description: string, body: string): Promise<void> {
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, `${name}.md`), `---\ndescription: ${description}\n---\n\n${body}\n`);
}

async function createPluginSkill(root: string, name: string, body: string) {
	const directory = join(root, "plugin", name);
	await mkdir(directory, { recursive: true });
	const content = `---\nname: ${name}\ndescription: Plugin ${name}\n---\n\n${body}\n`;
	const location = join(directory, "SKILL.md");
	await writeFile(location, content);
	return {
		name,
		description: `Plugin ${name}`,
		contentRevision: createHash("sha256").update(content).digest("hex"),
		location: await realpath(location),
		directory,
		canonicalDirectory: await realpath(directory),
		source: { scope: "user" as const, directory: "plugin" as const, pluginName: "test-plugin", pluginRoot: join(root, "plugin") },
		allowedTools: [],
		metadata: {},
	};
}

function anthropicEvents(message: AssistantMessage): string {
	const events = [
		sse("message_start", {
			type: "message_start",
			message: { id: "message-id", type: "message", role: "assistant", model: message.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } },
		}),
	];
	for (const [index, content] of message.content.entries()) {
		if (content.type === "text") {
			events.push(
				sse("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }),
				sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: content.text } }),
			);
		} else if (content.type === "toolCall") {
			events.push(
				sse("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: content.id, name: content.name, input: {} } }),
				sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(content.arguments) } }),
			);
		}
		events.push(sse("content_block_stop", { type: "content_block_stop", index }));
	}
	events.push(
		sse("message_delta", { type: "message_delta", delta: { stop_reason: message.stopReason === "toolUse" ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }),
		sse("message_stop", { type: "message_stop" }),
	);
	return events.join("");
}

function sse(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function assistant(text: string): AssistantMessage {
	return { role: "assistant", content: [{ type: "text", text }], provider: "test", model: "test-model", usage: zeroUsage(), stopReason: "stop", timestamp: Date.now() };
}

function assistantToolCall(name: string, id: string, argumentsValue: Readonly<Record<string, unknown>>): AssistantMessage {
	return { ...assistant(""), content: [{ type: "toolCall", id, name, arguments: argumentsValue }], stopReason: "toolUse" };
}
