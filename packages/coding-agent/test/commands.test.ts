import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { CodingCommandRegistry } from "../src/commands";

describe("CodingCommandRegistry", () => {
	test("accepts the extension-defined Skill command subtype", () => {
		const registry = new CodingCommandRegistry({ sessionId: "session", cwd: "/workspace" });
		const registered = registry.register("third-party", {
			name: "skill:review",
			description: "Attempt to shadow a Skill command",
			kind: "skill",
			handler: () => Result.ok({ kind: "handled" }),
		});

		expect(registered).toMatchObject({ status: "ok" });
		if (registered.isErr()) return;
		expect(registry.list()).toEqual([
			expect.objectContaining({ name: "skill:review", commandKind: "skill" }),
		]);
	});

	test("keeps duplicate invocations deterministic and preserves the core-owned file subtype in metadata", async () => {
		const commands = new CodingCommandRegistry({ sessionId: "command-session", cwd: "/workspace" });
		for (const extensionId of ["first-extension", "second-extension"]) {
			const registered = commands.register(extensionId, {
				name: "review",
				description: `Review from ${extensionId}`,
				handler: () => Result.ok({ kind: "handled" }),
			});
			expect(registered.isOk()).toBe(true);
		}
		const registeredFile = commands.register("skills-extension", {
			name: "template",
			description: "Expand a file prompt template",
			kind: "file",
			handler: (args) => Result.ok({ kind: "prompt", prompt: `Expand ${args}` }),
		});
		expect(registeredFile.isOk()).toBe(true);

		expect(commands.list()).toEqual([
			expect.objectContaining({ name: "review:1", commandKind: "extension" }),
			expect.objectContaining({ name: "review:2", commandKind: "extension" }),
			expect.objectContaining({ name: "template", commandKind: "file" }),
		]);
		expect(await commands.dispatch("/missing keep this text")).toEqual(Result.ok(undefined));

		const dispatched = await commands.dispatch("/template preserve args");
		expect(dispatched).toMatchObject({
			status: "ok",
			value: {
				kind: "prompt",
				invocation: { name: "template", kind: "command", commandKind: "file" },
				input: {
					role: "user",
					metadata: {
						slashInvocation: { name: "template", kind: "command", commandKind: "file" },
					},
				},
			},
		});
		expect(commands.promptContext()).toBe("Expand preserve args");
		commands.clearPromptContext();
		expect(commands.promptContext()).toBeUndefined();
	});

	test("removes only the command owned by one registration", () => {
		const commands = new CodingCommandRegistry({ sessionId: "command-session", cwd: "/workspace" });
		const first = commands.register("first-extension", {
			name: "review",
			description: "First review command",
			handler: () => Result.ok({ kind: "handled" }),
		});
		const second = commands.register("second-extension", {
			name: "review",
			description: "Second review command",
			handler: () => Result.ok({ kind: "handled" }),
		});
		expect(first.isOk()).toBe(true);
		expect(second.isOk()).toBe(true);
		if (first.isErr() || second.isErr()) return;

		first.value.unregister();

		expect(commands.list()).toEqual([expect.objectContaining({ name: "review", description: "Second review command" })]);
	});
});
