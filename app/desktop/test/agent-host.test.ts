import { describe, expect, test } from "bun:test";
import type { AgentEvent, AgentEventListener, AgentMessage } from "@jai/agent";
import { getErrorCode } from "@jai/common";
import { DesktopAgentHost, type DesktopAgentFactoryContext, type HostedCodingAgent } from "../electron/agent/host";
import type { DesktopAgentEventEnvelope } from "../shared/desktop-rpc";

describe("DesktopAgentHost", () => {
	test("维护 session 生命周期、UI transcript 与单调 seq", async () => {
		const envelopes: DesktopAgentEventEnvelope[] = [];
		const agent = new FakeAgent(async (self, input) => {
			const user = userMessage(input);
			const assistant = assistantMessage("done");
			self.emit({ type: "message_start", message: user });
			self.emit({ type: "message_end", message: user });
			self.emit({ type: "message_start", message: assistant });
			self.emit({ type: "message_end", message: assistant });
			return [user, assistant];
		});
		const host = new DesktopAgentHost((event) => envelopes.push(event), async () => agent);

		await expect(host.send(input("hello"))).resolves.toEqual({ accepted: true });
		await agent.finished;

		expect(envelopes.map((event) => event.seq)).toEqual(envelopes.map((_, index) => index + 1));
		const snapshot = host.getSnapshot("session-1");
		expect(snapshot.status).toBe("idle");
		expect(snapshot.items.filter((item) => item.kind === "message")).toHaveLength(2);
		expect(snapshot.lastSeq).toBe(envelopes.length);
		host.close();
	});

	test("权限事件不暴露原始参数，resolution 只能消费一次", async () => {
		const envelopes: DesktopAgentEventEnvelope[] = [];
		let factoryContext: DesktopAgentFactoryContext | undefined;
		const agent = new FakeAgent(async () => {
			const decision = await factoryContext!.requestApproval({
				requestId: "permission-1",
				toolCallId: "call-1",
				toolName: "Write",
				args: { path: "/tmp/file.txt", content: "secret contents" },
				reason: "Write requires approval",
				suggestedRule: "Edit(//tmp/**)",
				rememberScope: "session",
			});
			expect(decision).toBe("allowOnce");
			return [];
		});
		const host = new DesktopAgentHost((event) => envelopes.push(event), async (context) => {
			factoryContext = context;
			return agent;
		});

		await host.send(input("write"));
		await waitFor(() => envelopes.some((entry) => entry.event.type === "transcript_upsert" && entry.event.item.kind === "permission"));
		expect(JSON.stringify(envelopes)).not.toContain("secret contents");
		expect(JSON.stringify(envelopes)).toContain("/tmp/file.txt");
		host.resolvePermission({ requestId: "permission-1", decision: "allowOnce" });
		await agent.finished;

		try {
			host.resolvePermission({ requestId: "permission-1", decision: "deny" });
			throw new Error("Expected duplicate permission resolution to fail");
		} catch (error) {
			expect(getErrorCode(error)).toBe("coding_permission.request_not_found");
		}
		host.close();
	});

	test("连续 assistant delta 在 main 侧合并后发送", async () => {
		const envelopes: DesktopAgentEventEnvelope[] = [];
		const agent = new FakeAgent(async (self) => {
			self.emit({ type: "message_start", message: assistantMessage("") });
			self.emit(messageUpdate("a"));
			self.emit(messageUpdate("ab"));
			await Bun.sleep(25);
			self.emit({ type: "message_end", message: assistantMessage("ab") });
			return [];
		});
		const host = new DesktopAgentHost((event) => envelopes.push(event), async () => agent);

		await host.send(input("stream"));
		await agent.finished;

		const streamingUpdates = envelopes.filter(
			(entry) =>
				entry.event.type === "transcript_upsert" &&
				entry.event.item.kind === "message" &&
				entry.event.item.status === "streaming" &&
				entry.event.item.text !== "",
		);
		expect(streamingUpdates).toHaveLength(1);
		expect(streamingUpdates[0]?.event).toMatchObject({
			type: "transcript_upsert",
			item: { text: "ab" },
		});
		host.close();
	});
});

class FakeAgent implements HostedCodingAgent {
	readonly #listeners = new Set<AgentEventListener>();
	readonly #invoke: (agent: FakeAgent, input: string) => Promise<AgentMessage[]>;
	finished: Promise<AgentMessage[]> = Promise.resolve([]);

	constructor(invoke: (agent: FakeAgent, input: string) => Promise<AgentMessage[]>) {
		this.#invoke = invoke;
	}

	invoke(input: string): Promise<AgentMessage[]> {
		this.finished = this.#invoke(this, input);
		return this.finished;
	}

	subscribe(listener: AgentEventListener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	emit(event: AgentEvent): void {
		for (const listener of this.#listeners) void listener(event);
	}

	abort(): void {}
	steer(_message: AgentMessage): void {}
	followUp(_message: AgentMessage): void {}
	close(): void {}
}

function input(message: string) {
	return { sessionId: "session-1", workspaceRoot: "/tmp/workspace", message };
}

function userMessage(content: string): AgentMessage {
	return { role: "user", content, timestamp: 1 };
}

function assistantMessage(text: string): Extract<AgentMessage, { role: "assistant" }> {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		provider: "test",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 2,
	};
}

function messageUpdate(text: string): AgentEvent {
	const message = assistantMessage(text);
	return {
		type: "message_update",
		message,
		assistantEvent: { type: "text_delta", contentIndex: 0, delta: text.at(-1) ?? "", partial: message },
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt++) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for condition");
}
