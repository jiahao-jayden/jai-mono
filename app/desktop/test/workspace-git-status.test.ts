import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Result } from "better-result";
import {
	parsePorcelainV2,
	readWorkspaceGitDiff,
	readWorkspaceGitStatus,
	WorkspaceGitUnavailable,
} from "../electron/workspace/git-status";

const execFileAsync = promisify(execFile);
const hash = "1234567890123456789012345678901234567890";

describe("workspace Git status", () => {
	test("parses staged, unstaged, rename, conflict and raw paths from porcelain v2 -z", () => {
		const output = [
			"# branch.oid 123",
			"# branch.head feature/git-review",
			`1 A. N... 000000 100644 100644 ${hash} ${hash} added.ts`,
			`1 M. N... 100644 100644 100644 ${hash} ${hash} staged file.ts`,
			`1 .D N... 100644 100644 000000 ${hash} ${hash} deleted.ts`,
			`2 R. N... 100644 100644 100644 ${hash} ${hash} R100 renamed file.ts`,
			"old file.ts",
			`u UU N... 100644 100644 100644 100644 ${hash} ${hash} ${hash} conflict.ts`,
			"? untracked file.ts",
			"",
		].join("\0");

		const result = parsePorcelainV2(output);
		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value).toEqual({
			branch: "feature/git-review",
			detached: false,
			hasHead: true,
			changes: [
				{ path: "added.ts", kind: "added", staged: true, unstaged: false },
				{ path: "staged file.ts", kind: "modified", staged: true, unstaged: false },
				{ path: "deleted.ts", kind: "deleted", staged: false, unstaged: true },
				{
					path: "renamed file.ts",
					oldPath: "old file.ts",
					kind: "renamed",
					staged: true,
					unstaged: false,
				},
				{ path: "conflict.ts", kind: "conflict", staged: true, unstaged: true },
				{ path: "untracked file.ts", kind: "untracked", staged: false, unstaged: true },
			],
		});
	});

	test("projects text and explicit unavailable states without truncating file contents", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "jai-git-diff-"));
		try {
			await git(root, "init");
			await git(root, "config", "user.email", "test@example.com");
			await git(root, "config", "user.name", "Jai Test");
			await writeFile(path.join(root, "modified.ts"), "before\n");
			await writeFile(path.join(root, "deleted.ts"), "deleted\n");
			await writeFile(path.join(root, "rename-me.ts"), "rename before\n");
			await writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2]));
			await writeFile(path.join(root, "invalid.txt"), "valid\n");
			await writeFile(path.join(root, "large.txt"), "small\n");
			await git(root, "add", ".");
			await git(root, "commit", "-m", "baseline");

			await writeFile(path.join(root, "modified.ts"), "after\n");
			await unlink(path.join(root, "deleted.ts"));
			await git(root, "mv", "rename-me.ts", "renamed.ts");
			await writeFile(path.join(root, "renamed.ts"), "rename after\n");
			await writeFile(path.join(root, "added.ts"), "added\n");
			await writeFile(path.join(root, "binary.bin"), Buffer.from([0, 3, 4]));
			await writeFile(path.join(root, "invalid.txt"), Buffer.from([0xc3, 0x28]));
			await writeFile(path.join(root, "large.txt"), Buffer.alloc(1_000_001, 97));
			await writeFile(path.join(root, "vanished.ts"), "temporary\n");
			await git(root, "add", "vanished.ts");
			await unlink(path.join(root, "vanished.ts"));

			await expect(diffValue(root, "modified.ts")).resolves.toEqual({
				kind: "text",
				path: "modified.ts",
				changeKind: "modified",
				oldContent: "before\n",
				newContent: "after\n",
			});
			await expect(diffValue(root, "deleted.ts")).resolves.toEqual({
				kind: "text",
				path: "deleted.ts",
				changeKind: "deleted",
				oldContent: "deleted\n",
				newContent: null,
			});
			await expect(diffValue(root, "renamed.ts")).resolves.toEqual({
				kind: "text",
				path: "renamed.ts",
				oldPath: "rename-me.ts",
				changeKind: "renamed",
				oldContent: "rename before\n",
				newContent: "rename after\n",
			});
			await expect(diffValue(root, "added.ts")).resolves.toEqual({
				kind: "text",
				path: "added.ts",
				changeKind: "untracked",
				oldContent: null,
				newContent: "added\n",
			});
			await expect(diffValue(root, "binary.bin")).resolves.toMatchObject({
				kind: "unavailable",
				reason: "binary",
			});
			await expect(diffValue(root, "invalid.txt")).resolves.toMatchObject({
				kind: "unavailable",
				reason: "invalid-encoding",
			});
			await expect(diffValue(root, "large.txt")).resolves.toMatchObject({
				kind: "unavailable",
				reason: "too-large",
			});
			await expect(diffValue(root, "vanished.ts")).resolves.toMatchObject({
				kind: "unavailable",
				reason: "missing",
			});
			await expect(diffValue(root, "not-changed.ts")).resolves.toEqual({
				kind: "not-changed",
				path: "not-changed.ts",
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("rejects malformed and escaping repository paths", () => {
		const escaping = parsePorcelainV2(`? ../outside.ts\0`);
		expect(escaping.isErr()).toBe(true);
		if (escaping.isErr()) expect(escaping.error._tag).toBe("workspace_git.invalid_output");

		const malformed = parsePorcelainV2("3 unknown\0");
		expect(malformed.isErr()).toBe(true);
	});

	test("reads a real repository without changing its index or working tree", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "jai-git-status-"));
		try {
			await git(root, "init");
			await git(root, "config", "user.email", "test@example.com");
			await git(root, "config", "user.name", "Jai Test");
			await writeFile(path.join(root, "tracked.ts"), "before\n");
			await writeFile(path.join(root, "rename-me.ts"), "rename\n");
			await git(root, "add", ".");
			await git(root, "commit", "-m", "baseline");

			await writeFile(path.join(root, "tracked.ts"), "staged\n");
			await git(root, "add", "tracked.ts");
			await writeFile(path.join(root, "tracked.ts"), "staged and unstaged\n");
			await git(root, "mv", "rename-me.ts", "renamed.ts");
			await writeFile(path.join(root, "untracked.ts"), "new\n");
			const before = await git(root, "status", "--porcelain=v2", "-z");

			const result = await readWorkspaceGitStatus(root);
			expect(result.isErr() ? result.error : null).toBeNull();
			expect(result.isOk()).toBe(true);
			if (result.isErr() || result.value.kind !== "repository") return;
			expect(result.value.changes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ path: "tracked.ts", kind: "modified", staged: true, unstaged: true }),
					expect.objectContaining({
						path: "renamed.ts",
						oldPath: "rename-me.ts",
						kind: "renamed",
						staged: true,
					}),
					expect.objectContaining({ path: "untracked.ts", kind: "untracked" }),
				]),
			);
			expect(await git(root, "status", "--porcelain=v2", "-z")).toBe(before);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("distinguishes a non-repository from an unavailable Git executable", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "jai-not-git-"));
		try {
			const outside = await readWorkspaceGitStatus(root);
			expect(outside).toEqual(Result.ok({ kind: "not-repository" }));

			const unavailable = await readWorkspaceGitStatus(root, async () =>
				Result.err(new WorkspaceGitUnavailable({ message: "Git is missing" })),
			);
			expect(unavailable.isErr()).toBe(true);
			if (unavailable.isErr()) expect(unavailable.error._tag).toBe("workspace_git.unavailable");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

async function git(cwd: string, ...args: readonly string[]): Promise<string> {
	const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
	return result.stdout;
}

async function diffValue(root: string, filePath: string) {
	const result = await readWorkspaceGitDiff(root, filePath);
	expect(result.isErr() ? result.error : null).toBeNull();
	return result.isOk() ? result.value : undefined;
}
