import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UserTelemetryPolicyStore } from "../../src/telemetry";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("User telemetry policy", () => {
	test("writes the telemetry subtree without overwriting shared permission settings", async () => {
		const dataDirectory = await temporaryDataDirectory();
		await mkdir(dataDirectory, { recursive: true });
		await writeFile(
			join(dataDirectory, "settings.json"),
			`${JSON.stringify({
				$schema: "https://jai.dev/schemas/coding-agent-sdk-v1.json",
				schemaVersion: 1,
				permission: {},
			})}\n`,
		);
		const policies = new UserTelemetryPolicyStore({ dataDirectory });
		try {
			const initial = await policies.snapshot();
			if (initial.isErr()) throw initial.error;
			const initialRevision = initial.value.revision;
			expect(typeof initialRevision).toBe("string");
			expect(initial.value.policy).toEqual({ enabled: false, exporter: "langfuse-otlp" });
			expect(initial.value.environmentOverride).toBe(false);

			const saved = await policies.write({
				revision: initialRevision,
				policy: {
					enabled: true,
					exporter: "langfuse-otlp",
					endpoint: "https://cloud.langfuse.com/api/public/otel",
				},
			});
			if (saved.isErr()) throw saved.error;
			expect(saved.value.policy).toEqual({
				enabled: true,
				exporter: "langfuse-otlp",
				endpoint: "https://cloud.langfuse.com/api/public/otel",
			});

			const persisted = JSON.parse(await readFile(join(dataDirectory, "settings.json"), "utf8"));
			expect(persisted).toMatchObject({
				permission: {},
				telemetry: saved.value.policy,
			});
		} finally {
			policies.close();
		}
	});

	test("reports any telemetry environment variable as a complete Host override", async () => {
		const dataDirectory = await temporaryDataDirectory();
		const policies = new UserTelemetryPolicyStore({
			dataDirectory,
			environment: { JAI_TELEMETRY_LANGFUSE_PUBLIC_KEY: "pk-server-only" },
		});
		try {
			const snapshot = await policies.snapshot();
			if (snapshot.isErr()) throw snapshot.error;
			expect(snapshot.value.environmentOverride).toBe(true);
		} finally {
			policies.close();
		}
	});

	test("keeps an invalid telemetry policy repairable without invalidating the shared Agent configuration", async () => {
		const dataDirectory = await temporaryDataDirectory();
		await mkdir(dataDirectory, { recursive: true });
		await writeFile(
			join(dataDirectory, "settings.json"),
			`${JSON.stringify({
				$schema: "https://jai.dev/schemas/coding-agent-sdk-v1.json",
				schemaVersion: 1,
				telemetry: "invalid telemetry policy",
			})}\n`,
		);
		const policies = new UserTelemetryPolicyStore({ dataDirectory });
		try {
			const invalid = await policies.snapshot();
			if (invalid.isErr()) throw invalid.error;
			expect(invalid.value).toMatchObject({
				policy: { enabled: false, exporter: "langfuse-otlp" },
				configurationError: "Telemetry policy must be an object",
			});
			expect(typeof invalid.value.revision).toBe("string");

			const repaired = await policies.write({
				revision: invalid.value.revision,
				policy: {
					enabled: false,
					exporter: "langfuse-otlp",
				},
			});
			if (repaired.isErr()) throw repaired.error;
			expect(repaired.value.configurationError).toBeUndefined();
			expect(repaired.value.policy).toEqual({ enabled: false, exporter: "langfuse-otlp" });
		} finally {
			policies.close();
		}
	});
});

async function temporaryDataDirectory(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "jai-user-telemetry-policy-"));
	roots.push(root);
	return join(root, ".jai");
}
