import { expect, test } from "bun:test";
import { InMemorySessionStore } from "@jai/agent";
import { createCodingAgent, type CodingAgentEvent } from "@jai/coding-agent";
import { createTodoExtension, todosFromExtensionState } from "../../src/todo";
import { assistant, assistantToolCall, createInput, temporaryDirectory } from "../sdk-fixture";

test("Todo installs explicitly, persists before success, restores context and clears without mutating snapshots", async () => {
	const root = await temporaryDirectory();
	const store = new InMemorySessionStore();
	const requests: unknown[] = [];
	const items = [{ id: "inspect", content: "  Inspect storage  ", status: "in_progress" }];
	const input = createInput(
		root,
		[
			assistantToolCall("UpdateTodos", "todo-1", { todos: items }),
			assistant("done"),
			assistant("restored"),
			assistantToolCall("UpdateTodos", "todo-2", { todos: [] }),
			assistant("cleared"),
			assistant("no extension"),
		],
		requests,
	);
	const installed = await createCodingAgent({
		...input,
		session: { kind: "new", id: "todo", store },
		extensions: [createTodoExtension()],
	});
	expect(installed.isOk()).toBe(true);
	if (installed.isErr()) throw installed.error;
	const persisted: unknown[] = [];
	installed.value.subscribe(async (event) => {
		if (event.type === "tool_execution_end" && !event.isError) persisted.push(await store.load("todo"));
	});
	try {
		expect((await installed.value.prompt("plan")).isOk()).toBe(true);
		expect(JSON.stringify(persisted)).toContain('"jai.todo"');
		expect(JSON.stringify(requests[0])).toContain("UpdateTodos");
		expect(JSON.stringify(requests[1])).toContain("Current session Todo state");
		const projected = todosFromExtensionState(installed.value.state.extensions);
		expect(projected?.items).toEqual([{ id: "inspect", content: "Inspect storage", status: "in_progress" }]);
		projected!.items.length = 0;
		expect(todosFromExtensionState(installed.value.state.extensions)?.items).toHaveLength(1);
	} finally {
		await installed.value.close();
	}
	const resumed = await createCodingAgent({
		...input,
		session: { kind: "resume", id: "todo", store },
		extensions: [createTodoExtension()],
	});
	if (resumed.isErr()) throw resumed.error;
	try {
		expect((await resumed.value.prompt("continue")).isOk()).toBe(true);
		expect(JSON.stringify(requests[2])).toContain("Inspect storage");
		expect((await resumed.value.prompt("clear")).isOk()).toBe(true);
		expect(todosFromExtensionState(resumed.value.state.extensions)?.items).toEqual([]);
	} finally {
		await resumed.value.close();
	}
	const absent = await createCodingAgent(input);
	if (absent.isErr()) throw absent.error;
	try {
		await absent.value.prompt("hello");
		expect(JSON.stringify(requests.at(-1))).not.toContain("UpdateTodos");
		expect(JSON.stringify(requests.at(-1))).not.toContain("Current session Todo state");
	} finally {
		await absent.value.close();
	}
});

test("Todo rejects invalid lists without writing state", async () => {
	const root = await temporaryDirectory();
	const invalid = [
		[
			{ id: "x", content: "a", status: "pending" },
			{ id: "x", content: "b", status: "completed" },
		],
		[
			{ id: "x", content: "a", status: "in_progress" },
			{ id: "y", content: "b", status: "in_progress" },
		],
		[{ id: "x", content: "   ", status: "pending" }],
	];
	const created = await createCodingAgent({
		...createInput(
			root,
			invalid.flatMap((todos, i) => [
				assistantToolCall("UpdateTodos", `bad-${i}`, { todos }),
				assistant("rejected"),
			]),
		),
		extensions: [createTodoExtension()],
	});
	if (created.isErr()) throw created.error;
	const results: CodingAgentEvent[] = [];
	created.value.subscribe((event) => {
		if (event.type === "tool_execution_end") results.push(event);
	});
	try {
		for (const _ of invalid) await created.value.prompt("invalid plan");
		expect(results).toHaveLength(3);
		for (const result of results) expect(result).toMatchObject({ isError: true });
		expect(todosFromExtensionState(created.value.state.extensions)).toBeUndefined();
	} finally {
		await created.value.close();
	}
});

test("Todo state write failure cannot publish success", async () => {
	const root = await temporaryDirectory();
	const store = new InMemorySessionStore();
	const append = store.append.bind(store);
	store.append = async (...args) => {
		if (args[1].type === "app_state") throw new Error("simulated storage failure");
		return append(...args);
	};
	const created = await createCodingAgent({
		...createInput(root, [
			assistantToolCall("UpdateTodos", "write-fail", { todos: [{ id: "x", content: "save", status: "pending" }] }),
			assistant("failed"),
		]),
		session: { kind: "new", id: "failure", store },
		extensions: [createTodoExtension()],
	});
	if (created.isErr()) throw created.error;
	const results: CodingAgentEvent[] = [];
	created.value.subscribe((event) => {
		if (event.type === "tool_execution_end") results.push(event);
	});
	try {
		await created.value.prompt("save plan");
		expect(results).toEqual([expect.objectContaining({ isError: true })]);
		expect(todosFromExtensionState(created.value.state.extensions)).toBeUndefined();
	} finally {
		await created.value.close();
	}
});
