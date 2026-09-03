import { afterEach, describe, expect, test } from "bun:test";
import { createTelemetryContext, type TelemetryContentSink, type TelemetrySink } from "@jai/telemetry";
import { Result } from "better-result";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	RuntimeTelemetryConfigurationInvalid,
	RuntimeTelemetryController,
	type RuntimeTelemetrySettingsInput,
} from "../../src/telemetry";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Runtime telemetry controller", () => {
	test("keeps a replaced exporter alive until the previous generation settles", async () => {
		const dataDirectory = await temporaryDataDirectory();
		const database = new DatabaseSync(":memory:");
		const recorded: string[] = [];
		const closed: string[] = [];
		try {
			const controller = await openController({ dataDirectory, recorded, closed, database });
			const first = await controller.save(settingsInput());
			if (first.isErr()) throw first.error;

			const oldRun = controller.context.startSpan({
				name: "jai.run",
				attributes: { operationId: "old-operation", runId: "old-operation" },
			});
			const second = await controller.save(
				settingsInput({
					policyRevision: first.value.policyRevision,
					credentialRevision: first.value.credential.revision,
					publicKey: "pk-second",
					secretKey: "sk-second",
				}),
			);
			if (second.isErr()) throw second.error;

			const oldTurn = controller.context.startSpan({
				name: "jai.turn",
				parent: oldRun,
				attributes: { turnId: "old-turn" },
			});
			oldTurn.setStatus({ kind: "ok" });
			expect(closed).toEqual([]);
			oldRun.setStatus({ kind: "ok" });
			await waitFor(() => closed.includes("pk-first"));

			const newRun = controller.context.startSpan({
				name: "jai.run",
				attributes: { operationId: "new-operation", runId: "new-operation" },
			});
			newRun.setStatus({ kind: "ok" });
			await waitFor(() => recorded.includes("pk-second:new-operation"));
			expect(recorded).toContain("pk-first:old-operation");

			await controller.close();
			expect(closed).toEqual(expect.arrayContaining(["pk-first", "pk-second"]));
		} finally {
			database.close();
		}
	});

	test("keeps content with the telemetry generation that started its span", async () => {
		const dataDirectory = await temporaryDataDirectory();
		const database = new DatabaseSync(":memory:");
		const recorded: string[] = [];
		const contents: string[] = [];
		const closed: string[] = [];
		try {
			const controller = await openController({ dataDirectory, recorded, contents, closed, database });
			const first = await controller.save(settingsInput());
			if (first.isErr()) throw first.error;

			const oldRun = controller.context.startSpan({
				name: "jai.run",
				attributes: { operationId: "old-content", runId: "old-content" },
			});
			expect(oldRun.contentCaptureEnabled).toBe(true);
			oldRun.recordContent({ input: "first-generation-input" });
			const second = await controller.save(
				settingsInput({
					policyRevision: first.value.policyRevision,
					credentialRevision: first.value.credential.revision,
					publicKey: "pk-second",
					secretKey: "sk-second",
				}),
			);
			if (second.isErr()) throw second.error;
			expect(oldRun.contentCaptureEnabled).toBe(true);
			oldRun.recordContent({ output: "first-generation-output" });
			oldRun.setStatus({ kind: "ok" });

			const newRun = controller.context.startSpan({
				name: "jai.run",
				attributes: { operationId: "new-content", runId: "new-content" },
			});
			expect(newRun.contentCaptureEnabled).toBe(true);
			newRun.recordContent({ input: "second-generation-input" });
			newRun.setStatus({ kind: "ok" });
			await waitFor(() => contents.length === 3);

			expect(contents).toEqual([
				"pk-first:first-generation-input",
				"pk-first:first-generation-output",
				"pk-second:second-generation-input",
			]);
			await controller.close();
		} finally {
			database.close();
		}
	});

	test("rejects invalid configuration without replacing the active telemetry generation", async () => {
		const dataDirectory = await temporaryDataDirectory();
		const database = new DatabaseSync(":memory:");
		const recorded: string[] = [];
		const closed: string[] = [];
		try {
			const controller = await openController({ dataDirectory, recorded, closed, database });
			const first = await controller.save(settingsInput());
			if (first.isErr()) throw first.error;
			const rejected = await controller.save(
				settingsInput({
					policyRevision: first.value.policyRevision,
					credentialRevision: first.value.credential.revision,
					endpoint: "not an endpoint",
				}),
			);
			expect(rejected).toMatchObject({ status: "error", error: { _tag: "telemetry.settings_invalid" } });

			const run = controller.context.startSpan({
				name: "jai.run",
				attributes: { operationId: "still-first", runId: "still-first" },
			});
			run.setStatus({ kind: "ok" });
			await waitFor(() => recorded.includes("pk-first:still-first"));
			expect(closed).not.toContain("pk-first");
			await controller.close();
		} finally {
			database.close();
		}
	});

	test("environment telemetry is a full override that does not read local policy or credentials", async () => {
		const dataDirectory = await temporaryDataDirectory();
		await writeFile(join(dataDirectory, "settings.json"), "{");
		const database = new DatabaseSync(":memory:");
		const recorded: string[] = [];
		const closed: string[] = [];
		try {
			const controller = await openController({
				dataDirectory,
				database,
				recorded,
				closed,
				environment: {
					JAI_TELEMETRY_LANGFUSE_PUBLIC_KEY: "pk-environment",
					JAI_TELEMETRY_LANGFUSE_SECRET_KEY: "sk-environment",
					JAI_TELEMETRY_OTLP_ENDPOINT: "https://langfuse.example/api/public/otel",
				},
			});
			const snapshot = await controller.snapshot();
			if (snapshot.isErr()) throw snapshot.error;
			expect(snapshot.value).toEqual({
				credential: { revision: null, configured: false },
				enabled: false,
				environmentOverride: true,
				exporter: "langfuse-otlp",
				policyRevision: null,
			});
			const locked = await controller.save(settingsInput());
			expect(locked).toMatchObject({ status: "error", error: { _tag: "telemetry.settings_locked" } });
			if (locked.isErr()) expect(locked.error.message).not.toContain("pk-environment");
			await controller.close();
		} finally {
			database.close();
		}
	});

	test("starts with telemetry disabled when durable telemetry policy is invalid", async () => {
		const dataDirectory = await temporaryDataDirectory();
		await writeFile(
			join(dataDirectory, "settings.json"),
			JSON.stringify({
				$schema: "https://jai.dev/schemas/coding-agent-sdk-v1.json",
				schemaVersion: 1,
				telemetry: {
					enabled: true,
					exporter: "langfuse-otlp",
					endpoint: "not an HTTP URL",
				},
			}),
		);
		const database = new DatabaseSync(":memory:");
		const recorded: string[] = [];
		const closed: string[] = [];
		try {
			const controller = await openController({ dataDirectory, database, recorded, closed });
			const snapshot = await controller.snapshot();
			if (snapshot.isErr()) throw snapshot.error;
			expect(snapshot.value).toMatchObject({
				credential: { configured: false, revision: null },
				enabled: false,
				configurationError: "Telemetry endpoint must be an HTTP URL",
			});

			const run = controller.context.startSpan({
				name: "jai.run",
				attributes: { operationId: "telemetry-disabled", runId: "telemetry-disabled" },
			});
			run.setStatus({ kind: "ok" });
			expect(recorded).toEqual([]);
			await controller.close();
		} finally {
			database.close();
		}
	});

	test("keeps the Host telemetry no-op when environment telemetry is incomplete", async () => {
		const dataDirectory = await temporaryDataDirectory();
		const database = new DatabaseSync(":memory:");
		const recorded: string[] = [];
		const closed: string[] = [];
		try {
			const controller = await openController({
				dataDirectory,
				database,
				recorded,
				closed,
				environment: { JAI_TELEMETRY_OTLP_ENDPOINT: "not an endpoint" },
			});
			const snapshot = await controller.snapshot();
			if (snapshot.isErr()) throw snapshot.error;
			expect(snapshot.value).toMatchObject({
				environmentOverride: true,
				configurationError: "Telemetry endpoint must be valid",
			});

			const run = controller.context.startSpan({
				name: "jai.run",
				attributes: { operationId: "environment-disabled", runId: "environment-disabled" },
			});
			run.setStatus({ kind: "ok" });
			expect(recorded).toEqual([]);
			await controller.close();
		} finally {
			database.close();
		}
	});
});

