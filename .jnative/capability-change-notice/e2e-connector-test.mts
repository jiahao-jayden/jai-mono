/**
 * E2E test for Connector capability change notice.
 *
 * Connects to ACP v2 for the agent session and to the desktop-configuration
 * socket to toggle a connector's enabled flag between runs.
 *
 * Usage: bun run .jnative/capability-change-notice/e2e-connector-test.mts
 */
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";

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

class JsonRpcClient {
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
						for (const listener of this.#listeners) listener(msg as AcpNotification);
					}
				} catch { /* ignore */ }
			}
		});
		this.#socket.once("close", () => { this.#closed = true; });
		this.#socket.once("error", () => { this.#closed = true; });
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

	close(): void { this.#socket.destroy(); }
}

function acpEndpoint(): string {
	const identity = createHash("sha256").update(join(homedir(), ".jai")).digest("hex").slice(0, 20);
	return join(tmpdir(), `jai-runtime-${identity}.sock`);
}

function desktopConfigEndpoint(): string {
	const dataDir = join(homedir(), ".jai");
	const identity = createHash("sha256").update(dataDir).digest("hex").slice(0, 20);
	return join(tmpdir(), `jai-desktop-configuration-${identity}.sock`);
}

function waitForIdle(notifications: AcpNotification[], startIndex: number, timeoutMs = 60000): Promise<number> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => { clearInterval(interval); reject(new Error("timeout waiting for idle")); }, timeoutMs);
		const interval = setInterval(() => {
			for (let i = startIndex; i < notifications.length; i++) {
				const n = notifications[i]!;
				if (n.method !== "session/update") continue;
				const params = n.params as { update?: { state?: string } } | undefined;
				if (params?.update?.state === "idle") {
					clearTimeout(timeout); clearInterval(interval); resolve(i + 1); return;
				}
			}
		}, 200);
	});
}

async function main() {
	const acpEp = acpEndpoint();
	const configEp = desktopConfigEndpoint();
	if (!existsSync(acpEp)) { console.error("✗ ACP socket not found at", acpEp); process.exit(1); }
	if (!existsSync(configEp)) { console.error("✗ Desktop config socket not found at", configEp); process.exit(1); }

	console.log("→ Connecting to ACP at", acpEp);
	const acp = new JsonRpcClient(acpEp);
	const config = new JsonRpcClient(configEp);

	const notifications: AcpNotification[] = [];
	const unsubscribe = acp.subscribe((n) => {
		notifications.push(n);
		if (n.method === "session/update") {
			const params = n.params as { update?: { sessionUpdate?: string } } | undefined;
			const kind = params?.update?.sessionUpdate ?? "?";
			if (kind !== "agent_message_chunk") console.log(`  [notif] ${kind}`);
		}
	});

	try {
		await acp.request("initialize", { protocolVersion: 2, capabilities: {}, info: { name: "e2e-connector", version: "1.0.0" } });
		const created = await acp.request("session/new", { cwd: join(homedir(), "code", "jai-mono") }) as { sessionId: string };
		const sessionId = created.sessionId;
		console.log("  sessionId:", sessionId);

		// 1. First prompt
		console.log("→ First prompt: 'say hi'");
		await acp.request("session/prompt", { sessionId, prompt: [{ type: "text", text: "say hi" }] });
		await waitForIdle(notifications, 0);
		console.log("  ✓ First run done");

		// 2. Read current settings and disable a connector
		console.log("→ Reading current settings via desktop-configuration");
		const current = await config.request("jai/desktop-configuration/get") as {
			revision: string;
			model: string;
			language?: string;
			profiles: Array<Record<string, unknown>>;
			connector?: { policy?: { default?: string; actions?: Record<string, string> }; connectors?: Array<{ id: string; enabled?: boolean; credentials?: unknown }> };
		};

		const connectors = current.connector?.connectors ?? [];
		const targetConnector = connectors.find((c) => c.enabled !== false);
		if (!targetConnector) { console.error("✗ No enabled connector to disable"); process.exit(1); }
		console.log("  Disabling connector:", targetConnector.id);

		// Convert get-response format to save-input format
		const providers = current.profiles.map((p) => ({
			id: p.id,
			name: p.name,
			adapter: p.adapter,
			authentication: p.authentication,
			enabled: p.enabled,
			...(p.baseURL !== undefined ? { baseURL: p.baseURL } : {}),
			models: p.models ?? [],
		}));

		const connectorsRecord: Record<string, { enabled?: boolean; credentials?: Record<string, string> }> = {};
		for (const c of connectors) {
			connectorsRecord[c.id] = { enabled: c.id === targetConnector.id ? false : (c.enabled ?? true), credentials: {} };
		}

		const saveInput = {
			revision: current.revision,
			model: current.model,
			...(current.language !== undefined ? { language: current.language } : {}),
			providers,
			connector: {
				policy: current.connector?.policy ?? { default: "ask", actions: {} },
				connectors: connectorsRecord,
			},
		};

		await config.request("jai/desktop-configuration/save", saveInput);
		console.log("  ✓ Settings saved, waiting for propagation...");
		await new Promise((r) => setTimeout(r, 3000));

		// 3. Second prompt — ask about the notice
		console.log("→ Second prompt: asking about notice");
		const notifBeforeSecond = notifications.length;
		await acp.request("session/prompt", { sessionId, prompt: [{ type: "text", text: "请用中文重复你在这条消息之前收到的通知内容，只列条目名，不要解释" }] });
		await waitForIdle(notifications, notifBeforeSecond);
		console.log("  ✓ Second run done");

		// 4. Check model response
		const secondRunMessages = notifications
			.slice(notifBeforeSecond)
			.filter((n) => n.method === "session/update")
			.map((n) => n.params as { update?: { sessionUpdate?: string; content?: unknown } })
			.filter((p) => p.update?.sessionUpdate === "agent_message")
			.map((p) => JSON.stringify(p.update?.content ?? "").slice(0, 500));

		const responseText = secondRunMessages.join(" ");
		const mentionsConnector = ["connector", "删除", "新增", "更新", targetConnector].some((kw) =>
			responseText.toLowerCase().includes(kw.toLowerCase())
		);

		if (mentionsConnector) {
			console.log(`\n✅ Model response mentions notice — Connector capability change notice works!`);
			console.log(`  Response: ${responseText.slice(0, 300)}`);
		} else {
			console.log(`\n❌ Model response does not mention notice.`);
			console.log(`  Response: ${responseText.slice(0, 300)}`);
		}

		// 5. Restore: re-enable the connector
		console.log("\n→ Restoring connector setting");
		const restoreConnectors: Record<string, { enabled: boolean; credentials: Record<string, string> }> = {};
		for (const c of connectors) {
			restoreConnectors[c.id] = { enabled: true, credentials: {} };
		}
		await config.request("jai/desktop-configuration/save", {
			revision: null,
			model: current.model,
			...(current.language !== undefined ? { language: current.language } : {}),
			providers,
			connector: {
				policy: current.connector?.policy ?? { default: "ask", actions: {} },
				connectors: restoreConnectors,
			},
		});
		console.log("  ✓ Restored");

	} catch (error) {
		console.error("✗ Test failed:", error);
		process.exit(1);
	} finally {
		unsubscribe();
		acp.close();
		config.close();
	}
}

main().catch(console.error);
