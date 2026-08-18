import { describe, expect, test } from "bun:test";
import type {
	CodingAgentEvent,
	CodingAgentMessage,
	CodingAgentState,
	CodingAgent,
	CodingConnectorApprovalRequest,
	CodingPrompt,
	CodingRunResult,
	CodingSdkError,
	type JsonObject,
} from "@jai/coding-agent";
import { getErrorCode } from "@jai/common";
import { Result } from "better-result";
import { DesktopAgentHost, type DesktopAgentFactoryContext } from "../electron/agent/host";
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

	test("并发 send 由 CodingAgent admission 排队，Desktop 只投影 pending 状态", async () => {
		const calls: string[] = [];
		const agent = new FakeAgent(async (_self, message) => {
			calls.push(message);
			await Bun.sleep(5);
			return [];
		});
		const envelopes: DesktopAgentEventEnvelope[] = [];
		const host = new DesktopAgentHost((event) => envelopes.push(event), async () => agent);

		await Promise.all([host.send(input("first")), host.send(input("second"))]);
		await Bun.sleep(20);

		expect(calls).toEqual(["first", "second"]);
		expect(host.getSnapshot("session-1").status).toBe("idle");
		expect(envelopes.filter((entry) => entry.event.type === "status" && entry.event.status === "idle")).toHaveLength(1);
		host.close();
	});

	test("创建 runtime 时从 Coding Agent appState 恢复 Todo", async () => {
		const agent = new FakeAgent(async () => [], {
			todos: {
				version: 1,
				updatedAt: 1,
				items: [{ id: "resume", content: "Resume implementation", status: "in_progress" }],
			},
		});
		const host = new DesktopAgentHost(() => {}, async () => agent);

		await host.send(input("continue"));
		await agent.finished;

		expect(host.getSnapshot("session-1").todos).toMatchObject({
			items: [{ id: "resume", status: "in_progress" }],
		});
		host.close();
	});

	test("权限事件不暴露原始参数，resolution 只能消费一次", async () => {
		const envelopes: DesktopAgentEventEnvelope[] = [];
		let factoryContext: DesktopAgentFactoryContext | undefined;
		const agent = new FakeAgent(async () => {
			const decision = await factoryContext!.requestApproval({
				requestId: "permission-1",
				sessionId: "session-1",
				toolCallId: "call-1",
				toolName: "Write",
				args: { path: "/tmp/file.txt", content: "secret contents" },
				reason: "Write requires approval",
				canAlwaysAllow: true,
				// The SDK builds the summary; Desktop forwards it without reading args.
				summary: { title: "Write requests permission", path: "/tmp/file.txt", risk: "high" },
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

	test("Automate 不会在 Desktop approval broker 中隐式放宽权限", async () => {
		const envelopes: DesktopAgentEventEnvelope[] = [];
		let factoryContext: DesktopAgentFactoryContext | undefined;
		const agent = new FakeAgent(async () => {
			const decision = await factoryContext!.requestApproval({
				requestId: "permission-auto-1",
				sessionId: "session-1",
				toolCallId: "call-auto-1",
				toolName: "Write",
				args: { path: "src/app.ts" },
				reason: "Write requires approval",
				canAlwaysAllow: true,
			});
			expect(decision).toBe("deny");
			return [];
		});
		const host = new DesktopAgentHost((event) => envelopes.push(event), async (context) => {
			factoryContext = context;
			return agent;
		});

		await host.send(input("automate", "provider/model", "automate"));
		await waitFor(() => envelopes.some((entry) => entry.event.type === "transcript_upsert" && entry.event.item.kind === "permission"));
		host.resolvePermission({ requestId: "permission-auto-1", decision: "deny" });
		await agent.finished;

		expect(host.getSnapshot("session-1").items).toEqual([
			expect.objectContaining({
				kind: "permission",
				status: "denied",
				approvalOrigin: "manual",
			}),
		]);
		expect(
			envelopes.some(
				(entry) =>
					entry.event.type === "transcript_upsert" &&
					entry.event.item.kind === "permission" &&
					entry.event.item.status === "pending",
			),
		).toBe(true);
		host.close();
	});

	test("Automate 的 bypass policy 不改变 Connector 以外的 Desktop approval 交互语义", async () => {
		const envelopes: DesktopAgentEventEnvelope[] = [];
		let factoryContext: DesktopAgentFactoryContext | undefined;
		const agent = new FakeAgent(async () => {
			const decision = await factoryContext!.requestApproval({
				requestId: "permission-danger-1",
				sessionId: "session-1",
				toolCallId: "call-danger-1",
				toolName: "Bash",
				args: { command: "rm -rf build" },
				reason: "Destructive Bash operation requires approval",
				canAlwaysAllow: false,
			});
			expect(decision).toBe("deny");
			return [];
		});
		const host = new DesktopAgentHost((event) => envelopes.push(event), async (context) => {
			factoryContext = context;
			return agent;
		});

		await host.send(input("danger", "provider/model", "automate"));
		await waitFor(() => envelopes.some((entry) => entry.event.type === "transcript_upsert" && entry.event.item.kind === "permission"));
		host.resolvePermission({ requestId: "permission-danger-1", decision: "deny" });
		await agent.finished;
		expect(host.getSnapshot("session-1").items).toEqual([
			expect.objectContaining({
				kind: "permission",
				status: "denied",
				approvalOrigin: "manual",
			}),
		]);
		expect(
			envelopes.some(
				(entry) =>
					entry.event.type === "transcript_upsert" &&
					entry.event.item.kind === "permission" &&
					entry.event.item.status === "pending",
			),
		).toBe(true);
		host.close();
	});

	test("Connector approval 使用独立 DTO，并支持 allow once 生命周期", async () => {
		const envelopes: DesktopAgentEventEnvelope[] = [];
		let factoryContext: DesktopAgentFactoryContext | undefined;
		const agent = new FakeAgent(async () => {
			const decision = await factoryContext!.requestConnectorApproval({
				requestId: "connector-approval-1",
				sessionId: "session-1",
				toolCallId: "call-connector-1",
				toolName: "connector__execute_action",
				actionId: "github.create_issue",
				reason: "Create a GitHub issue.",
				sideEffect: "write",
				dataSensitivity: "normal",
				inputKeys: ["body", "owner", "repo", "title"],
				expiresAt: Date.now() + 300_000,
			} satisfies CodingConnectorApprovalRequest);
			expect(decision).toBe("allowOnce");
			return [];
		});
		const host = new DesktopAgentHost((event) => envelopes.push(event), async (context) => {
			factoryContext = context;
			return agent;
		});

		await host.send(input("create issue"));
		await waitFor(() =>
			envelopes.some(
				(entry) =>
					entry.event.type === "transcript_upsert" &&
					entry.event.item.kind === "connector_permission" &&
					entry.event.item.status === "pending",
			),
		);
		expect(JSON.stringify(envelopes)).not.toContain("approval-token-1");
		expect(JSON.stringify(envelopes)).toContain("github.create_issue");
		host.resolveConnectorPermission({
			kind: "connector",
			requestId: "connector-approval-1",
			decision: "allowOnce",
		});
		await agent.finished;

		try {
			host.resolveConnectorPermission({
				kind: "connector",
				requestId: "connector-approval-1",
				decision: "deny",
			});
			throw new Error("Expected duplicate Connector resolution to fail");
		} catch (error) {
			expect(getErrorCode(error)).toBe("coding_permission.request_not_found");
		}
		host.close();
	});

	test("100ms 窗口内的连续 assistant delta 合并后发送", async () => {
		const envelopes: DesktopAgentEventEnvelope[] = [];
		const agent = new FakeAgent(
			async (self) => {
				self.emit({ type: "message_start", message: assistantMessage("") });
				self.emit(messageUpdate("a"));
				self.emit(messageUpdate("ab"));
				await Bun.sleep(25);
				self.emit({ type: "message_end", message: assistantMessage("ab") });
				return [];
			},
		);
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

	test("持续流按 100ms 窗口刷新，结束时立即冲刷尾部文本", async () => {
		const envelopes: DesktopAgentEventEnvelope[] = [];
		const agent = new FakeAgent(
			async (self) => {
				self.emit({ type: "message_start", message: assistantMessage("") });
				self.emit(messageUpdate("a"));
				await Bun.sleep(110);
				self.emit(messageUpdate("ab"));
				await Bun.sleep(110);
				self.emit(messageUpdate("abc"));
				self.emit({ type: "message_end", message: assistantMessage("abc") });
				return [];
			},
		);
		const host = new DesktopAgentHost((event) => envelopes.push(event), async () => agent);

		await host.send(input("stream"));
		await agent.finished;
		await waitFor(() => envelopes.at(-1)?.event.type === "status" && envelopes.at(-1)?.event.status === "idle");

		expect(streamingMessageTexts(envelopes)).toEqual(["a", "ab", "abc"]);
		expect(envelopes.at(-2)?.event).toMatchObject({
			type: "transcript_upsert",
			item: { text: "abc", status: "complete" },
		});
		host.close();
	});

	test("同一节流窗口内保留 thinking 与 answer 的最新投影", async () => {
		const envelopes: DesktopAgentEventEnvelope[] = [];
		const agent = new FakeAgent(
			async (self) => {
				const partial = {
					...assistantMessage("answer"),
					content: [
						{ type: "text" as const, text: "answer" },
						{ type: "thinking" as const, thinking: "reasoning" },
					],
				};
				self.emit({ type: "message_start", message: assistantMessage("") });
				self.emit({
					type: "message_update",
					message: partial,
					assistantEvent: { type: "text_delta", contentIndex: 0, delta: "answer", partial },
				});
				self.emit({
					type: "message_update",
					message: partial,
					assistantEvent: { type: "thinking_delta", contentIndex: 1, delta: "reasoning", partial },
				});
				await Bun.sleep(110);
				self.emit({ type: "message_end", message: partial });
				return [partial];
			},
		);
		const host = new DesktopAgentHost((event) => envelopes.push(event), async () => agent);

		await host.send(input("inspect"));
		await agent.finished;

		const streamingItems = envelopes
			.filter((entry) => entry.event.type === "transcript_upsert" && entry.event.item.status === "streaming")
			.map((entry) => (entry.event as Extract<DesktopAgentEventEnvelope["event"], { type: "transcript_upsert" }>).item);
		expect(streamingItems).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "message", text: "answer" }),
				expect.objectContaining({ kind: "thinking", text: "reasoning" }),
			]),
		);
		host.close();
	});

	test("完整消息出现 tool call 时保留正文与工具的 content 顺序", async () => {
		const envelopes: DesktopAgentEventEnvelope[] = [];
		const agent = new FakeAgent(async (self) => {
			const streaming = assistantMessage("先分析当前版本，再动手。");
			const complete = {
				...streaming,
				content: [
					...streaming.content,
					{
						type: "toolCall" as const,
						id: "bash-1",
						name: "Bash",
						arguments: { command: "pwd" },
					},
				],
				stopReason: "toolUse" as const,
			};
			self.emit({ type: "message_start", message: assistantMessage("") });
			self.emit({
				type: "message_update",
				message: streaming,
				assistantEvent: {
					type: "text_delta",
					contentIndex: 0,
					delta: "先分析当前版本，再动手。",
					partial: streaming,
				},
			});
			self.emit({ type: "message_end", message: complete });
			return [complete];
		});
		const host = new DesktopAgentHost((event) => envelopes.push(event), async () => agent);

		await host.send(input("implement"));
		await agent.finished;

		expect(host.getSnapshot("session-1").items).toEqual([
			expect.objectContaining({ kind: "narration", text: "先分析当前版本，再动手。" }),
			expect.objectContaining({ kind: "tool", toolCallId: "bash-1" }),
		]);
		expect(
			envelopes
				.filter((entry) => entry.event.type === "transcript_upsert" && entry.event.item.id === "message:1:0")
				.map((entry) => (entry.event.type === "transcript_upsert" ? entry.event.item.kind : undefined)),
		).toEqual(["narration"]);
		host.close();
	});

	test("关闭 session 会取消尚未发送的流式刷新", async () => {
		const envelopes: DesktopAgentEventEnvelope[] = [];
		let finish = (_messages: CodingAgentMessage[]) => {};
		const pending = new Promise<CodingAgentMessage[]>((resolve) => {
			finish = resolve;
		});
		const agent = new FakeAgent(async (self) => {
			self.emit({ type: "message_start", message: assistantMessage("") });
			self.emit(messageUpdate("partial"));
			return pending;
		});
		const host = new DesktopAgentHost((event) => envelopes.push(event), async () => agent);

		await host.send(input("stream"));
		await Bun.sleep(1);
		host.closeSession("session-1");
		await Bun.sleep(110);
		finish([]);
		await agent.finished;

		expect(streamingMessageTexts(envelopes)).toEqual([]);
		host.close();
	});

	test("将 thinking delta 投影为独立步骤而不混入回答文本", async () => {
		const envelopes: DesktopAgentEventEnvelope[] = [];
		const agent = new FakeAgent(async (self) => {
			const partial = {
				...assistantMessage(""),
				content: [{ type: "thinking" as const, thinking: "Inspecting the project" }],
			};
			self.emit({ type: "message_start", message: assistantMessage("") });
			self.emit({
				type: "message_update",
				message: partial,
				assistantEvent: {
					type: "thinking_delta",
					contentIndex: 0,
					delta: "Inspecting the project",
					partial,
				},
			});
			self.emit({ type: "message_end", message: partial });
			return [partial];
		});
		const host = new DesktopAgentHost((event) => envelopes.push(event), async () => agent);

		await host.send(input("inspect"));
		await agent.finished;

		const snapshot = host.getSnapshot("session-1");
		expect(snapshot.items).toEqual([
			expect.objectContaining({
				kind: "thinking",
				text: "Inspecting the project",
				status: "complete",
			}),
		]);
		host.close();
	});

	test("thinking_end 立即完成思考步骤，不等待回答结束", async () => {
		let host: DesktopAgentHost;
		let thinkingStatus: "streaming" | "complete" | undefined;
		const agent = new FakeAgent(async (self) => {
			const partial = {
				...assistantMessage(""),
				content: [{ type: "thinking" as const, thinking: "Inspecting the project" }],
			};
			self.emit({ type: "message_start", message: assistantMessage("") });
			self.emit({
				type: "message_update",
				message: partial,
				assistantEvent: {
					type: "thinking_delta",
					contentIndex: 0,
					delta: "Inspecting the project",
					partial,
				},
			});
			self.emit({
				type: "message_update",
				message: partial,
				assistantEvent: {
					type: "thinking_end",
					contentIndex: 0,
					content: "Inspecting the project",
					partial,
				},
			});
			thinkingStatus = host.getSnapshot("session-1").items.find((item) => item.kind === "thinking")?.status;
			self.emit({ type: "message_end", message: partial });
			return [partial];
		});
		host = new DesktopAgentHost(() => {}, async () => agent);

		await host.send(input("inspect"));
		await agent.finished;

		expect(thinkingStatus).toBe("complete");
		host.close();
	});

	test("将 UpdateTodos 结果投影为状态事件且不显示为普通工具", async () => {
		const events: DesktopAgentEventEnvelope[] = [];
		const agent = new FakeAgent(async (self) => {
			const assistant = {
				...assistantMessage(""),
				content: [
					{
						type: "toolCall" as const,
						id: "todos-1",
						name: "UpdateTodos",
						arguments: {
							todos: [{ id: "render", content: "Render progress", status: "in_progress" }],
						},
					},
				],
				stopReason: "toolUse" as const,
			};
			self.emit({ type: "message_end", message: assistant });
			self.emit({
				type: "tool_execution_start",
				toolCallId: "todos-1",
				toolName: "UpdateTodos",
				title: "Updating progress",
				args: { todos: [{ id: "render", content: "Render progress", status: "in_progress" }] },
			});
			self.emit({
				type: "tool_execution_end",
				toolCallId: "todos-1",
				toolName: "UpdateTodos",
				result: {
					content: [{ type: "text", text: "Todo list updated." }],
					details: {
						todos: {
							version: 1,
							updatedAt: 1_786_017_600_000,
							items: [{ id: "render", content: "Render progress", status: "in_progress" }],
						},
					},
				},
				isError: false,
			});
				return [assistant];
			},
			{
				todos: {
					version: 1,
					updatedAt: 1_786_017_600_000,
					items: [{ id: "render", content: "Render progress", status: "in_progress" }],
				},
			},
		);
		const host = new DesktopAgentHost((event) => events.push(event), async () => agent);

		await host.send(input("implement"));
		await agent.finished;

		expect(host.getSnapshot("session-1")).toMatchObject({
			todos: { items: [{ id: "render", status: "in_progress" }] },
			items: [],
		});
		expect(events.some((envelope) => envelope.event.type === "todos_replace")).toBe(true);
		host.close();
	});

	test("将 SpawnAgent 活动投影为单个 Subagent 项", async () => {
		const agent = new FakeAgent(async (self) => {
			const assistant = {
				...assistantMessage(""),
				content: [
					{
						type: "toolCall" as const,
						id: "subagent-1",
						name: "SpawnAgent",
						arguments: { title: "Inspect repository", task: "Inspect the repository." },
					},
				],
				stopReason: "toolUse" as const,
			};
			self.emit({ type: "message_end", message: assistant });
			self.emit({
				type: "tool_execution_start",
				toolCallId: "subagent-1",
				toolName: "SpawnAgent",
				title: "Inspect repository",
				args: { title: "Inspect repository", task: "Inspect the repository." },
			});
			self.emit({
				type: "tool_execution_update",
				toolCallId: "subagent-1",
				toolName: "SpawnAgent",
				partial: {
					content: [],
					details: {
						title: "Inspect repository",
						status: "running",
						activityTitle: "Reading repository files",
					},
				},
			});
			self.emit({
				type: "tool_execution_end",
				toolCallId: "subagent-1",
				toolName: "SpawnAgent",
				result: {
					content: [{ type: "text", text: "Inspection complete." }],
					details: {
						title: "Inspect repository",
						status: "complete",
						activityTitle: "Reading repository files",
					},
				},
				isError: false,
			});
			return [assistant];
		});
		const host = new DesktopAgentHost(() => {}, async () => agent);

		await host.send(input("inspect"));
		await agent.finished;

		expect(host.getSnapshot("session-1").items).toEqual([
			expect.objectContaining({
				kind: "subagent",
				title: "Inspect repository",
				status: "complete",
				activityTitle: "Reading repository files",
			}),
		]);
		host.close();
	});

	test("工具结果附着到工具项并保留调用摘要", async () => {
		const agent = new FakeAgent(async (self) => {
			self.emit({
				type: "tool_execution_start",
				toolCallId: "call-1",
				toolName: "Read",
				title: "Read README.md",
				args: { path: "README.md" },
			});
			self.emit({
				type: "tool_execution_end",
				toolCallId: "call-1",
				toolName: "Read",
				result: { content: [{ type: "text", text: "Project documentation" }] },
				isError: false,
			});
			return [];
		});
		const host = new DesktopAgentHost(() => {}, async () => agent);

		await host.send(input("read"));
		await agent.finished;

		expect(host.getSnapshot("session-1").items).toEqual([
			expect.objectContaining({
				kind: "tool",
				summary: "README.md",
				details: "Project documentation",
				status: "complete",
			}),
		]);
		host.close();
	});

		test("成功的 Markdown 与 HTML 写入即时发布为 Artifact", async () => {
			const events: DesktopAgentEventEnvelope[] = [];
			const agent = new FakeAgent(
				async (self) => {
					self.emit({
						type: "tool_execution_start",
						toolCallId: "markdown-1",
						toolName: "Write",
						title: "Write report.md",
						args: { path: "reports/report.md" },
					});
					self.emit({
						type: "tool_execution_end",
						toolCallId: "markdown-1",
						toolName: "Write",
						result: { content: [] },
						isError: false,
					});
					self.emit({
						type: "tool_execution_start",
						toolCallId: "failed-html-1",
						toolName: "Edit",
						title: "Edit preview.html",
						args: { path: "preview.html" },
					});
					self.emit({
						type: "tool_execution_end",
						toolCallId: "failed-html-1",
						toolName: "Edit",
						result: { content: [] },
						isError: true,
					});
					self.emit({
						type: "tool_execution_start",
						toolCallId: "text-1",
						toolName: "Write",
						title: "Write notes.txt",
						args: { path: "notes.txt" },
					});
					self.emit({
						type: "tool_execution_end",
						toolCallId: "text-1",
						toolName: "Write",
						result: { content: [] },
						isError: false,
					});
					return [];
				},
				{
					artifacts: {
						version: 1,
						items: [
							{
								id: "artifact:reports/report.md",
								toolCallId: "markdown-1",
								path: "reports/report.md",
								format: "markdown",
								updatedAt: 1,
							},
						],
					},
				},
			);
		const host = new DesktopAgentHost((event) => events.push(event), async () => agent);

		await host.send(input("write artifacts"));
		await agent.finished;
		await waitFor(() => events.some((event) => event.event.type === "artifact_upsert"));

		expect(host.getSnapshot("session-1").artifacts).toEqual([
			expect.objectContaining({
				id: "artifact:reports/report.md",
				path: "reports/report.md",
				format: "markdown",
			}),
		]);
		expect(events.filter((event) => event.event.type === "artifact_upsert")).toHaveLength(1);
		expect(host.getSnapshot("session-1").items).toContainEqual(
			expect.objectContaining({
				kind: "tool",
				toolCallId: "failed-html-1",
				status: "complete",
			}),
		);
		expect(agent.state.appState).toMatchObject({ artifacts: { version: 1 } });
		host.close();
	});

	test("首轮完成后把输入与结果交给标题生成边界", async () => {
		const messages = [userMessage("build it"), assistantMessage("done")];
		const agent = new FakeAgent(async () => messages);
		const host = new DesktopAgentHost(() => {}, async () => agent);
		let completed:
			| { readonly sessionId: string; readonly firstMessage: string; readonly messages: readonly CodingAgentMessage[] }
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

	test("空闲会话切换 Agent 模式时重建 Agent", async () => {
		const modes: string[] = [];
		const agents: FakeAgent[] = [];
		const host = new DesktopAgentHost(() => {}, async ({ mode }) => {
			modes.push(mode);
			const agent = new FakeAgent(async () => []);
			agents.push(agent);
			return agent;
		});

		await host.send(input("first", "provider/model", "manual"));
		await agents[0]?.finished;
		await host.send(input("second", "provider/model", "plan"));
		await agents[1]?.finished;

		expect(modes).toEqual(["manual", "plan"]);
		host.close();
	});

	test("配置失效时立即关闭空闲 runtime，并在运行结束后关闭忙碌 runtime", async () => {
		let finishRun = (_messages: CodingAgentMessage[]) => {};
		const pendingRun = new Promise<CodingAgentMessage[]>((resolve) => {
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
		await expect(host.send(input("continue in new project"))).resolves.toEqual({ accepted: true });
		await replacement.finished;
		host.close();
	});
});

class FakeAgent implements CodingAgent {
	readonly sessionId = "session-1";
	readonly execution = {};
	readonly #listeners = new Set<(event: CodingAgentEvent) => void>();
	readonly #invoke: (agent: FakeAgent, input: string) => Promise<CodingAgentMessage[]>;
	finished: Promise<CodingAgentMessage[]> = Promise.resolve([]);
	#appState: Record<string, unknown>;
	#artifacts: CodingAgentState["artifacts"];

	constructor(invoke: (agent: FakeAgent, input: string) => Promise<CodingAgentMessage[]>, appState: unknown = {}) {
		this.#invoke = invoke;
		this.#appState =
			typeof appState === "object" && appState !== null && !Array.isArray(appState)
				? structuredClone(appState) as Record<string, unknown>
				: {};
		this.#artifacts = projectArtifacts(this.#appState);
	}

	get state(): CodingAgentState {
		return {
			sessionId: "session-1",
			status: "idle",
			messages: [],
			todos: [],
			artifacts: this.#artifacts,
			appState: structuredClone(this.#appState) as JsonObject,
		};
	}

	prompt(input: CodingPrompt): Promise<Result<CodingRunResult, CodingSdkError>> {
		this.finished = this.#invoke(this, input.prompt);
		return this.finished.then((messages) => Result.ok({ sessionId: this.sessionId, messages, state: this.state }));
	}

	subscribe(listener: (event: CodingAgentEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	emit(event: CodingAgentEvent): void {
		for (const listener of this.#listeners) void listener(event);
	}

	abort(): Promise<Result<void, CodingSdkError>> {
		return Promise.resolve(Result.ok(undefined));
	}
	steer(_input: CodingPrompt): Promise<Result<void, CodingSdkError>> {
		return Promise.resolve(Result.ok(undefined));
	}
	followUp(_input: CodingPrompt): Promise<Result<void, CodingSdkError>> {
		return Promise.resolve(Result.ok(undefined));
	}
	waitForIdle(): Promise<Result<void, CodingSdkError>> {
		return this.finished.then(() => Result.ok(undefined));
	}
	generateTitle(): Promise<Result<string, CodingSdkError>> {
		return Promise.resolve(Result.ok("Test title"));
	}
	close(): Promise<Result<void, CodingSdkError>> {
		return Promise.resolve(Result.ok(undefined));
	}
}

class RebindableFakeAgent implements CodingAgent {
	readonly sessionId = "session-1";
	readonly execution = {};
	readonly #listeners = new Set<(event: CodingAgentEvent) => void>();
	readonly toolStarted: Promise<void>;
	readonly #resolveToolStarted: () => void;
	readonly #toolFinished: Promise<void>;
	readonly #resolveToolFinished: () => void;
	readonly #aborted: Promise<void>;
	readonly #resolveAborted: () => void;
	finished: Promise<CodingAgentMessage[]> = Promise.resolve([]);
	aborted = false;
	toolResultPersisted = false;

	get state(): CodingAgentState {
		return {
			sessionId: "session-1",
			status: "idle",
			messages: [],
			todos: [],
			artifacts: [],
			appState: {},
		};
	}

	constructor() {
		[this.toolStarted, this.#resolveToolStarted] = deferred();
		[this.#toolFinished, this.#resolveToolFinished] = deferred();
		[this.#aborted, this.#resolveAborted] = deferred();
	}

	prompt(): Promise<Result<CodingRunResult, CodingSdkError>> {
		this.finished = this.#run();
		return this.finished.then((messages) => Result.ok({ sessionId: this.sessionId, messages, state: this.state }));
	}

	subscribe(listener: (event: CodingAgentEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	finishTool(): void {
		this.#resolveToolFinished();
	}

	abort(): Promise<Result<void, CodingSdkError>> {
		this.aborted = true;
		this.#resolveAborted();
		return Promise.resolve(Result.ok(undefined));
	}

	waitForIdle(): Promise<Result<void, CodingSdkError>> {
		return this.finished.then(() => Result.ok(undefined));
	}

	steer(_input: CodingPrompt): Promise<Result<void, CodingSdkError>> {
		return Promise.resolve(Result.ok(undefined));
	}
	followUp(_input: CodingPrompt): Promise<Result<void, CodingSdkError>> {
		return Promise.resolve(Result.ok(undefined));
	}
	generateTitle(): Promise<Result<string, CodingSdkError>> {
		return Promise.resolve(Result.ok("Test title"));
	}
	close(): Promise<Result<void, CodingSdkError>> {
		return Promise.resolve(Result.ok(undefined));
	}

	async #run(): Promise<CodingAgentMessage[]> {
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
			title: "Read README.md",
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

	async #emit(event: CodingAgentEvent): Promise<void> {
		for (const listener of this.#listeners) await listener(event);
	}
}

function projectArtifacts(appState: Record<string, unknown>): CodingAgentState["artifacts"] {
	const value = appState.artifacts;
	if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
	const items = (value as { readonly items?: unknown }).items;
	if (!Array.isArray(items)) return [];
	return items.flatMap((item) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
		const candidate = item as Record<string, unknown>;
		if (
			typeof candidate.id !== "string" ||
			typeof candidate.toolCallId !== "string" ||
			typeof candidate.path !== "string" ||
			(candidate.format !== "markdown" && candidate.format !== "html") ||
			typeof candidate.updatedAt !== "number"
		)
			return [];
		return [
			{
				id: candidate.id,
				toolCallId: candidate.toolCallId,
				path: candidate.path,
				format: candidate.format,
				updatedAt: candidate.updatedAt,
			},
		];
	});
}

function input(message: string, modelRef = "provider/model", mode: "manual" | "automate" | "plan" = "manual") {
	return { sessionId: "session-1", message, modelRef, mode };
}

function userMessage(content: string): CodingAgentMessage {
	return { role: "user", content, timestamp: 1 };
}

function assistantMessage(text: string): Extract<CodingAgentMessage, { role: "assistant" }> {
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

function messageUpdate(text: string): CodingAgentEvent {
	const message = assistantMessage(text);
	return {
		type: "message_update",
		message,
		assistantEvent: { type: "text_delta", contentIndex: 0, delta: text.at(-1) ?? "", partial: message },
	};
}

function streamingMessageTexts(envelopes: readonly DesktopAgentEventEnvelope[]): string[] {
	return envelopes.flatMap((entry) => {
		if (entry.event.type !== "transcript_upsert") return [];
		const { item } = entry.event;
		return item.kind === "message" && item.status === "streaming" && item.text ? [item.text] : [];
	});
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