async function openController(input: {
	readonly dataDirectory: string;
	readonly database: DatabaseSync;
	readonly recorded: string[];
	readonly contents?: string[];
	readonly closed: string[];
	readonly environment?: Readonly<Record<string, string | undefined>>;
}): Promise<RuntimeTelemetryController> {
	const controller = await RuntimeTelemetryController.open({
		dataDirectory: input.dataDirectory,
		database: input.database,
		environment: input.environment ?? {},
		errorOutput: { write() {} },
		resolve: ({ environment }) => {
			const publicKey = environment.JAI_TELEMETRY_LANGFUSE_PUBLIC_KEY;
			if (environment.JAI_TELEMETRY_OTLP_ENDPOINT === "not an endpoint") {
				return Result.err(
					new RuntimeTelemetryConfigurationInvalid({
						message: "Telemetry endpoint must be valid",
					}),
				);
			}
			if (!publicKey) return Result.ok({ context: createTelemetryContext() });
			const sink: TelemetrySink = {
				record(record) {
					input.recorded.push(`${publicKey}:${record.attributes.operationId}`);
				},
			};
			const contentSink: TelemetryContentSink | undefined = input.contents
				? {
						recordContent(record): void {
							if (record.content.input !== undefined) input.contents?.push(`${publicKey}:${record.content.input}`);
							if (record.content.output !== undefined) input.contents?.push(`${publicKey}:${record.content.output}`);
						},
					}
				: undefined;
			return Result.ok({
				context: createTelemetryContext({ ...(contentSink ? { contentSink } : {}), sinks: [sink] }),
				close: async () => {
					input.closed.push(publicKey);
				},
			});
		},
	});
	if (controller.isErr()) throw controller.error;
	return controller.value;
}

function settingsInput(
	overrides: Partial<RuntimeTelemetrySettingsInput> = {},
): RuntimeTelemetrySettingsInput {
	return {
		credentialRevision: null,
		enabled: true,
		endpoint: "https://langfuse.example/api/public/otel",
		exporter: "langfuse-otlp",
		policyRevision: null,
		publicKey: "pk-first",
		secretKey: "sk-first",
		...overrides,
	};
}

async function temporaryDataDirectory(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "jai-runtime-telemetry-controller-"));
	roots.push(root);
	return root;
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for telemetry state");
		await new Promise<void>((resolve) => setTimeout(resolve, 5));
	}
}
