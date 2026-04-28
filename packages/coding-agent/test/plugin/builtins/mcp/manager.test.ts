import { describe, expect, test } from "bun:test";
import { McpManager } from "../../../../src/plugin/builtins/mcp/manager.js";

describe("McpManager", () => {
	test("disabled servers stay in `disabled` state and do not connect", async () => {
		const mgr = new McpManager();
		const tools = await mgr.start({
			off: { command: "echo", enabled: false },
		});
		expect(tools).toEqual([]);

		const infos = mgr.getInfos();
		expect(infos).toHaveLength(1);
		expect(infos[0].name).toBe("off");
		expect(infos[0].status.status).toBe("disabled");

		await mgr.closeAll();
	});

	test("a single broken server fails without crashing siblings; status is `failed`", async () => {
		const mgr = new McpManager();
		const tools = await mgr.start({
			missing: {
				command: "/this/does/not/exist/jai-mcp-test",
				timeout: 1500,
			},
			alsoMissing: {
				command: "/another/bogus/path/jai-mcp-test",
				timeout: 1500,
			},
		});

		expect(tools).toEqual([]);
		const infos = mgr.getInfos();
		expect(infos).toHaveLength(2);
		for (const info of infos) {
			expect(info.status.status).toBe("failed");
		}

		await mgr.closeAll();
	});

	test("statusBus emits per-server transitions", async () => {
		const mgr = new McpManager();
		const seen: string[] = [];
		const off = mgr.statusBus.subscribe((info) => {
			seen.push(`${info.name}:${info.status.status}`);
		});

		await mgr.start({ broken: { command: "/nope", timeout: 1500 } });

		expect(seen).toContain("broken:pending");
		expect(seen.some((s) => s.endsWith(":failed"))).toBe(true);

		off();
		await mgr.closeAll();
	});

	test("completeAuthByState returns false when no flow matches", async () => {
		const mgr = new McpManager({
			tokenStorePath: "/tmp/jai-test-tokens-noop.json",
			oauthRedirectUrl: "http://127.0.0.1:18900/mcp/oauth/callback",
		});
		const matched = await mgr.completeAuthByState("nonexistent-state", "abc");
		expect(matched).toBe(false);
		await mgr.closeAll();
	});
});
