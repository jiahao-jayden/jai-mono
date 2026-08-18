import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import {
	assertWorkspaceRelativePath,
	isInside,
	resolveArtifactPath,
	resolveWorkspacePath,
} from "../electron/workspace/paths";

const roots: string[] = [];

async function makeProject(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "jai-paths-"));
	roots.push(root);
	const real = await import("node:fs/promises").then((fs) => fs.realpath(root));
	await mkdir(path.join(real, "src"), { recursive: true });
	await writeFile(path.join(real, "src", "app.ts"), "export {};");
	return real;
}

afterAll(async () => {
	const { rm } = await import("node:fs/promises");
	for (const root of roots) await rm(root, { recursive: true, force: true });
});

describe("assertWorkspaceRelativePath", () => {
	test("规范化分隔符并剥离首尾斜杠", () => {
		expect(assertWorkspaceRelativePath("src/app.ts")).toBe("src/app.ts");
		expect(assertWorkspaceRelativePath("/src/app.ts/")).toBe("src/app.ts");
		expect(assertWorkspaceRelativePath("src\\app.ts")).toBe("src/app.ts");
		expect(assertWorkspaceRelativePath("")).toBe("");
		expect(assertWorkspaceRelativePath("/")).toBe("");
	});

	test("拒绝任何 .. 段与空段", () => {
		for (const value of ["..", "../etc/passwd", "src/../../etc", "src//app.ts", "a/../../b"]) {
			expect(() => assertWorkspaceRelativePath(value)).toThrow();
		}
	});

	test("反斜杠与首斜杠规范化为工作区内的相对路径", () => {
		// Backslashes become separators and leading slashes are stripped, so these
		// stay inside the workspace rather than escaping it.
		expect(assertWorkspaceRelativePath("\\\\etc\\passwd")).toBe("etc/passwd");
		expect(assertWorkspaceRelativePath("/src")).toBe("src");
	});
});

describe("isInside", () => {
	test("接受根自身与其子路径，拒绝兄弟目录", () => {
		expect(isInside("/a/b", "/a/b")).toBe(true);
		expect(isInside("/a/b/c", "/a/b")).toBe(true);
		expect(isInside("/a/bc", "/a/b")).toBe(false);
		expect(isInside("/a", "/a/b")).toBe(false);
	});
});

describe("resolveWorkspacePath", () => {
	test("解析工作区内的文件并校验类型", async () => {
		const root = await makeProject();
		await expect(resolveWorkspacePath(root, "src/app.ts", "file")).resolves.toBe(
			path.join(root, "src", "app.ts"),
		);
		await expect(resolveWorkspacePath(root, "src", "directory")).resolves.toBe(path.join(root, "src"));
	});

	test("类型不匹配时拒绝", async () => {
		const root = await makeProject();
		await expect(resolveWorkspacePath(root, "src", "file")).rejects.toThrow();
		await expect(resolveWorkspacePath(root, "src/app.ts", "directory")).rejects.toThrow();
	});

	test("symlink 指向工作区外时拒绝", async () => {
		const root = await makeProject();
		const outside = await mkdtemp(path.join(tmpdir(), "jai-outside-"));
		roots.push(outside);
		await writeFile(path.join(outside, "secret.txt"), "secret");
		await symlink(path.join(outside, "secret.txt"), path.join(root, "escape.txt"));

		// The string check passes — containment is only caught after realpath.
		expect(assertWorkspaceRelativePath("escape.txt")).toBe("escape.txt");
		await expect(resolveWorkspacePath(root, "escape.txt", "file")).rejects.toThrow();
	});

	test("不存在的路径拒绝而不是返回候选路径", async () => {
		const root = await makeProject();
		await expect(resolveWorkspacePath(root, "missing.ts", "file")).rejects.toThrow();
	});
});

describe("resolveArtifactPath", () => {
	test("解析项目内的 Artifact 文件", async () => {
		const root = await makeProject();
		await expect(resolveArtifactPath(root, "src/app.ts")).resolves.toBe(path.join(root, "src", "app.ts"));
	});

	test("拒绝逃出项目的 Artifact 路径", async () => {
		const root = await makeProject();
		await expect(resolveArtifactPath(root, "../../etc/passwd")).rejects.toThrow();
	});

	test("拒绝目录", async () => {
		const root = await makeProject();
		await expect(resolveArtifactPath(root, "src")).rejects.toThrow();
	});
});
