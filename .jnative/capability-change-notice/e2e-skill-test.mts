/**
 * E2E test for Skill capability change notice.
 *
 * Creates a session, sends a prompt, adds a new skill file,
 * sends another prompt asking about the notice, and verifies
 * the model mentions the new skill.
 *
 * Usage: bun run .jnative/capability-change-notice/e2e-skill-test.mts
 */
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
						if (resolver) { this.#pending.delete(msg.id); resolver(msg as AcpResponse); }
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

const SKILL_DIR = join(homedir(), ".agents", "skills", "e2e-test-skill");
const SKILL_FILE = join(SKILL_DIR, "SKILL.md");
const SKILL_CONTENT = `---
name: e2e-test-skill
description: E2E test skill for capability change notice
---

This is a test skill for E2E verification.
`;

async function main() {
	const ep = acpEndpoint();
	if (!existsSync(ep)) { console.error("✗ ACP socket not found at", ep); process.exit(1); }

	console.log("→ Connecting to ACP at", ep);
	const client = new JsonRpcClient(ep);

	const notifications: AcpNotification[] = [];
	const unsubscribe = client.subscribe((n) => {
		notifications.push(n);
		if (n.method === "session/update") {
			const params = n.params as { update?: { sessionUpdate?: string } } | undefined;
			const kind = params?.update?.sessionUpdate ?? "?";
			if (kind !== "agent_message_chunk") console.log(`  [notif] ${kind}`);
		}
	});

	try {
		await client.request("initialize", { protocolVersion: 2, capabilities: {}, info: { name: "e2e-skill", version: "1.0.0" } });
		const created = await client.request("session/new", { cwd: join(homedir(), "code", "jai-mono") }) as { sessionId: string };
		const sessionId = created.sessionId;
		console.log("  sessionId:", sessionId);

		// 1. First prompt
		console.log("→ First prompt: 'say hi'");
		await client.request("session/prompt", { sessionId, prompt: [{ type: "text", text: "say hi" }] });
		await waitForIdle(notifications, 0);
		console.log("  ✓ First run done");

		// 2. Add a new skill file
		console.log("→ Adding new skill: e2e-test-skill");
		mkdirSync(SKILL_DIR, { recursive: true });
		writeFileSync(SKILL_FILE, SKILL_CONTENT);
		console.log("  ✓ Skill file written, waiting for file watcher...");
		await new Promise((r) => setTimeout(r, 3000));

		// 3. Second prompt — ask about the notice
		console.log("→ Second prompt: asking about notice");
		const notifBeforeSecond = notifications.length;
		await client.request("session/prompt", { sessionId, prompt: [{ type: "text", text: "请用中文重复你在这条消息之前收到的通知内容，只列条目名，不要解释" }] });
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
		const mentionsSkill = ["e2e-test-skill", "新增", "skill"].some((kw) =>
			responseText.toLowerCase().includes(kw.toLowerCase())
		);

		if (mentionsSkill) {
			console.log(`\n✅ Model response mentions notice — Skill capability change notice works!`);
			console.log(`  Response: ${responseText.slice(0, 300)}`);
		} else {
			console.log(`\n❌ Model response does not mention notice.`);
			console.log(`  Response: ${responseText.slice(0, 300)}`);
		}

		// 5. Clean up: remove the skill file
		console.log("\n→ Cleaning up: removing test skill");
		rmSync(SKILL_DIR, { recursive: true, force: true });
		console.log("  ✓ Cleaned up");

	} catch (error) {
		console.error("✗ Test failed:", error);
		rmSync(SKILL_DIR, { recursive: true, force: true });
		process.exit(1);
	} finally {
		unsubscribe();
		client.close();
	}
}

main().catch(console.error);
