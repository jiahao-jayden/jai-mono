import { describe, expect, test } from "bun:test";
import { TaggedError } from "better-result";
import { getErrorCode, getErrorMessage, isErrorEnvelope, toErrorEnvelope } from "../src";

class ProviderUnavailable extends TaggedError("provider.unavailable")<{
	readonly data: { readonly providerId: string };
	readonly message: string;
}> {}
class FileNotFound extends TaggedError("filesystem.not_found")<{
	readonly cause?: unknown;
	readonly data: { readonly resource: string };
	readonly message: string;
}> {}

describe("getErrorMessage", () => {
	test("extracts the message from Error instances", () => {
		expect(getErrorMessage(new Error("failed"))).toBe("failed");
	});

	test("converts non-Error values to strings", () => {
		expect(getErrorMessage("failed")).toBe("failed");
		expect(getErrorMessage(42)).toBe("42");
	});

	test("projects tagged errors to a JSON-safe envelope", () => {
		const error = new FileNotFound({
			message: "Path not found",
			data: { resource: "/workspace/file.txt" },
			cause: new Error("ENOENT"),
		});
		const envelope = toErrorEnvelope(error);

		expect(envelope).toEqual({
			code: "filesystem.not_found",
			message: "Path not found",
			data: { resource: "/workspace/file.txt" },
		});
		expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope);
		expect("cause" in envelope).toBe(false);
		expect("stack" in envelope).toBe(false);
	});

	test("recognizes JSON-restored envelopes without relying on Error prototypes", () => {
		const restored = JSON.parse('{"code":"session.conflict","message":"Conflict"}');

		expect(isErrorEnvelope(restored)).toBe(true);
		expect(getErrorCode(restored)).toBe("session.conflict");
		expect(getErrorMessage(restored)).toBe("Conflict");
	});

	test("projects tagged errors without leaking stack or cause", () => {
		const envelope = toErrorEnvelope(
			new ProviderUnavailable({
				message: "Provider is unavailable",
				data: { providerId: "openai" },
			}),
		);

		expect(envelope).toEqual({
			code: "provider.unavailable",
			message: "Provider is unavailable",
			data: { providerId: "openai" },
		});
		expect(JSON.stringify(envelope)).not.toContain("stack");
		expect(JSON.stringify(envelope)).not.toContain("cause");
	});

	test("uses the stable tagged-error code", () => {
		const error = new ProviderUnavailable({
			message: "Provider is unavailable",
			data: { providerId: "openai" },
		});

		expect(error._tag).toBe("provider.unavailable");
		expect(getErrorCode(error)).toBe("provider.unavailable");
	});
});
