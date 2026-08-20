import { describe, expect, test } from "bun:test";
import { TaggedError } from "better-result";
import { projectDesktopRpcError } from "../electron/rpc/error";

class AgentCreationFailed extends TaggedError("desktop_agent.creation_failed")<{
	readonly message: string;
	readonly reason: "provider_configuration_invalid";
	readonly secret: string;
}> {}

describe("projectDesktopRpcError", () => {
	test("only projects the safe Agent creation reason", () => {
		const response = projectDesktopRpcError(
			new AgentCreationFailed({
				message: "Provider rejected Authorization: Bearer secret-token",
				reason: "provider_configuration_invalid",
				secret: "secret-token",
			}),
		);

		expect(response).toEqual({
			status: "error",
			error: {
				_tag: "desktop_agent.creation_failed",
				message: "Desktop request failed.",
				reason: "provider_configuration_invalid",
			},
		});
		expect(JSON.stringify(response)).not.toContain("secret-token");
	});

	test("unknown failures use the same safe envelope", () => {
		const response = projectDesktopRpcError(new Error("Authorization: Bearer secret-token"));
		expect(response).toEqual({
			status: "error",
			error: { _tag: "error.unknown", message: "Desktop request failed." },
		});
	});
});
