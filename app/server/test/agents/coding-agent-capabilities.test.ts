import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { createCodingAgentOperationDriver } from "../../src/agents";
import {
	RuntimeCapabilitySourceFailed,
	type RuntimeCapabilitySourceInput,
} from "../../src/runtime-capabilities";

describe("Coding Agent Runtime Capability Source", () => {
	test("preflight consumes an injected source without any local filesystem policy", async () => {
		const sourceInputs: RuntimeCapabilitySourceInput[] = [];
		const driver = createCodingAgentOperationDriver({
			resolveOptions: () => Result.ok({ model: "openai/model" }),
			capabilitySource: {
				resolve: async (input) => {
					sourceInputs.push(input);
					return Result.ok({
						fileCapabilities: {
							homeDirectory: "/controlled/home",
							workspaceDirectory: "/controlled/workspace",
							workspaceTrusted: false,
						},
						extensions: [],
					});
				},
			},
		});

		const preflight = await driver.preflight?.({
			sessionId: "session-1",
			operationId: "operation-1",
			cwd: "/requested/cwd",
			runtimeConfiguration: { model: "openai/model", mode: "manual" },
		});

		expect(preflight?.isOk()).toBe(true);
		expect(sourceInputs).toEqual([
			{
				sessionId: "session-1",
				operationId: "operation-1",
				cwd: "/requested/cwd",
			},
		]);
	});

	test("projects a source failure as a recoverable Operation open failure", async () => {
		const driver = createCodingAgentOperationDriver({
			resolveOptions: () => Result.ok({ model: "openai/model" }),
			capabilitySource: {
				resolve: async (input) =>
					Result.err(
						new RuntimeCapabilitySourceFailed({
							sessionId: input.sessionId,
							operationId: input.operationId,
							message: "test source failed",
						}),
					),
			},
		});

		const preflight = await driver.preflight?.({
			sessionId: "session-1",
			operationId: "operation-1",
			cwd: "/requested/cwd",
			runtimeConfiguration: { model: "openai/model", mode: "manual" },
		});

		expect(preflight).toMatchObject({
			status: "error",
			error: {
				_tag: "runtime_operations.open_failed",
				cause: { _tag: "runtime_capabilities.resolve_failed" },
			},
		});
	});
});
