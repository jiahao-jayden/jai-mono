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

	test("首轮完成后把输入与结果交给标题生成边界", async () => {
		const messages = [userMessage("build it"), assistantMessage("done")];
		const agent = new FakeAgent(async () => messages);
		const host = new DesktopAgentHost(() => {}, async () => agent);
		let completed:
			| { readonly sessionId: string; readonly firstMessage: string; readonly messages: readonly AgentMessage[] }
			| undefined;
		host.setRunCompletedListener((context) => {
			completed = context;
		});

		await host.send(input("build it"));
		await agent.finished;
		await waitFor(() => completed !== undefined);

		expect(completed).toMatchObject({
			sessionId: "session-1",
			firstMessage: "build it",
			messages,
		});
		host.close();
	});

	test("空闲会话切换运行时模型时重建 Agent", async () => {
		const modelRefs: string[] = [];
		const agents: FakeAgent[] = [];
		const host = new DesktopAgentHost(() => {}, async ({ modelRef }) => {
			modelRefs.push(modelRef);
			const agent = new FakeAgent(async () => []);
			agents.push(agent);
			return agent;
		});

		await host.send(input("first", "provider/model-a"));
		await agents[0]?.finished;
		await host.send(input("second", "provider/model-b"));
		await agents[1]?.finished;

		expect(modelRefs).toEqual(["provider/model-a", "provider/model-b"]);
		host.close();
	});

	test("配置失效时立即关闭空闲 runtime，并在运行结束后关闭忙碌 runtime", async () => {
		let finishRun = (_messages: AgentMessage[]) => {};
		const pendingRun = new Promise<AgentMessage[]>((resolve) => {
			finishRun = resolve;
		});
		const agent = new FakeAgent(async () => pendingRun);
		const host = new DesktopAgentHost(() => {}, async () => agent);

		await host.send(input("keep running"));
		host.invalidateSessions();
		expect(host.hasSession("session-1")).toBe(true);

		finishRun([]);
		await agent.finished;
		await waitFor(() => !host.hasSession("session-1"));
		expect(host.hasSession("session-1")).toBe(false);
		host.close();
	});

	test("运行中移动等待工具结果落盘并重建 execution context", async () => {
		const runningAgent = new RebindableFakeAgent();
		const replacement = new FakeAgent(async () => []);
		let factoryCalls = 0;
		const host = new DesktopAgentHost(() => {}, async () => {
			factoryCalls++;
			return factoryCalls === 1 ? runningAgent : replacement;
		});

		await host.send(input("move while running"));
		await runningAgent.toolStarted;
		let moved = false;
		const moving = host.rebindSession("session-1", async () => {
			moved = true;
			return "moved";
		});
		await Bun.sleep(1);
		expect(moved).toBe(false);

		runningAgent.finishTool();
		await expect(moving).resolves.toBe("moved");

		expect(runningAgent.aborted).toBe(true);
		expect(runningAgent.toolResultPersisted).toBe(true);
		expect(factoryCalls).toBe(2);
		await expect(host.send(input("continue in new workspace"))).resolves.toEqual({ accepted: true });
		await replacement.finished;
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
	waitForIdle(): Promise<void> {
		return this.finished.then(() => {});
	}
	close(): void {}
}

class RebindableFakeAgent implements HostedCodingAgent {
	readonly #listeners = new Set<AgentEventListener>();
	readonly toolStarted: Promise<void>;
	readonly #resolveToolStarted: () => void;
	readonly #toolFinished: Promise<void>;
	readonly #resolveToolFinished: () => void;
	readonly #aborted: Promise<void>;
	readonly #resolveAborted: () => void;
	finished: Promise<AgentMessage[]> = Promise.resolve([]);
	aborted = false;
	toolResultPersisted = false;

	constructor() {
		[this.toolStarted, this.#resolveToolStarted] = deferred();
		[this.#toolFinished, this.#resolveToolFinished] = deferred();
		[this.#aborted, this.#resolveAborted] = deferred();
	}

	invoke(): Promise<AgentMessage[]> {
		this.finished = this.#run();
		return this.finished;
	}

	subscribe(listener: AgentEventListener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	finishTool(): void {
		this.#resolveToolFinished();
	}

	abort(): void {
		this.aborted = true;
		this.#resolveAborted();
	}

	waitForIdle(): Promise<void> {
		return this.finished.then(() => {});
	}

	steer(_message: AgentMessage): void {}
	followUp(_message: AgentMessage): void {}
	close(): void {}

	async #run(): Promise<AgentMessage[]> {
		const assistant = {
			...assistantMessage(""),
			content: [{ type: "toolCall" as const, id: "call-1", name: "Read", arguments: { path: "README.md" } }],
			stopReason: "toolUse" as const,
		};
		await this.#emit({ type: "message_end", message: assistant });
		await this.#emit({
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "Read",
			args: { path: "README.md" },
		});
		this.#resolveToolStarted();
		await this.#toolFinished;
		await this.#emit({
			type: "tool_execution_end",
			toolCallId: "call-1",
			toolName: "Read",
			result: { content: [{ type: "text", text: "ok" }] },
			isError: false,
		});
		await this.#emit({
			type: "message_end",
			message: {
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "Read",
				content: [{ type: "text", text: "ok" }],
				isError: false,
				timestamp: 3,
			},
		});
		this.toolResultPersisted = true;
		await this.#aborted;
		return [assistant];
	}

	async #emit(event: AgentEvent): Promise<void> {
		for (const listener of this.#listeners) await listener(event);
	}
}

function input(message: string, modelRef = "provider/model") {
	return { sessionId: "session-1", message, modelRef };
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

function deferred(): readonly [Promise<void>, () => void] {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return [promise, resolve] as const;
}
