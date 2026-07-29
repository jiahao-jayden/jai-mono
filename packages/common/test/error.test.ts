import { describe, expect, test } from "bun:test";
import { CodedError, defineCodedError, getErrorCode, getErrorMessage, isErrorEnvelope, toErrorEnvelope } from "../src";

describe("getErrorMessage", () => {
	test("extracts the message from Error instances", () => {
		expect(getErrorMessage(new Error("failed"))).toBe("failed");
	});

	test("converts non-Error values to strings", () => {
		expect(getErrorMessage("failed")).toBe("failed");
		expect(getErrorMessage(42)).toBe("42");
	});

	test("projects coded errors to a JSON-safe envelope", () => {
		const error = new CodedError({
			code: "filesystem.not_found",
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

	test("creates codes from a locally typed reason set", () => {
		const readError = defineCodedError("tool.read", ["aborted", "binary_file"] as const);
		const error = readError("aborted", { message: "Operation aborted" });

		expect(error.code).toBe("tool.read.aborted");
		if (false) {
			// @ts-expect-error reason 必须属于本模块声明的集合
			readError("abroted", { message: "Operation aborted" });
		}
	});
});
