import { describe, expect, test } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { TaggedError } from "better-result";
import { projectDesktopRpcError } from "../electron/rpc/error";
import { desktopFailureSchema } from "../shared/desktop-rpc";

class WorkspaceRequired extends TaggedError("desktop_agent.workspace_required")<{
	readonly message: string;
	readonly secret: string;
}> {}

describe("projectDesktopRpcError", () => {
	test("classifies known tags through the code table without leaking message, cause or data", () => {
		const response = projectDesktopRpcError(
			new WorkspaceRequired({ message: "No access to /Users/me/secret-project", secret: "sk-live-secret" }),
		);

		expect(response).toEqual({
			status: "error",
			error: {
				_tag: "desktop_agent.workspace_required",
				message: "Desktop request failed.",
				failure: { code: "session.workspace_required", retryable: false, action: "choose_project" },
			},
		});
		const serialized = JSON.stringify(response);
		expect(serialized).not.toContain("secret");
		expect(serialized).not.toContain("stack");
		expect(serialized).not.toContain("cause");
	});

	test("maps the Runtime Host retry and credential tags to their Desktop codes", () => {
		class RetryUnavailable extends TaggedError("desktop_agent.retry_unavailable")<{ readonly message: string }> {}
		class CredentialRequired extends TaggedError("desktop_provider_config.credential_required")<{
			readonly message: string;
		}> {}
		class Terminal extends TaggedError("desktop_terminal.spawn_failed")<{ readonly message: string }> {}

		expect(projectDesktopRpcError(new RetryUnavailable({ message: "x" })).error.failure).toEqual({
			code: "runtime.retry_unavailable",
			retryable: false,
		});
		expect(projectDesktopRpcError(new CredentialRequired({ message: "x" })).error.failure).toEqual({
			code: "provider.credential_required",
			retryable: false,
			action: "open_provider_settings",
		});
		expect(projectDesktopRpcError(new Terminal({ message: "x" })).error.failure).toEqual({
			code: "request.failed",
			retryable: true,
		});
	});

	test("unclassified tags and non-tagged errors project as unknown", () => {
		class Unlisted extends TaggedError("desktop_future.unlisted")<{ readonly message: string }> {}
		class PrototypeKey extends TaggedError("constructor")<{ readonly message: string }> {}
		const raw = projectDesktopRpcError(new Error("Authorization: Bearer secret-token"));

		expect(raw).toEqual({
			status: "error",
			error: { _tag: "error.unknown", message: "Desktop request failed.", failure: { code: "unknown", retryable: false } },
		});
		expect(JSON.stringify(raw)).not.toContain("secret-token");
		expect(projectDesktopRpcError(new Unlisted({ message: "x" })).error.failure).toEqual({
			code: "unknown",
			retryable: false,
		});
		expect(projectDesktopRpcError(new PrototypeKey({ message: "x" })).error.failure).toEqual({
			code: "unknown",
			retryable: false,
		});
		expect(Value.Check(desktopFailureSchema, raw.error.failure)).toBe(true);
	});
});
