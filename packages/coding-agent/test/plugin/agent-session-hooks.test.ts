import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "../../src/core/config/workspace.js";
import { AgentSession } from "../../src/core/session/agent-session.js";

describe("AgentSession plugin integration", () => {
	let home: string;
	let cwd: string;

	beforeEach(async () => {
		home = await mkdtemp(join(tmpdir(), "jai-home-"));
		cwd = await mkdtemp(join(tmpdir(), "jai-cwd-"));
	});

	afterEach(async () => {
		await rm(home, { recursive: true }).catch(() => {});
		await rm(cwd, { recursive: true }).catch(() => {});
	});

	test("loads plugins from ~/.jai/plugins", async () => {
		const userPluginDir = join(home, ".jai", "plugins", "user-demo");
		await mkdir(join(userPluginDir, "commands"), { recursive: true });
		await writeFile(join(userPluginDir, "plugin.json"), JSON.stringify({ name: "user-demo", version: "0.1.0" }));
		await writeFile(join(userPluginDir, "commands", "hello.md"), "---\ndescription: say hello\n---\nHi there");

		const workspace = await Workspace.create({ cwd, jaiHome: join(home, ".jai") });
		const session = await AgentSession.create({
			workspace,
			model: "anthropic/claude-3-5-sonnet-latest",
			tools: [],
		});

		const commands = session.listPluginCommands();
		expect(commands.find((c) => c.fullName === "user-demo:hello")).toBeDefined();

		await session.close?.();
	});

	test("does not load plugins from cwd/.jai/plugins (project scope disabled)", async () => {
		const projectPluginDir = join(cwd, ".jai", "plugins", "project-demo");
		await mkdir(join(projectPluginDir, "commands"), { recursive: true });
		await writeFile(
			join(projectPluginDir, "plugin.json"),
			JSON.stringify({ name: "project-demo", version: "0.1.0" }),
		);
		await writeFile(
			join(projectPluginDir, "commands", "commit.md"),
			"---\ndescription: commit\n---\nCommit: $ARGUMENTS",
		);

		const workspace = await Workspace.create({ cwd, jaiHome: join(home, ".jai") });
		const session = await AgentSession.create({
			workspace,
			model: "anthropic/claude-3-5-sonnet-latest",
			tools: [],
		});

		const commands = session.listPluginCommands();
		expect(commands.find((c) => c.fullName === "project-demo:commit")).toBeUndefined();

		await session.close?.();
	});

	test("listPluginCommands returns empty array when no plugins", async () => {
		const workspace = await Workspace.create({ cwd, jaiHome: join(home, ".jai") });
		const session = await AgentSession.create({
			workspace,
			model: "anthropic/claude-3-5-sonnet-latest",
			tools: [],
		});
		expect(session.listPluginCommands()).toEqual([]);
		await session.close?.();
	});

	test("preToolCall hook sees events and can skip execution", async () => {
		// Register a plugin that intercepts all tool calls via index.ts
		const pluginDir = join(home, ".jai", "plugins", "interceptor");
		await mkdir(pluginDir, { recursive: true });
		await writeFile(join(pluginDir, "plugin.json"), JSON.stringify({ name: "interceptor", version: "0.1.0" }));
		await writeFile(
			join(pluginDir, "index.ts"),
			`
      export default function (jai) {
        jai.on("preToolCall", async () => ({
          skip: true,
          result: { content: [{ type: "text", text: "FAKED" }] },
        }));
      }
      `,
		);

		const workspace = await Workspace.create({ cwd, jaiHome: join(home, ".jai") });
		const session = await AgentSession.create({
			workspace,
			model: "anthropic/claude-3-5-sonnet-latest",
			tools: [],
		});

		const combined = session.getCombinedPreToolCall?.();
		expect(combined).toBeDefined();

		const result = await combined!({ toolCallId: "t1", toolName: "bash", args: { cmd: "ls" } });
		expect(result).toMatchObject({
			skip: true,
			result: { content: [{ type: "text", text: "FAKED" }] },
		});

		await session.close?.();
	});

	test("preCompact hook receives event and can skip", async () => {
		const pluginDir = join(home, ".jai", "plugins", "no-compact");
		await mkdir(pluginDir, { recursive: true });
		await writeFile(join(pluginDir, "plugin.json"), JSON.stringify({ name: "no-compact", version: "0.1.0" }));
		await writeFile(
			join(pluginDir, "index.ts"),
			`
      export default function (jai) {
        jai.on("preCompact", async () => ({ skip: true }));
      }
      `,
		);

		const workspace = await Workspace.create({ cwd, jaiHome: join(home, ".jai") });
		const session = await AgentSession.create({
			workspace,
			model: "anthropic/claude-3-5-sonnet-latest",
			tools: [],
		});

		const combined = session.getCombinedPreCompact?.();
		expect(combined).toBeDefined();
		const result = await combined!({
			sessionId: "s",
			messageCount: 100,
			inputTokens: 90000,
			contextLimit: 100000,
		});
		expect(result).toEqual({ skip: true });

		await session.close?.();
	});
});
