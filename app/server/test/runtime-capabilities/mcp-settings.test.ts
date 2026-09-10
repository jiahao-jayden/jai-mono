import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { RuntimeMcpSettingsController } from "../../src/runtime-capabilities";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RuntimeMcpSettingsController", () => {
	test("projects stale saves as a recoverable revision conflict", async () => {
		const homeDirectory = await mkdtemp(`${tmpdir()}/jai-mcp-settings-`);
		roots.push(homeDirectory);
		const controller = new RuntimeMcpSettingsController({ homeDirectory });
		try {
			const initial = await controller.snapshot();
			expect(initial.isOk()).toBe(true);
			if (initial.isErr()) return;

			const saved = await controller.save({
				revision: initial.value.revision,
				mcp: { servers: { first: { type: "stdio", command: "first" } } },
			});
			expect(saved.isOk()).toBe(true);
			if (saved.isErr()) return;

			const stale = await controller.save({
				revision: initial.value.revision,
				mcp: { servers: { second: { type: "stdio", command: "second" } } },
			});

			expect(stale).toMatchObject({
				status: "error",
				error: {
					_tag: "runtime_mcp.write_conflict",
					data: {
						expectedRevision: initial.value.revision,
						actualRevision: saved.value.revision,
					},
				},
			});
			expect(JSON.stringify(stale)).not.toContain("settings.json");
			expect(JSON.stringify(stale)).not.toContain("cause");
		} finally {
			controller.close();
		}
	});
});
