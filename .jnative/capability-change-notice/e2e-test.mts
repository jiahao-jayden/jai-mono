/**
 * E2E test for Capability Change Notice via ACP v2 protocol.
 *
 * Connects to the running Runtime Host server, creates a session,
 * sends a prompt, changes the MCP config, sends another prompt,
 * and inspects the session messages for synthetic notices.
 *
 * Usage: bun run .jnative/capability-change-notice/e2e-test.mts
 */
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createConnection } from "node:net";

// ── ACP v2 client (inline minimal implementation) ──

interface AcpNotification {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

interface AcpResponse {
	jsonrpc: "2.0";
	id: number;
	result?: unknown;
	error?: { code: number; message: string };
}

class AcpClient {
	#socket: ReturnType<typeof createConnection>;
	#nextId = 1;
	#pending = new Map<number, (res: AcpResponse) => void>();
	#listeners = new Set<(notif: AcpNotification) => void>();
	#buffer = "";
	#closed = false;

	constructor(endpoint: string) {
		this.#socket = createConnection(endpoint);
		this.#socket.setEncoding("utf8");
		this.#socket.on("data", (chunk: string) => {
			this.#buffer += chunk;
			const lines = this.#buffer.split("\n");
			this.#buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const msg = JSON.parse(line);
					if ("id" in msg && typeof msg.id === "number") {
						const resolver = this.#pending.get(msg.id);
						if (resolver) {
							this.#pending.delete(msg.id);
							resolver(msg as AcpResponse);
						}
					} else if ("method" in msg) {
						for (const listener of this.#listeners) {
							listener(msg as AcpNotification);
						}
					}
				} catch {
					// ignore parse errors
				}
			}
		});
		this.#socket.once("close", () => {
			this.#closed = true;
		});
		this.#socket.once("error", () => {
			this.#closed = true;
		});
	}

	get closed() { return this.#closed; }

	async request(method: string, params?: unknown): Promise<unknown> {
		const id = this.#nextId++;
		const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }) + "\n";
		return new Promise((resolve, reject) => {
			this.#pending.set(id, (res) => {
				if (res.error) reject(new Error(`${res.error.code}: ${res.error.message}`));
				else resolve(res.result);
			});
			this.#socket.write(payload);
		});
	}

	subscribe(listener: (notif: AcpNotification) => void): () => void {
		this.#listeners.add(listener);
		return () => { this.#listeners.delete(listener); };
	}

	close(): void {
		this.#socket.destroy();
	}
}

// ── Test helpers ──

function endpointFor(dataDir: string): string {
	const identity = createHash("sha256").update(dataDir).digest("hex").slice(0, 20);
	return join(tmpdir(), `jai-runtime-${identity}.sock`);
}

function readSettings(): Record<string, unknown> {
	const path = join(homedir(), ".jai", "settings.json");
	if (!existsSync(path)) return {};
	return JSON.parse(readFileSync(path, "utf8"));
}

function writeSettings(settings: Record<string, unknown>): void {
	const path = join(homedir(), ".jai", "settings.json");
	writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
}

function waitForIdle(notifications: AcpNotification[], startIndex: number, timeoutMs = 60000): Promise<number> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			clearInterval(interval);
			reject(new Error("timeout waiting for idle"));
		}, timeoutMs);
		const interval = setInterval(() => {
			for (let i = startIndex; i < notifications.length; i++) {
				const n = notifications[i]!;
				if (n.method !== "session/update") continue;
				const params = n.params as { update?: { sessionUpdate?: string; state?: string } } | undefined;
				if (params?.update?.state === "idle") {
					clearTimeout(timeout);
					clearInterval(interval);
					resolve(i + 1);
					return;
				}
			}
		}, 200);
	});
}

// ── Main test ──

