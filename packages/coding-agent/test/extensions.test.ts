import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { Result } from "better-result";
import {
	CodingExtensionHostOperationFailed,
	CodingExtensionOperationFailed,
	defineExtension,
	type CodingExtensionTool,
	type JsonObject,
} from "../src/sdk";
import { ToolCatalog } from "../src/runtime/tool-catalog";
import { builtInToolPresentations } from "../src/sdk/tool-presentation";
import { activateExtensions, disposeExtensions, initializeExtensions, prepareExtensions } from "../src/sdk/extensions";

const context = {
	sessionId: "extension-session",
	cwd: "/workspace",
	workspace: { directory: "/workspace", trusted: true },
	permissionMode: "default" as const,
};

function catalogTool(name: string, title: string): CodingExtensionTool {
	return {
		name,
		description: `${name} description`,
		parameters: Type.Object({}),
		authorization: { owner: "core", permission: { sideEffect: "read", reason: `${name} permission` } },
		presentation: { title: () => title },
		execute: async () => ({ content: [{ type: "text", text: name }] }),
	};
}

async function flushCatalogRefresh(): Promise<void> {
	for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

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

	test("resolves raw user and project layers in the Extension without injecting defaults into either source", async () => {
		const observed: unknown[] = [];
		const reads: unknown[] = [];
		const extension = defineExtension({
			id: "layered-configuration-test",
			configuration: {
				scope: "layered" as const,
				layerSchema: Type.Object(
					{ retryLimit: Type.Optional(Type.Integer({ minimum: 0 })), label: Type.Optional(Type.String()) },
					{ additionalProperties: false },
				),
				schema: Type.Object({ retryLimit: Type.Integer({ minimum: 0 }), label: Type.String() }),
				defaultValue: { retryLimit: 3, label: "default" },
				resolve: (layers) => {
					const user = layers.user as { readonly retryLimit?: number; readonly label?: string } | undefined;
					const project = layers.project as { readonly retryLimit?: number; readonly label?: string } | undefined;
					return Result.ok({
						retryLimit: project?.retryLimit ?? user?.retryLimit ?? 3,
						label: project?.label ?? user?.label ?? "default",
					});
				},
			},
			lifecycle: {
				activate: async (extensionContext) => {
					observed.push(extensionContext.configuration.value);
					const update = await extensionContext.configuration.update({ retryLimit: 9, label: "write" });
					if (update.isErr()) observed.push(update.error._tag);
					return Result.ok(undefined);
				},
			},
		});

		const initialized = await initializeExtensions([extension], context, {
			readConfiguration: (input) => {
				reads.push(input);
				return Result.ok<JsonObject>(
					input.scope === "user" ? { retryLimit: 7, label: "user" } : { label: "project" },
				);
			},
		});
		expect(initialized.isOk()).toBe(true);
		if (initialized.isErr()) return;

		expect(observed).toEqual([{ retryLimit: 7, label: "project" }, "coding_extension.configuration_unavailable"]);
		expect(reads).toEqual([
			{ extensionId: "layered-configuration-test", scope: "user", workspace: context.workspace },
			{ extensionId: "layered-configuration-test", scope: "project", workspace: context.workspace },
		]);
		await disposeExtensions(initialized.value);
	});

	test("does not read a project layer for an untrusted workspace", async () => {
		const reads: string[] = [];
		const observed: unknown[] = [];
		const extension = defineExtension({
			id: "untrusted-layered-configuration-test",
			configuration: {
				scope: "layered" as const,
				layerSchema: Type.Object({ value: Type.Optional(Type.String()) }, { additionalProperties: false }),
				schema: Type.Object({ value: Type.String() }),
				defaultValue: { value: "default" },
				resolve: (layers) => Result.ok({ value: (layers.user as { readonly value?: string } | undefined)?.value ?? "default" }),
			},
			lifecycle: { activate: (extensionContext) => {
				observed.push(extensionContext.configuration.value);
				return Result.ok(undefined);
			} },
		});
		const untrusted = { ...context, workspace: { directory: "/workspace", trusted: false } };

		const initialized = await initializeExtensions([extension], untrusted, {
			readConfiguration: (input) => {
				reads.push(input.scope);
				return Result.ok({ value: input.scope });
			},
		});
		expect(initialized.isOk()).toBe(true);
		if (initialized.isErr()) return;

		expect(reads).toEqual(["user"]);
		expect(observed).toEqual([{ value: "user" }]);
		await disposeExtensions(initialized.value);
	});

	test("fails closed for invalid raw layers and failed layered resolvers", async () => {
		const invalidLayer = defineExtension({
			id: "invalid-layered-configuration-test",
			configuration: {
				scope: "layered" as const,
				layerSchema: Type.Object({ enabled: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
				schema: Type.Object({ enabled: Type.Boolean() }),
				defaultValue: { enabled: false },
				resolve: () => Result.ok({ enabled: false }),
			},
		});
		const invalid = await initializeExtensions([invalidLayer], context, {
			readConfiguration: () => Result.ok({ enabled: "yes" }),
		});
		expect(invalid).toMatchObject({ status: "error", error: { _tag: "coding_extension.contract_violation" } });

		const failedResolver = defineExtension({
			id: "failed-layered-configuration-test",
			configuration: {
				scope: "layered" as const,
				layerSchema: Type.Object({}, { additionalProperties: false }),
				schema: Type.Object({ enabled: Type.Boolean() }),
				defaultValue: { enabled: false },
				resolve: () => Result.err(new CodingExtensionOperationFailed({ message: "configuration sources conflict" })),
			},
		});
		const failed = await initializeExtensions([failedResolver], context);
		expect(failed).toMatchObject({
			status: "error",
			error: { _tag: "coding_extension.configuration_resolution_failed" },
		});
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

	test("refreshes a catalog atomically and retains the last valid snapshot after discovery failure", async () => {
		let revision = 0;
		let invalidate: (() => void) | undefined;
		const diagnostics: unknown[] = [];
		const extension = defineExtension({
			id: "dynamic-catalog",
			catalogs: [
				{
					id: "commands",
					discover: () => {
						if (revision === 0) return Result.ok({ tools: [catalogTool("CatalogAlpha", "Alpha")] });
						if (revision === 1) return Result.ok({ tools: [catalogTool("CatalogBeta", "Beta")] });
						if (revision === 2) return Result.ok({ tools: [catalogTool("Read", "Conflicting")] });
						if (revision === 3) {
							return Result.ok({ tools: [{ ...catalogTool("CatalogInvalid", "Invalid"), parameters: {} as never }] });
						}
						return Result.err(new CodingExtensionOperationFailed({ message: "server unavailable" }));
					},
					subscribe: (_runtime, notify) => {
						invalidate = notify;
						return () => {};
					},
				},
			],
		});
		const prepared = prepareExtensions([extension]);
		expect(prepared.isOk()).toBe(true);
		if (prepared.isErr()) return;
		const catalog = new ToolCatalog([]);
		const permissions = new Map();
		const presentations = new Map(builtInToolPresentations());
		const activated = await activateExtensions(prepared.value, context, { reportDiagnostic: (diagnostic) => { diagnostics.push(diagnostic); } }, undefined, {
			permissions,
			toolPresentations: presentations,
			toolCatalog: catalog,
		});
		expect(activated.isOk()).toBe(true);
		if (activated.isErr() || !invalidate) return;

		catalog.search("alpha");
		expect(catalog.toolsForRequest([catalog.searchTool]).map((tool) => tool.name)).toEqual([
			"SearchTools",
			"CatalogAlpha",
		]);
		expect(permissions.has("CatalogAlpha")).toBe(true);
		expect(presentations.get("CatalogAlpha")?.title?.({})).toBe("Alpha");

		revision = 1;
		invalidate();
		await flushCatalogRefresh();
		expect(catalog.toolsForRequest([catalog.searchTool]).map((tool) => tool.name)).toEqual(["SearchTools"]);
		expect(permissions.has("CatalogAlpha")).toBe(false);
		expect(permissions.has("CatalogBeta")).toBe(true);
		expect(presentations.has("CatalogAlpha")).toBe(false);
		expect(presentations.get("CatalogBeta")?.title?.({})).toBe("Beta");

		revision = 2;
		invalidate();
		await flushCatalogRefresh();
		revision = 3;
		invalidate();
		await flushCatalogRefresh();
		revision = 4;
		invalidate();
		await flushCatalogRefresh();
		expect(catalog.search("beta")).toEqual([{ name: "CatalogBeta", description: "CatalogBeta description" }]);
		expect(permissions.has("CatalogBeta")).toBe(true);
		expect(diagnostics).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ code: "coding_extension.capability_conflict" }),
					expect.objectContaining({ code: "coding_extension.contract_violation" }),
					expect.objectContaining({ code: "coding_extension.catalog_discovery_failed" }),
			]),
		);
		await disposeExtensions(prepared.value);
	});

	test("coalesces invalidations and stops catalog watchers before extension deactivation", async () => {
		let discoveries = 0;
		let releaseRefresh: (() => void) | undefined;
		let invalidate: (() => void) | undefined;
		const lifecycle: string[] = [];
		const extension = defineExtension({
			id: "watched-catalog",
			catalogs: [
				{
					id: "updates",
					discover: async () => {
						discoveries += 1;
						if (discoveries === 2) await new Promise<void>((resolve) => { releaseRefresh = resolve; });
						return Result.ok({ tools: [catalogTool(discoveries === 1 ? "CatalogFirst" : "CatalogSecond", "Catalog")] });
					},
					subscribe: (_runtime, notify) => {
						invalidate = notify;
						return () => { lifecycle.push("unsubscribe"); };
					},
				},
			],
			lifecycle: { deactivate: () => { lifecycle.push("deactivate"); } },
		});
		const prepared = prepareExtensions([extension]);
		expect(prepared.isOk()).toBe(true);
		if (prepared.isErr()) return;
		const catalog = new ToolCatalog([]);
		const activated = await activateExtensions(prepared.value, context, undefined, undefined, { toolCatalog: catalog });
		expect(activated.isOk()).toBe(true);
		if (activated.isErr() || !invalidate) return;

		invalidate();
		invalidate();
		invalidate();
		await flushCatalogRefresh();
		expect(discoveries).toBe(2);
		const disposed = await disposeExtensions(prepared.value);
		expect(disposed.isOk()).toBe(true);
		expect(lifecycle).toEqual(["unsubscribe", "deactivate"]);
		releaseRefresh?.();
		await flushCatalogRefresh();
		invalidate();
		await flushCatalogRefresh();
		expect(discoveries).toBe(2);
		expect(catalog.search("catalog")).toEqual([{ name: "CatalogFirst", description: "CatalogFirst description" }]);
	});
});
