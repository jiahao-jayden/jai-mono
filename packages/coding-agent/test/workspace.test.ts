import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Workspace } from "../src/core/workspace.js";

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
	test("projectDir is cwd/.jai", () => {
		const ws = Workspace.create({ cwd: PROJECT_A, home: FAKE_HOME });
		expect(ws.projectDir).toBe(join(PROJECT_A, ".jai"));
	});

	test("globalDir is ~/.jai", () => {
		const ws = Workspace.create({ cwd: PROJECT_A, home: FAKE_HOME });
		expect(ws.globalDir).toBe(join(FAKE_HOME, ".jai"));
	});
});

// ── sessionPath ──────────────────────────────────────────────

describe("sessionPath", () => {
	test("returns cwd/.jai/sessions/<id>.jsonl", () => {
		const ws = Workspace.create({ cwd: PROJECT_A, home: FAKE_HOME });
		const path = ws.sessionPath("abc-123");
		expect(path).toBe(join(PROJECT_A, ".jai", "sessions", "abc-123.jsonl"));
	});
});

// ── resolvePromptFile ────────────────────────────────────────

describe("resolvePromptFile", () => {
	test("returns project-level file when it exists", async () => {
		writeFileSync(join(PROJECT_A, ".jai", "SOUL.md"), "project soul");
		writeFileSync(join(FAKE_HOME, ".jai", "SOUL.md"), "global soul");

		const ws = Workspace.create({ cwd: PROJECT_A, home: FAKE_HOME });
		const content = await ws.resolvePromptFile("SOUL.md");
		expect(content).toBe("project soul");
	});

	test("falls back to global when project file missing", async () => {
		writeFileSync(join(FAKE_HOME, ".jai", "AGENTS.md"), "global agents");

		const ws = Workspace.create({ cwd: PROJECT_A, home: FAKE_HOME });
		const content = await ws.resolvePromptFile("AGENTS.md");
		expect(content).toBe("global agents");
	});

	test("returns undefined when both missing", async () => {
		const ws = Workspace.create({ cwd: PROJECT_B, home: FAKE_HOME });
		const content = await ws.resolvePromptFile("TOOLS.md");
		expect(content).toBeUndefined();
	});

	test("project-level takes priority over global", async () => {
		writeFileSync(join(PROJECT_A, ".jai", "TOOLS.md"), "project tools");
		writeFileSync(join(FAKE_HOME, ".jai", "TOOLS.md"), "global tools");

		const ws = Workspace.create({ cwd: PROJECT_A, home: FAKE_HOME });
		const content = await ws.resolvePromptFile("TOOLS.md");
		expect(content).toBe("project tools");
	});
});
