import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result, type Result as ResultType } from "better-result";
import { describe, expect, test } from "bun:test";
import type { DockerClient, DockerCommandOptions, DockerCommandOutput } from "../src/adapters/docker/client";
import {
	FrontierDockerOperationFailed,
	FrontierDockerUnavailable,
} from "../src/core/errors";
import type { RunTrialInput } from "../src/core/types";
import { runPreparedFrontierTrial } from "../src/runtime/run-trial";

describe("runPreparedFrontierTrial", () => {
	test("keeps the task internal, passes the key only to the gateway, and writes a safe final projection", async () => {
		const outputDirectory = await mkdtemp(join(tmpdir(), "jai-frontier-result-"));
		const docker = new RecordingDocker();
		try {
			const result = await runPreparedFrontierTrial(trialInput(outputDirectory), docker);
			expect(result.isOk()).toBe(true);
			if (result.isErr()) throw result.error;
			expect(result.value).toMatchObject({
				kind: "local-smoke-evidence",
				status: "completed",
				networkPolicy: "model-gateway-only",
				cli: { stopReason: "end_turn", toolCalls: 2, toolErrors: 0, totalCostUsd: 0.12, durationMs: 321 },
			});
			const gateway = docker.calls.find((call) => call.options.action === "start provider gateway");
			const task = docker.calls.find((call) => call.options.action === "start isolated task container");
			expect(gateway?.options.environment?.JAI_GATEWAY_API_KEY).toBe("test-provider-key");
			expect(gateway?.arguments_).toContain("JAI_GATEWAY_API_KEY");
			expect(task?.arguments_.join(" ")).not.toContain("test-provider-key");
			expect(task?.arguments_).toContain("--network");
			expect(task?.arguments_).not.toContain("--storage-opt");
			expect(docker.calls.some((call) => call.arguments_.includes("--mode"))).toBe(true);
			expect(docker.calls.some((call) => call.arguments_.includes("--interactive"))).toBe(true);
			const written = JSON.parse(await readFile(join(outputDirectory, "result.json"), "utf8")) as Record<string, unknown>;
			expect(JSON.stringify(written)).not.toContain("test-provider-key");
			expect(docker.calls.filter((call) => call.options.action.startsWith("remove trial")).length).toBe(7);
		} finally {
			await rm(outputDirectory, { recursive: true, force: true });
		}
	});
});

class RecordingDocker implements DockerClient {
	readonly calls: Array<{ readonly arguments_: readonly string[]; readonly options: DockerCommandOptions }> = [];

	async ensureAvailable(): Promise<ResultType<void, FrontierDockerUnavailable>> {
		return Result.ok(undefined);
	}

	async command(
		arguments_: readonly string[],
		options: DockerCommandOptions,
	): Promise<ResultType<DockerCommandOutput, FrontierDockerOperationFailed>> {
		this.calls.push({ arguments_, options });
		if (options.action === "run Jai CLI in task") {
			return Result.ok({
				stdout:
					'{"type":"result","text":"untrusted agent text","total_cost_usd":0.12,"diagnostics":{"stop_reason":"end_turn","tool_calls":2,"tool_errors":0},"duration_ms":321}\n',
				stderr: "",
			});
		}
		return Result.ok({ stdout: "", stderr: "" });
	}
}

function trialInput(outputDirectory: string): RunTrialInput {
	return {
		outputDirectory,
		maxTurns: 40,
		model: {
			requestedModel: "source/test-model",
			adapter: "openai-compatible",
			upstreamBaseUrl: "https://provider.example/v1",
			upstreamAuthentication: "api-key",
			upstreamApiKey: "test-provider-key",
			remoteModelId: "test-model",
		},
		task: {
			sourceRevision: "0c402ae23724e2d937df0c7038b82203a829a385",
			taskDirectory: "/fixture",
			name: "terminal-bench/build-cython-ext",
			instruction: "Fix it.",
			image: "example/task:fixed",
			agentTimeoutMs: 900_000,
			limits: { cpus: 1, memoryMb: 2048, storageMb: 10240 },
			environment: { PATH: "/usr/local/bin:/usr/bin" },
			artifacts: [],
		},
	};
}
