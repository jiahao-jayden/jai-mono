import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Workspace } from "../src/core/config/workspace.js";

const TMP = join(tmpdir(), `jai-test-${Date.now()}`);
const FAKE_HOME = join(TMP, "home");
const PROJECT_A = join(TMP, "project-a");
const PROJECT_B = join(TMP, "project-b");

beforeEach(() => {
	mkdirSync(join(FAKE_HOME, ".jai"), { recursive: true });
	mkdirSync(join(PROJECT_A, ".jai"), { recursive: true });
	mkdirSync(PROJECT_B, { recursive: true });
});

afterEach(() => {
	rmSync(TMP, { recursive: true, force: true });
});

// ── Directory paths ──────────────────────────────────────────

describe("Workspace directories", () => {
	test("projectDir is cwd/.jai", async () => {
		const ws = await Workspace.create({ cwd: PROJECT_A, home: FAKE_HOME });
		expect(ws.projectDir).toBe(join(PROJECT_A, ".jai"));
	});

	test("globalDir is ~/.jai", async () => {
		const ws = await Workspace.create({ cwd: PROJECT_A, home: FAKE_HOME });
		expect(ws.globalDir).toBe(join(FAKE_HOME, ".jai"));
	});

	test("creates .jai directories on init", async () => {
		const freshProject = join(TMP, "fresh-project");
		mkdirSync(freshProject, { recursive: true });
		const freshHome = join(TMP, "fresh-home");
		mkdirSync(freshHome, { recursive: true });

		const ws = await Workspace.create({ cwd: freshProject, home: freshHome });
		expect(existsSync(ws.projectDir)).toBe(true);
		expect(existsSync(ws.globalDir)).toBe(true);
	});
});

// ── Settings paths ──────────────────────────────────────────

describe("settings paths", () => {
	test("globalSettingsPath", async () => {
		const ws = await Workspace.create({ cwd: PROJECT_A, home: FAKE_HOME });
		expect(ws.globalSettingsPath).toBe(join(FAKE_HOME, ".jai", "settings.json"));
	});

	test("projectSettingsPath", async () => {
		const ws = await Workspace.create({ cwd: PROJECT_A, home: FAKE_HOME });
		expect(ws.projectSettingsPath).toBe(join(PROJECT_A, ".jai", "settings.json"));
	});
});

// ── sessionPath ──────────────────────────────────────────────

describe("sessionPath", () => {
	test("returns cwd/.jai/sessions/<id>.jsonl", async () => {
		const ws = await Workspace.create({ cwd: PROJECT_A, home: FAKE_HOME });
		const path = ws.sessionPath("abc-123");
		expect(path).toBe(join(PROJECT_A, ".jai", "sessions", "abc-123.jsonl"));
	});
});

// ── loadPrompts ──────────────────────────────────────────────

describe("loadPrompts", () => {
	test("project-level takes priority over global and builtin", async () => {
		writeFileSync(join(PROJECT_A, ".jai", "SOUL.md"), "project soul");
		writeFileSync(join(FAKE_HOME, ".jai", "SOUL.md"), "global soul");

		const ws = await Workspace.create({ cwd: PROJECT_A, home: FAKE_HOME });
		const prompts = await ws.loadPrompts();
		expect(prompts.soul).toBe("project soul");
	});

	test("falls back to global when project file missing", async () => {
		writeFileSync(join(FAKE_HOME, ".jai", "AGENTS.md"), "global agents");

		const ws = await Workspace.create({ cwd: PROJECT_A, home: FAKE_HOME });
		const prompts = await ws.loadPrompts();
		expect(prompts.agents).toBe("global agents");
	});

	test("falls back to builtin when both missing", async () => {
		const ws = await Workspace.create({ cwd: PROJECT_B, home: FAKE_HOME });
		const prompts = await ws.loadPrompts();
		expect(prompts.soul).toContain("我是谁");
		expect(prompts.agents).toBeTruthy();
		expect(prompts.tools).toBeTruthy();
	});

	test("static is always builtin (never overridden)", async () => {
		writeFileSync(join(PROJECT_A, ".jai", "STATIC.md"), "hacked static");

		const ws = await Workspace.create({ cwd: PROJECT_A, home: FAKE_HOME });
		const prompts = await ws.loadPrompts();
		expect(prompts.static).toContain("安全规则");
		expect(prompts.static).not.toContain("hacked");
	});

	test("loads all files in parallel", async () => {
		writeFileSync(join(PROJECT_A, ".jai", "SOUL.md"), "custom soul");
		writeFileSync(join(FAKE_HOME, ".jai", "TOOLS.md"), "custom tools");

		const ws = await Workspace.create({ cwd: PROJECT_A, home: FAKE_HOME });
		const prompts = await ws.loadPrompts();
		expect(prompts.soul).toBe("custom soul");
		expect(prompts.tools).toBe("custom tools");
		expect(prompts.static).toContain("安全规则");
	});
});
