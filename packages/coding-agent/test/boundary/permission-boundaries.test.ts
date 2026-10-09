import { describe, expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toolResults, useBoundaryFixture } from "./harness";

const fixture = useBoundaryFixture();
const exists = (path: string) => Bun.file(path).exists();

describe("approval decision boundary", () => {
	// requestApproval is typed `"deny" | "allowOnce" | "alwaysAllow"`, but JS callers and `as any`
	// handlers can return anything. The permission middleware only checks `=== "deny"`, so every
	// other value (false, null, undefined, "no", {}) executes the tool. Fail-open.
	test.failing.each([
		["false", false],
		["null", null],
		["undefined", undefined],
		["0", 0],
		['"no"', "no"],
		['"ALLOW"', "ALLOW"],
		["{}", {}],
	])("approval handler returning %s must not run the tool", async (_label, decision) => {
		const { workspace } = await fixture.prepare();
		const target = join(workspace, "x.txt");
		fixture.script({ kind: "tool", name: "Write", args: { path: target, content: "x" } }, { kind: "text", text: "done" });
		const agent = await fixture.open({ cwd: workspace, permissionMode: "ask", requestApproval: (() => decision) as never });
		await agent.prompt("x");
		expect(await exists(target)).toBe(false);
	});

	test.each(["allowOnce", "alwaysAllow"] as const)("approval %s runs the tool", async (decision) => {
		const { workspace } = await fixture.prepare();
		const target = join(workspace, "x.txt");
		fixture.script({ kind: "tool", name: "Write", args: { path: target, content: "x" } }, { kind: "text", text: "done" });
		const agent = await fixture.open({ cwd: workspace, permissionMode: "ask", requestApproval: () => decision });
		await agent.prompt("x");
		expect(await exists(target)).toBe(true);
	});

	test("a throwing approval handler denies the call and reports its message", async () => {
		const { workspace } = await fixture.prepare();
		const target = join(workspace, "x.txt");
		fixture.script({ kind: "tool", name: "Write", args: { path: target, content: "x" } }, { kind: "text", text: "done" });
		const agent = await fixture.open({
			cwd: workspace,
			permissionMode: "ask",
			requestApproval: () => {
				throw new Error("ui crashed");
			},
		});
		const [result] = toolResults(await agent.prompt("x"));
		expect(result).toMatchObject({ isError: true });
		expect(await exists(target)).toBe(false);
	});
});

describe("permission mode boundary (no approval handler configured)", () => {
	test.each([
		["ask", false, "Permission approval is unavailable"],
		["auto", false, "Permission approval is unavailable"],
		["plan", false, "Plan mode only allows read-only work"],
		["allow", true, undefined],
	] as const)("Write in %s mode: executes=%p", async (mode, executes, reason) => {
		const { workspace } = await fixture.prepare();
		const target = join(workspace, "x.txt");
		fixture.script({ kind: "tool", name: "Write", args: { path: target, content: "x" } }, { kind: "text", text: "done" });
		const agent = await fixture.open({ cwd: workspace, permissionMode: mode });
		const [result] = toolResults(await agent.prompt("x"));
		expect(await exists(target)).toBe(executes);
		if (reason) expect(result?.text).toContain(reason);
	});

	test("an unknown permissionMode behaves as ask (fails closed without a handler)", async () => {
		const { workspace } = await fixture.prepare();
		const target = join(workspace, "x.txt");
		fixture.script({ kind: "tool", name: "Write", args: { path: target, content: "x" } }, { kind: "text", text: "done" });
		const agent = await fixture.open({ cwd: workspace, permissionMode: "yolo" as never });
		await agent.prompt("x");
		expect(await exists(target)).toBe(false);
	});
});

describe("workspace path boundary, even in allow mode", () => {
	async function layout() {
		const { workspace } = await fixture.prepare();
		const outside = join(workspace, "..", "outside");
		await mkdir(outside, { recursive: true });
		await writeFile(join(outside, "secret.txt"), "TOPSECRET");
		await symlink(outside, join(workspace, "link"));
		await symlink(join(outside, "secret.txt"), join(workspace, "linkfile"));
		return { workspace, outside };
	}
	const readThrough = async (path: string, workspace: string) => {
		fixture.script({ kind: "tool", name: "Read", args: { path } }, { kind: "text", text: "done" });
		const agent = await fixture.open({ cwd: workspace, permissionMode: "allow" });
		return toolResults(await agent.prompt("x"));
	};

	test.each(["absolute outside path", "dot-dot traversal", "symlinked directory", "symlinked file"])(
		"Read via %s needs approval instead of leaking the file",
		async (kind) => {
			const { workspace, outside } = await layout();
			const path = {
				"absolute outside path": join(outside, "secret.txt"),
				"dot-dot traversal": join(workspace, "..", "outside", "secret.txt"),
				"symlinked directory": join(workspace, "link", "secret.txt"),
				"symlinked file": join(workspace, "linkfile"),
			}[kind]!;
			const [result] = await readThrough(path, workspace);
			expect(result?.isError).toBe(true);
			expect(result?.text).not.toContain("TOPSECRET");
		},
	);

	test("Write through a symlinked directory does not land outside the workspace", async () => {
		const { workspace, outside } = await layout();
		fixture.script({ kind: "tool", name: "Write", args: { path: join(workspace, "link", "pwn.txt"), content: "x" } }, { kind: "text", text: "done" });
		const agent = await fixture.open({ cwd: workspace, permissionMode: "allow" });
		await agent.prompt("x");
		expect(await exists(join(outside, "pwn.txt"))).toBe(false);
	});

	test("NUL bytes in a path are rejected", async () => {
		const { workspace } = await layout();
		await writeFile(join(workspace, "a.txt"), "hello");
		const [result] = await readThrough(`${join(workspace, "a.txt")}\u0000.png`, workspace);
		expect(result).toMatchObject({ isError: true, text: "Path cannot contain NUL" });
	});

	test("a 200 MB binary file is refused without being loaded into memory", async () => {
		const { workspace } = await layout();
		const big = join(workspace, "big.bin");
		await Bun.write(big, new Uint8Array(200_000_000));
		const before = process.memoryUsage().rss;
		const [result] = await readThrough(big, workspace);
		expect(result?.text).toContain("Cannot read binary file");
		expect(process.memoryUsage().rss - before).toBeLessThan(100_000_000);
	});
});

describe("protected configuration paths", () => {
	// `protectedPaths` (<workspace>/.jai and <home>/.jai) only feed the Bash sandbox policy. The
	// built-in Write/Edit tools can still create project config in allow mode, which a later trusted
	// session loads as policy (and a malformed `{}` makes every later createCodingAgent fail with
	// coding_config.validation_failed).
	test.failing("Write cannot create <workspace>/.jai/settings.json in allow mode", async () => {
		const { workspace } = await fixture.prepare();
		const settings = join(workspace, ".jai", "settings.json");
		fixture.script({ kind: "tool", name: "Write", args: { path: settings, content: "{}" } }, { kind: "text", text: "done" });
		const agent = await fixture.open({ cwd: workspace, permissionMode: "allow" });
		await agent.prompt("x");
		expect(await exists(settings)).toBe(false);
	});
});
