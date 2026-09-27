import { describe, expect, test } from "bun:test";
import { redactSecrets } from "../../src/logging/redact";

describe("redactSecrets", () => {
	test.each([
		["Incorrect API key provided: sk-proj-abcdefghijklmnop1234", "sk-proj-abcdefghijklmnop1234"],
		["x-api-key: sk-ant-api03-secretvalue", "sk-ant-api03-secretvalue"],
		['{"error":{"api_key":"live-secret-1"}}', "live-secret-1"],
		["request failed api_key=plain-secret", "plain-secret"],
		["GET https://x.test/v1?token=abc123&x=1", "abc123"],
		["Authorization: Bearer sk-live-token-value", "sk-live-token-value"],
		["https://user:pw-supersecret@example.com/v1", "pw-supersecret"],
		["key AIzaSyA1234567890abcdefghijklmnopqrstu rejected", "AIzaSyA1234567890abcdefghijklmnopqrstu"],
	])("removes the credential from %s", (input, secret) => {
		const redacted = redactSecrets(input);
		expect(redacted).not.toContain(secret);
		expect(redacted).toContain("[REDACTED]");
	});

	test("keeps ordinary provider error text readable", () => {
		const message = "502 Claude Code: Failed to authenticate. API Error: 401 OAuth access token is invalid.";
		expect(redactSecrets(message)).toBe(message);
	});
});
