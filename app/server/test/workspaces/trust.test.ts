import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteWorkspaceTrust } from "../../src/workspaces";

const workspaces: string[] = [];

afterEach(async () => {
	await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});

describe("Runtime Workspace trust", () => {
	test("reduces an append-only trust history by canonical workspace root", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "jai-workspace-trust-"));
		workspaces.push(workspace);
		const canonicalWorkspace = await realpath(workspace);
		const database = new DatabaseSync(":memory:");
		try {
			const trust = new SqliteWorkspaceTrust(database);
			const initial = await trust.get(workspace);
			if (initial.isErr()) throw initial.error;
			expect(initial.value).toEqual({ workspacePath: canonicalWorkspace, trusted: false });

			const allowed = await trust.set(
				{ workspacePath: workspace, trusted: true },
				"2026-08-26T00:00:00.000Z",
			);
			if (allowed.isErr()) throw allowed.error;
			expect(allowed.value).toEqual({
				workspacePath: canonicalWorkspace,
				trusted: true,
				updatedAt: "2026-08-26T00:00:00.000Z",
			});

			const revoked = await trust.set(
				{ workspacePath: workspace, trusted: false },
				"2026-08-26T00:01:00.000Z",
			);
			if (revoked.isErr()) throw revoked.error;
			const current = await trust.get(workspace);
			if (current.isErr()) throw current.error;
			expect(current.value).toEqual({
				workspacePath: canonicalWorkspace,
				trusted: false,
				updatedAt: "2026-08-26T00:01:00.000Z",
			});
			expect(
				database
					.prepare("SELECT COUNT(*) AS count FROM runtime_workspace_trust_facts WHERE workspace_path = ?")
					.get(canonicalWorkspace),
			).toEqual({ count: 2 });
		} finally {
			database.close();
		}
	});

	test("rejects a non-absolute workspace instead of trusting a Client-relative cwd", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const trust = new SqliteWorkspaceTrust(database);
			const result = await trust.set({ workspacePath: "relative-workspace", trusted: true });
			expect(result.isErr()).toBe(true);
			if (result.isOk()) throw new Error("Expected a Workspace trust path error");
			expect(result.error._tag).toBe("workspace_trust.invalid");
		} finally {
			database.close();
		}
	});
});
