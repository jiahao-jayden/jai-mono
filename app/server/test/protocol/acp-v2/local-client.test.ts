import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLocalAcpV2Client, openLocalAcpV2Server } from "../../../src/protocol/acp-v2";
import { createRuntimeHost } from "../../../src/runtime";
import { InMemoryProductSessionPersistence } from "../../../src/sessions";

describe("ACP v2 local client", () => {
	test("sends JSON-RPC requests and receives unsolicited session updates without opening SQLite", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jai-acp-client-"));
		const endpoint = join(directory, "runtime.sock");
		const server = await openLocalAcpV2Server({
			endpoint,
			host: createRuntimeHost({
				persistence: new InMemoryProductSessionPersistence(),
				createId: (() => {
					const ids = ["session-1", "operation-1"];
					let index = 0;
					return () => ids[index++] ?? `id-${index}`;
				})(),
			}),
			info: { name: "jai", version: "0.0.0" },
		});
		if (server.isErr()) throw server.error;
		const connected = await openLocalAcpV2Client(endpoint);
		if (connected.isErr()) throw connected.error;
		const notifications: unknown[] = [];
		const unsubscribe = connected.value.subscribe((notification) => notifications.push(notification));
		try {
			const initialized = await connected.value.request("initialize", {
				protocolVersion: 2,
				capabilities: {},
				info: { name: "test-client", version: "1.0.0" },
			});
			if (initialized.isErr()) throw initialized.error;
			expect(initialized.value).toMatchObject({ protocolVersion: 2 });
			const created = await connected.value.request("session/new", { cwd: "/workspace" });
			if (created.isErr()) throw created.error;
			expect(created.value).toEqual({ sessionId: "session-1" });
			const prompted = await connected.value.request("session/prompt", {
				sessionId: "session-1",
				prompt: [{ type: "text", text: "hello" }],
			});
			if (prompted.isErr()) throw prompted.error;
			expect(prompted.value).toEqual({});
			await waitFor(() => notifications.length === 2);
			expect(notifications).toMatchObject([
				{ method: "session/update", params: { update: { sessionUpdate: "user_message" } } },
				{ method: "session/update", params: { update: { sessionUpdate: "state_update", state: "running" } } },
			]);
		} finally {
			unsubscribe();
			await connected.value.close();
			await server.value.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
});

async function waitFor(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (condition()) return;
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
	throw new Error("Timed out waiting for ACP notification");
}
