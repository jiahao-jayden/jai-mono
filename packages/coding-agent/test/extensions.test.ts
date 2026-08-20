import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { Result } from "better-result";
import { CodingExtensionHostOperationFailed, defineExtension } from "../src/sdk";
import { disposeExtensions, initializeExtensions } from "../src/sdk/extensions";

const context = {
	sessionId: "extension-session",
	cwd: "/workspace",
	permissionMode: "default" as const,
};

describe("Extension Runtime", () => {
	test("loads validated configuration and persists validated updates through the host", async () => {
		const observed: unknown[] = [];
		const writes: unknown[] = [];
		const extension = defineExtension({
			id: "configuration-test",
			configuration: {
				scope: "user",
				schema: Type.Object({ mode: Type.Union([Type.Literal("loaded"), Type.Literal("updated")]) }),
				defaultValue: { mode: "loaded" as "loaded" | "updated" },
			},
			lifecycle: {
				activate: async (extensionContext) => {
					observed.push(extensionContext.configuration.value);
					const updated = await extensionContext.configuration.update({ mode: "updated" });
					if (updated.isErr()) throw updated.error;
					observed.push(updated.value);
					return Result.ok(undefined);
				},
			},
		});

		const initialized = await initializeExtensions([extension], context, {
			readConfiguration: () => Result.ok({ mode: "loaded" }),
			writeConfiguration: ({ value }) => {
				writes.push(value);
				return Result.ok(value);
			},
		});
		expect(initialized.isOk()).toBe(true);
		if (initialized.isErr()) return;

		expect(observed).toEqual([{ mode: "loaded" }, { mode: "updated" }]);
		expect(writes).toEqual([{ mode: "updated" }]);
		await disposeExtensions(initialized.value);
	});

	test("returns host configuration write failures to the Extension", async () => {
		const observed: string[] = [];
		const extension = defineExtension({
			id: "host-configuration-failure",
			configuration: {
				scope: "user",
				schema: Type.Object({ enabled: Type.Boolean() }),
				defaultValue: { enabled: false },
			},
			lifecycle: {
				activate: async (extensionContext) => {
					const updated = await extensionContext.configuration.update({ enabled: true });
					if (updated.isErr()) observed.push(updated.error._tag);
					return Result.ok(undefined);
				},
			},
		});

		const initialized = await initializeExtensions([extension], context, {
			writeConfiguration: () =>
				Result.err(
					new CodingExtensionHostOperationFailed({
						operation: "configuration_write",
						message: "host storage offline",
					}),
				),
		});

		expect(initialized.isOk()).toBe(true);
		expect(observed).toEqual(["coding_extension.host_operation_failed"]);
		if (initialized.isOk()) await disposeExtensions(initialized.value);
	});

	test("fails closed when the host supplies invalid Extension configuration", async () => {
		const extension = defineExtension({
			id: "invalid-configuration-test",
			configuration: {
				scope: "user",
				schema: Type.Object({ enabled: Type.Boolean() }),
				defaultValue: { enabled: false },
			},
		});

		const initialized = await initializeExtensions([extension], context, {
			readConfiguration: () => Result.ok({ enabled: "yes" }),
		});
		expect(initialized).toMatchObject({ status: "error", error: { _tag: "coding_extension.contract_violation" } });
	});

	test("fails closed when an Extension requests persistent approval without persistent configuration", async () => {
		const approvals: string[] = [];
		const extension = defineExtension({
			id: "persistent-approval-test",
			configuration: {
				scope: "user",
				schema: Type.Object({ enabled: Type.Boolean() }),
				defaultValue: { enabled: false },
			},
			lifecycle: {
				activate: async (extensionContext) => {
					const decision = await extensionContext.requestApproval({
						requestId: "persistent-approval-request",
						extensionId: "persistent-approval-test",
						operationId: "operation",
						sessionId: "extension-session",
						toolCallId: "tool-call",
						reason: "Persist approval",
						sideEffect: "write",
						dataSensitivity: "normal",
						presentation: { title: "Persist approval" },
					});
					if (decision.isErr()) approvals.push(decision.error._tag);
					return Result.ok(undefined);
				},
			},
		});

		const initialized = await initializeExtensions([extension], context, { requestApproval: () => Result.ok("allow") });
		expect(initialized.isOk()).toBe(true);
		expect(approvals).toEqual(["coding_extension.persistent_approval_unavailable"]);
		if (initialized.isOk()) await disposeExtensions(initialized.value);
	});

	test("rejects duplicate Extension IDs before a runtime is created", async () => {
		const first = defineExtension({ id: "duplicate" });
		const second = defineExtension({ id: "duplicate" });

		const initialized = await initializeExtensions([first, second], context);
		expect(initialized).toMatchObject({ status: "error", error: { _tag: "coding_extension.capability_conflict" } });
	});
});
