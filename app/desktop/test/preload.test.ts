import { describe, expect, test } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { desktopAgentEventEnvelopeSchema } from "../shared/desktop-rpc";

// Preload forwards an agent event only when this schema accepts it; importing preload itself needs a
// process-wide `electron` module mock, which bun cannot undo for the other test files.
const accepts = (event: unknown) =>
	Value.Check(desktopAgentEventEnvelopeSchema, { sessionId: "session-1", seq: 1, event });

describe("preload agent event validation", () => {
	test("rejects a status event whose failure is not a Desktop failure DTO", () => {
		expect(accepts({ type: "status", status: "idle", stopReason: "error", failure: { code: "provider.auth_failed" } })).toBe(false);
		expect(accepts({ type: "status", status: "idle", failure: { code: "unknown", retryable: false, stack: "at x()" } })).toBe(false);
		expect(accepts({ type: "status", status: "idle", failure: { code: "provider.brand_new", retryable: false } })).toBe(false);
		expect(accepts({ type: "status", status: "idle", failure: { code: "unknown", retryable: false, detail: "x".repeat(2_001) } })).toBe(false);
		expect(accepts({ type: "status", status: "idle", failure: "Provider rejected Bearer sk-live" })).toBe(false);
	});

	test("accepts valid status events and leaves other event types to their projections", () => {
		expect(
			accepts({
				type: "status",
				status: "idle",
				stopReason: "error",
				operationId: "op-1",
				failure: { code: "provider.rate_limited", retryable: true, action: "retry", detail: "429" },
			}),
		).toBe(true);
		expect(accepts({ type: "status", status: "running", stopReason: undefined, failure: undefined })).toBe(true);
		expect(accepts({ type: "usage_changed", usage: { inputTokens: 1 } })).toBe(true);
		expect(accepts({ type: "connection_status", status: undefined })).toBe(true);
	});
});
