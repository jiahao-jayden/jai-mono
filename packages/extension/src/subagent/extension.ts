import {
	type BackgroundAgentEntry,
	type BackgroundAgentStore,
	type CodingAgentExtension,
	type CodingExtensionToolExecutionCall,
	createBackgroundAgentStore,
	defineExtension,
	type JsonValue,
} from "@jai/coding-agent";
import { Type } from "@sinclair/typebox";
import { Result, TaggedError } from "better-result";

class SubagentConcurrencyLimit extends TaggedError("coding_subagent.concurrency_limit")<{ readonly message: string }> {}
class SubagentInvalidTask extends TaggedError("coding_subagent.invalid_task")<{ readonly message: string }> {}
class SubagentRunFailed extends TaggedError("coding_subagent.run_failed")<{ readonly message: string }> {}
class SubagentNoFinalText extends TaggedError("coding_subagent.no_final_text")<{ readonly message: string }> {}
class SubagentUnknownAgent extends TaggedError("coding_subagent.unknown_agent")<{ readonly message: string }> {}

const SUBAGENT_INSTRUCTIONS =
	"You are an internal subagent. Complete only the delegated task using the available tools, then return a concise final result to the parent agent. You cannot see the parent conversation, so rely only on the task and workspace.";
const SUBAGENT_EXCLUDE_TOOLS = ["SpawnAgent", "GetAgentResult", "UpdateTodos"];

interface SubagentInstance {
	active: number;
	/** Session-scoped when the host provides one; otherwise a private per-instance store. */
	background: BackgroundAgentStore;
}

export function createSubagentExtension(): CodingAgentExtension<{}, {}, SubagentInstance> {
	return defineExtension({
		id: "jai.subagent",
		lifecycle: {
			activate: (context) =>
				Result.ok({ active: 0, background: context.backgroundAgents ?? createBackgroundAgentStore() }),
		},
		hooks: {
			beforeModelCall: (runtime) => {
				const completed = runtime.instance.background
					.list()
					.filter((entry) => entry.status !== "running" && !entry.notified);
				if (!completed.length) return undefined;
				for (const entry of completed) entry.notified = true;
				return {
					context: completed
						.map((entry) =>
							entry.status === "complete"
								? `Background subagent "${entry.title}" (${entry.agentId}) completed: ${truncate(entry.text ?? "", 2000)} Collect the full result with GetAgentResult if needed.`
								: entry.stopped
									? `Background subagent "${entry.title}" (${entry.agentId}) was stopped.`
									: `Background subagent "${entry.title}" (${entry.agentId}) failed: ${truncate(entry.error ?? "unknown error", 2000)}`,
						)
						.join("\n"),
				};
			},
		},
		tools: [
			{
				name: "SpawnAgent",
				description:
					"Delegate one independent task to an isolated subagent. The task must include all required context because the subagent cannot see the parent transcript. Emit multiple independent SpawnAgent calls together when they can run in parallel. Pass run_in_background: true to keep running it in the background and continue immediately; do not poll for completion, it is announced before a later model call and the result can be collected with GetAgentResult.",
				parameters: Type.Object(
					{
						title: Type.String({
							minLength: 1,
							maxLength: 80,
							description: "Concise user-visible title, at most six words.",
						}),
						task: Type.String({
							minLength: 1,
							maxLength: 20000,
							description: "Self-contained task with all context the subagent needs.",
						}),
						run_in_background: Type.Optional(
							Type.Boolean({
								description: "When true, returns an agentId immediately and keeps running in the background.",
							}),
						),
					},
					{ additionalProperties: false },
				),
				authorization: {
					owner: "core",
					permission: {
						sideEffect: "read",
						reason: "Starts an isolated child that remains within the parent Agent permissions",
					},
				},
				presentation: { title: (_runtime, args) => (typeof args.title === "string" ? args.title : "SpawnAgent") },
				executionMode: "parallel",
				async execute(runtime, call) {
					call.signal?.throwIfAborted();
					const title = (call.args.title as string).trim();
					const task = (call.args.task as string).trim();
					if (!title || !task) throw new SubagentInvalidTask({ message: "Title and task must not be blank" });
					if (runtime.instance.active >= 4)
						throw new SubagentConcurrencyLimit({ message: "At most 4 subagents can run concurrently" });
					if (call.args.run_in_background === true) return startBackground(runtime.instance, call, title, task);
					runtime.instance.active++;
					let activityTitle: string | undefined;
					const update = (status: "running" | "complete" | "error") => {
						const details: Record<string, JsonValue> = { title, status };
						if (activityTitle) details.activityTitle = activityTitle;
						call.onUpdate?.({ content: [], details });
						return details;
					};
					try {
						update("running");
						const text = await runChild(call, {
							title,
							task,
							onActivity: (next) => {
								if (activityTitle === next) return;
								activityTitle = next;
								update("running");
							},
						});
						return { content: [{ type: "text", text }], details: update("complete") };
					} catch (error) {
						update("error");
						throw error;
					} finally {
						runtime.instance.active--;
					}
				},
			},
			{
				name: "GetAgentResult",
				description:
					"Collect the result of a background subagent started with SpawnAgent run_in_background: true. Waits until it completes; pass timeoutMs: 0 to return its current status immediately without waiting. If the wait returns while it is still running, leave it alone and ask again later.",
				parameters: Type.Object(
					{
						agentId: Type.String({
							minLength: 1,
							description: "The agentId returned by SpawnAgent.",
						}),
						timeoutMs: Type.Optional(
							Type.Integer({
								minimum: 0,
								maximum: 600000,
								description: "How long to wait. 0 returns immediately; omitted waits until completion.",
							}),
						),
					},
					{ additionalProperties: false },
				),
				authorization: {
					owner: "core",
					permission: {
						sideEffect: "read",
						reason: "Reads the result of an already-authorized background subagent",
					},
				},
				presentation: {
					title: (_runtime, args) =>
						`Get result of ${typeof args.agentId === "string" ? args.agentId : "subagent"}`,
				},
				executionMode: "parallel",
				async execute(runtime, call) {
					const entry = runtime.instance.background.findByAgentId(call.args.agentId as string);
					if (!entry)
						throw new SubagentUnknownAgent({ message: `Unknown background agent "${call.args.agentId}"` });
					const timeoutMs = (call.args.timeoutMs as number | undefined) ?? Number.POSITIVE_INFINITY;
					if (entry.status === "running" && timeoutMs > 0) await waitSettled(entry, call, timeoutMs);
					if (entry.status === "running")
						return {
							content: [
								{
									type: "text",
									text: `Background subagent "${entry.title}" (${entry.agentId}) is still running${entry.activity ? ` (current activity: ${entry.activity})` : ""}. Call GetAgentResult again later.`,
								},
							],
							details: { agentId: entry.agentId, title: entry.title, status: "running" },
						};
					entry.notified = true;
					if (entry.status === "error") {
						if (entry.stopped) throw new SubagentRunFailed({ message: `Subagent "${entry.title}" was stopped` });
						throw new SubagentRunFailed({ message: entry.error ?? "Subagent failed" });
					}
					return {
						content: [{ type: "text", text: entry.text ?? "" }],
						details: { agentId: entry.agentId, title: entry.title, status: "complete" },
					};
				},
			},
		],
	});
}

