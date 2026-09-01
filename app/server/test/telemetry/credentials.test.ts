import { describe, expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { SqliteLangfuseTelemetryCredentials } from "../../src/telemetry";

describe("Langfuse telemetry credentials", () => {
	test("replaces and clears Server-only keys while projecting only masks", () => {
		const database = new DatabaseSync(":memory:");
		try {
			const credentials = new SqliteLangfuseTelemetryCredentials(database);
			const initial = credentials.snapshot();
			if (initial.isErr()) throw initial.error;
			expect(initial.value).toEqual({ revision: null, configured: false });

			const saved = credentials.replace({
				revision: initial.value.revision,
				publicKey: "pk-langfuse-1234",
				secretKey: "sk-langfuse-5678",
			});
			if (saved.isErr()) throw saved.error;
			expect(saved.value).toMatchObject({
				configured: true,
				publicKeyMask: "•••• 1234",
				secretKeyMask: "•••• 5678",
			});
			expect(JSON.stringify(saved.value)).not.toContain("pk-langfuse-1234");
			expect(JSON.stringify(saved.value)).not.toContain("sk-langfuse-5678");

			const internal = credentials.readForExporter();
			if (internal.isErr()) throw internal.error;
			expect(internal.value).toEqual({
				publicKey: "pk-langfuse-1234",
				secretKey: "sk-langfuse-5678",
			});

			const stale = credentials.clear(initial.value.revision);
			expect(stale).toMatchObject({
				status: "error",
				error: { _tag: "telemetry.credentials_write_conflict" },
			});

			const cleared = credentials.clear(saved.value.revision);
			if (cleared.isErr()) throw cleared.error;
			expect(cleared.value).toEqual({ revision: null, configured: false });
		} finally {
			database.close();
		}
	});

	test("rejects incomplete credential replacement without echoing key material", () => {
		const database = new DatabaseSync(":memory:");
		try {
			const credentials = new SqliteLangfuseTelemetryCredentials(database);
			const result = credentials.replace({
				revision: null,
				publicKey: "pk-do-not-echo",
				secretKey: "   ",
			});
			expect(result).toMatchObject({
				status: "error",
				error: { _tag: "telemetry.credentials_invalid" },
			});
			if (result.isErr()) expect(result.error.message).not.toContain("pk-do-not-echo");
		} finally {
			database.close();
		}
	});
});
