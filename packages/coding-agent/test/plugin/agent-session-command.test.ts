import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "../../src/core/config/workspace.js";
import { AgentSession } from "../../src/core/session/agent-session.js";

describe("AgentSession.chat command expansion", () => {
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

	test("tryExpandCommand returns expanded text + originalCommand when /plugin:cmd matches", async () => {
		const pluginDir = join(home, ".jai", "plugins", "demo");
		await mkdir(join(pluginDir, "commands"), { recursive: true });
		await writeFile(join(pluginDir, "plugin.json"), JSON.stringify({ name: "demo", version: "0.1.0" }));
		await writeFile(
			join(pluginDir, "commands", "review.md"),
			"---\ndescription: review\n---\nPlease review: $ARGUMENTS",
		);

		const workspace = await Workspace.create({ cwd, jaiHome: join(home, ".jai") });
		const session = await AgentSession.create({
			workspace,
			model: "anthropic/claude-3-5-sonnet-latest",
			tools: [],
		});

		const result = await session.tryExpandCommand("/demo:review foo.ts bar.ts");
		expect(result).toEqual({
			expanded: "Please review: foo.ts bar.ts",
			originalCommand: "/demo:review foo.ts bar.ts",
		});

		await session.close?.();
	});

	test("tryExpandCommand returns null for unmatched /text", async () => {
		const workspace = await Workspace.create({ cwd, jaiHome: join(home, ".jai") });
		const session = await AgentSession.create({
			workspace,
			model: "anthropic/claude-3-5-sonnet-latest",
			tools: [],
		});
		expect(await session.tryExpandCommand("/unknown-command args")).toBeNull();
		expect(await session.tryExpandCommand("regular message")).toBeNull();
		await session.close?.();
	});
});