function startBackground(
	instance: SubagentInstance,
	call: CodingExtensionToolExecutionCall,
	title: string,
	task: string,
) {
	instance.active++;
	const agentId = instance.background.nextAgentId();
	const store = instance.background;
	const entry = store.register({ toolCallId: call.toolCallId, agentId, title });
	call.onUpdate?.({ content: [], details: { title, status: "running", agentId } });
	void runChild(call, {
		title,
		task,
		detached: true,
		agentId,
		onActivity: (next) => {
			entry.activity = next;
		},
	})
		.then(
			(text) => store.complete(call.toolCallId, text),
			(error) => store.fail(call.toolCallId, error instanceof Error ? error.message : String(error)),
		)
		.finally(() => {
			instance.active--;
		});
	return {
		content: [
			{
				type: "text" as const,
				text: `Background subagent "${title}" started as ${agentId}. Continue other work; collect its result with GetAgentResult. Completion will also be announced before a later model call.`,
			},
		],
		details: { title, status: "background_running", agentId },
	};
}

async function runChild(
	call: CodingExtensionToolExecutionCall,
	input: {
		readonly title: string;
		readonly task: string;
		readonly detached?: boolean;
		readonly agentId?: string;
		readonly onActivity: (toolName: string) => void;
	},
): Promise<string> {
	const result = await call.runAgent({
		prompt: input.task,
		instructions: SUBAGENT_INSTRUCTIONS,
		excludeTools: SUBAGENT_EXCLUDE_TOOLS,
		onActivity: input.onActivity,
		detached: input.detached === true,
		agentId: input.agentId,
		title: input.title,
	});
	if (result.isErr()) throw new SubagentRunFailed({ message: result.error.message });
	const last = result.value.findLast((message) => message.role === "assistant");
	const text =
		last?.role === "assistant"
			? last.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("")
					.trim()
			: "";
	if (!text)
		throw new SubagentNoFinalText({ message: `Subagent "${input.title}" completed without a final response` });
	return text;
}

async function waitSettled(
	entry: BackgroundAgentEntry,
	call: CodingExtensionToolExecutionCall,
	timeoutMs: number,
): Promise<void> {
	const abort = call.signal;
	if (abort?.aborted) abort.throwIfAborted();
	let onAbort: (() => void) | undefined;
	const aborted = new Promise<void>((_resolve, reject) => {
		if (!abort) return;
		onAbort = () => reject(abort.reason);
		abort.addEventListener("abort", onAbort, { once: true });
	});
	try {
		if (Number.isFinite(timeoutMs)) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timeout = new Promise<void>((resolve) => {
				timer = setTimeout(resolve, timeoutMs);
			});
			try {
				await Promise.race([entry.settled, timeout, aborted]);
			} finally {
				clearTimeout(timer);
			}
		} else if (abort) {
			await Promise.race([entry.settled, aborted]);
		} else {
			await entry.settled;
		}
	} finally {
		if (abort && onAbort) abort.removeEventListener("abort", onAbort);
	}
	if (abort?.aborted) abort.throwIfAborted();
}

function truncate(text: string, maxLength: number): string {
	return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
