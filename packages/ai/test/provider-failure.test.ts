import { describe, expect, test } from "bun:test";
import { providerFailureKind } from "../src";

describe("providerFailureKind", () => {
	test.each([
		[{ message: "invalid x-api-key", status: 401 }, "error", "auth_failed"],
		[{ message: "forbidden", status: 403 }, "error", "auth_failed"],
		[{ message: "slow down", status: 429 }, "error", "rate_limited"],
		[
			{ message: "maximum context length", status: 400, code: "context_length_exceeded" },
			"error",
			"context_overflow",
		],
		[undefined, "contextOverflow", "context_overflow"],
		[{ message: "bad request", status: 400 }, "error", "invalid_request"],
		[{ message: "internal", status: 500 }, "error", "unavailable"],
		[{ message: "overloaded", status: 529, type: "overloaded_error" }, "error", "unavailable"],
		[
			{
				message: "Claude Code: Failed to authenticate. API Error: 401 OAuth access token is invalid.",
				status: 502,
			},
			"error",
			"auth_failed",
		],
		[{ message: "Connection error." }, "error", "network"],
		[{ message: "connect failed", code: "ECONNREFUSED" }, "error", "network"],
		[{ message: "something odd" }, "error", "unknown"],
	] as const)("%j with %s is %s", (error, stopReason, kind) => {
		expect(providerFailureKind(error, stopReason)).toBe(kind);
	});
});
