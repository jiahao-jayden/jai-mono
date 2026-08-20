import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { defineExtension } from "../src/sdk";
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
			initialize: async (extensionContext) => {
				observed.push(extensionContext.configuration.value);
				observed.push(await extensionContext.configuration.update({ mode: "updated" }));
				return {};
			},
		});

		const initialized = await initializeExtensions([extension], context, {
			readConfiguration: () => ({ mode: "loaded" }),
			writeConfiguration: ({ value }) => {
				writes.push(value);
				return value;
			},
		});

		expect(observed).toEqual([{ mode: "loaded" }, { mode: "updated" }]);
		expect(writes).toEqual([{ mode: "updated" }]);
		await disposeExtensions(initialized);
	});

	test("fails closed when the host supplies invalid Extension configuration", async () => {
		const extension = defineExtension({
			id: "invalid-configuration-test",
			configuration: {
				scope: "user",
				schema: Type.Object({ enabled: Type.Boolean() }),
				defaultValue: { enabled: false },
			},
			initialize: async () => ({}),
		});

		await expect(
			initializeExtensions([extension], context, { readConfiguration: () => ({ enabled: "yes" }) }),
		).rejects.toMatchObject({ code: "coding_sdk.extension_configuration_invalid" });
	});

	test("fails closed when an Extension requests persistent approval without persistent configuration", async () => {
		const extension = defineExtension({
			id: "persistent-approval-test",
			configuration: {
				scope: "user",
				schema: Type.Object({ enabled: Type.Boolean() }),
				defaultValue: { enabled: false },
			},
			initialize: async () => ({
				hooks: {
					sessionStart: async (extensionContext) => {
						await extensionContext.requestApproval({
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
					},
				},
			}),
		});

		await expect(
			initializeExtensions([extension], context, { requestApproval: () => "allow" }),
		).rejects.toMatchObject({ code: "coding_sdk.extension_persistent_approval_unavailable" });
	});

	test("rejects duplicate Extension IDs before a runtime is created", async () => {
		const first = defineExtension({ id: "duplicate", initialize: async () => ({}) });
		const second = defineExtension({ id: "duplicate", initialize: async () => ({}) });

		await expect(initializeExtensions([first, second], context)).rejects.toMatchObject({
			code: "coding_sdk.extension_capability_conflict",
		});
	});
});