async function main() {
	const endpoint = endpointFor(join(homedir(), ".jai"));
	if (!existsSync(endpoint)) {
		console.error("✗ Runtime Host socket not found at", endpoint);
		process.exit(1);
	}
	console.log("→ Connecting to Runtime Host at", endpoint);

	const client = new AcpClient(endpoint);
	if (client.closed) {
		console.error("✗ Failed to connect");
		process.exit(1);
	}

	const notifications: AcpNotification[] = [];
	const unsubscribe = client.subscribe((n) => {
		notifications.push(n);
		// Log interesting events with full params for debugging
		if (n.method === "session/update") {
			const params = n.params as { state?: string; event?: { type?: string } } | undefined;
			const state = params?.state ?? params?.event?.type ?? "?";
			console.log(`  [notif] session/update: ${JSON.stringify(params)?.slice(0, 200)}`);
		} else if (n.method === "session/message") {
			const params = n.params as { message?: { role?: string; content?: unknown; metadata?: unknown } };
			const meta = params.message?.metadata as { synthetic?: boolean } | undefined;
			console.log(`  [notif] session/message role=${params.message?.role ?? "?"} synthetic=${meta?.synthetic ?? false}`);
		} else {
			console.log(`  [notif] ${n.method}: ${JSON.stringify(n.params)?.slice(0, 200)}`);
		}
	});

	try {
		// 1. Initialize
		console.log("→ Initializing ACP client");
		await client.request("initialize", {
			protocolVersion: 2,
			capabilities: {},
			info: { name: "e2e-test", version: "1.0.0" },
		});

		// 2. Create session
		console.log("→ Creating session");
		const created = await client.request("session/new", {
			cwd: join(homedir(), "code", "jai-mono"),
		}) as { sessionId: string };
		const sessionId = created.sessionId;
		console.log("  sessionId:", sessionId);

		// 3. Send first prompt
		console.log("→ Sending first prompt: 'say hi in one word'");
		await client.request("session/prompt", {
			sessionId,
			prompt: [{ type: "text", text: "say hi in one word" }],
		});

		console.log("  Waiting for idle...");
		const afterFirstRun = await waitForIdle(notifications, 0, 60000);
		console.log("  ✓ First run completed");

		// 4. Capture messages so far
		const messagesBefore = notifications
			.filter((n) => n.method === "session/update")
			.map((n) => n.params as { update?: { sessionUpdate?: string; message?: { role?: string; content?: unknown; metadata?: { synthetic?: boolean } } } })
			.filter((p) => p.update?.sessionUpdate === "user_message" || p.update?.sessionUpdate === "agent_message")
			.map((p) => ({
				kind: p.update!.sessionUpdate!,
				role: p.update!.message?.role ?? (p.update!.sessionUpdate === "user_message" ? "user" : "assistant"),
				synthetic: p.update!.message?.metadata?.synthetic ?? false,
				contentPreview: JSON.stringify(p.update!.message?.content ?? p.update).slice(0, 120),
			}));
		console.log("  Messages so far:", messagesBefore.length);
		for (const m of messagesBefore) {
			console.log(`    ${m.synthetic ? "[SYNTHETIC] " : ""}${m.kind} ${m.role}: ${m.contentPreview}`);
		}

		// 5. Change MCP config — add a fake server
		console.log("→ Changing MCP config: adding a test server");
		const settings = readSettings();
		const originalMcp = (settings.mcp as { servers: Record<string, unknown> } | undefined) ?? { servers: {} };
		const testSettings = {
			...settings,
			mcp: {
				...originalMcp,
				servers: {
					...(originalMcp.servers ?? {}),
					"e2e-test-server": {
						type: "stdio",
						command: "node",
						args: ["-e", "process.exit(0)"],
						env: {},
					},
				},
			},
		};
		writeSettings(testSettings);
		console.log("  ✓ Settings written, waiting for configStore.watch to pick up...");

		// Wait for the file watcher to detect the change
		await new Promise((r) => setTimeout(r, 3000));

		// 6. Send second prompt — ask the model to repeat the notice content
		console.log("→ Sending second prompt: asking about the notice");
		const notificationsBeforeSecondRun = notifications.length;
		await client.request("session/prompt", {
			sessionId,
			prompt: [{ type: "text", text: "请用中文重复你在这条消息之前收到的通知内容，只列条目名，不要解释" }],
		});

		console.log("  Waiting for idle...");
		const afterSecondRun = await waitForIdle(notifications, notificationsBeforeSecondRun, 60000);
		console.log("  ✓ Second run completed");

		// 7. Check for synthetic notice messages in the second run
		const secondRunMessages = notifications
			.slice(notificationsBeforeSecondRun, afterSecondRun)
			.filter((n) => n.method === "session/update")
			.map((n) => n.params as { update?: { sessionUpdate?: string; message?: { role?: string; content?: unknown; metadata?: { synthetic?: boolean } } } })
			.filter((p) => p.update?.sessionUpdate === "user_message" || p.update?.sessionUpdate === "agent_message")
			.map((p) => ({
				kind: p.update!.sessionUpdate!,
				role: p.update!.message?.role ?? (p.update!.sessionUpdate === "user_message" ? "user" : "assistant"),
				synthetic: p.update!.message?.metadata?.synthetic ?? false,
				contentPreview: JSON.stringify(p.update!.message?.content ?? p.update).slice(0, 200),
			}));

		console.log("\n=== Second run messages ===");
		for (const m of secondRunMessages) {
			console.log(`  ${m.synthetic ? "[SYNTHETIC] " : ""}${m.role}: ${m.contentPreview}`);
		}

		// The synthetic notice is prepended to the agent's input but filtered from ACP projection
		// (per spec: metadata.synthetic messages are hidden from UI/ACP).
		// Verify by checking if the model's response mentions the notice content (新增/删除/更新).
		const agentResponse = secondRunMessages.find((m) => m.role === "assistant");
		const responseText = agentResponse?.contentPreview ?? "";
		const mentionsNotice = ["新增", "删除", "更新", "archify", "skill", "mcp__", "工具"].some((kw) => responseText.includes(kw));

		if (mentionsNotice) {
			console.log(`\n✅ Model response mentions notice content — capability change notice was delivered to the model!`);
			console.log(`  Response: ${responseText}`);
		} else {
			console.log("\n❌ Model response does not mention notice content.");
			console.log(`  Response: ${responseText}`);
			console.log("  The notice may not have been delivered, or the model ignored it.");
		}

		// 8. Restore original settings
		console.log("\n→ Restoring original settings");
		writeSettings(settings);
		console.log("  ✓ Settings restored");

	} catch (error) {
		console.error("✗ Test failed:", error);
		// Restore settings on error
		try {
			const settings = readSettings();
			if ((settings.mcp as { servers: Record<string, unknown> } | undefined)?.servers?.["e2e-test-server"]) {
				const { "e2e-test-server": _, ...rest } = (settings.mcp as { servers: Record<string, unknown> }).servers;
				writeSettings({ ...settings, mcp: { ...settings.mcp as object, servers: rest } });
			}
		} catch { /* ignore */ }
		process.exit(1);
	} finally {
		unsubscribe();
		client.close();
	}
}

main().catch(console.error);
