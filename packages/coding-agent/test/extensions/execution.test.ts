import { expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import {
	initializeExtensions,
	extensionTools,
	disposeExtensions,
	activateExtensions,
	prepareExtensions,
} from "../../src/sdk/extensions";
import type { CodingExtensionToolExecutionCall } from "../../src/sdk";

test("tool completion cancels and joins unawaited executions and revokes its saved capability", async () => {
	let saved: CodingExtensionToolExecutionCall | undefined;
	let running = false;
	let stopped = false;
	let child: Promise<unknown> | undefined;
	const initialized = prepareExtensions([
		{
			id: "execution-owner",
			tools: [
				{
					name: "Delegate",
					description: "exercise call lifetime",
					parameters: Type.Object({}),
					authorization: { owner: "extension" },
					execute(_runtime, call) {
						saved = call;
						child = call.runAgent({ prompt: "run", instructions: "only run" });
						return { content: [{ type: "text", text: "returned before child" }] };
					},
				},
			],
		},
	]);
	if (initialized.isErr()) throw initialized.error;
	const activated = await activateExtensions(
		initialized.value,
		{
			sessionId: "test",
			cwd: process.cwd(),
			workspace: { directory: process.cwd(), trusted: false },
			permissionMode: "default",
		},
		undefined,
		undefined,
		{
			runAgent: async (input) => {
				running = true;
				await new Promise<void>((resolve) =>
					input.signal.addEventListener(
						"abort",
						() => {
							stopped = true;
							resolve();
						},
						{ once: true },
					),
				);
				running = false;
				return [];
			},
		},
	);
	if (activated.isErr()) throw activated.error;
	try {
		const tool = extensionTools(initialized.value)[0]!;
		await tool.execute("tool", {});
		expect(stopped).toBe(true);
		expect(running).toBe(false);
		expect(await child).toMatchObject({ status: "error", error: { code: "coding_execution.aborted" } });
		expect(await saved!.runAgent({ prompt: "late", instructions: "late" })).toMatchObject({
			status: "error",
			error: { code: "coding_execution.aborted" },
		});
	} finally {
		await disposeExtensions(initialized.value);
	}
});

test("a host without execution services reports unavailable, and unknown defects remain thrown", async () => {
	const initialized = await initializeExtensions(
		[
			{
				id: "caller",
				tools: [
					{
						name: "Delegate",
						description: "call execution",
						parameters: Type.Object({}),
						authorization: { owner: "extension" },
						async execute(_runtime, call) {
							const result = await call.runAgent({ prompt: "task", instructions: "task" });
							return { content: [{ type: "text", text: JSON.stringify(result) }] };
						},
					},
				],
			},
		],
		{
			sessionId: "test",
			cwd: process.cwd(),
			workspace: { directory: process.cwd(), trusted: false },
			permissionMode: "default",
		},
	);
	if (initialized.isErr()) throw initialized.error;
	try {
		const tool = extensionTools(initialized.value)[0]!;
		expect(JSON.stringify(await tool.execute("missing", {}))).toContain("coding_execution.unavailable");
		const failure = new Error("programming defect");
		initialized.value[0]!.runAgent = async () => {
			throw failure;
		};
		await expect(tool.execute("defect", {})).rejects.toBe(failure);
	} finally {
		await disposeExtensions(initialized.value);
	}
});
