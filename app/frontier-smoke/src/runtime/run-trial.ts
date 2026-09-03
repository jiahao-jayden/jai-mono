import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Result, type Result as ResultType } from "better-result";
import { type DockerClient, NodeDockerClient } from "../adapters/docker/client";
import {
	gatewayContainerPort,
	gatewayDockerfile,
	gatewayNetworkAlias,
	gatewayProgram,
	idleProgram,
	runtimeDockerfile,
	taskBootstrapProgram,
	taskDockerfile,
	taskGatewayBaseUrl,
} from "../adapters/docker/images";
import { verifyFrontierTaskRevision } from "../adapters/node/fixed-revision";
import { resolveLocalModelSource } from "../adapters/server/local-model-source";
import {
	FrontierDockerOperationFailed,
	FrontierGatewayUnhealthy,
	FrontierOutputUnavailable,
	type FrontierSmokeError,
	frontierErrorMessage,
} from "../core/errors";
import { readFrontierTaskDefinition } from "../core/task-definition";
import type {
	CliFinalProjection,
	FrontierSmokeResult,
	GatewayModelSource,
	RunTrialInput,
	TrialArtifact,
	TrialStatus,
} from "../core/types";
import type { FrontierSmokeOptions } from "./options";

const taskWorkspace = "/app";
const taskDataDirectory = "/tmp/jai";

interface TrialResources {
	readonly runtimeImage: string;
	readonly gatewayImage: string;
	readonly taskImage: string;
	readonly internalNetwork: string;
	readonly egressNetwork: string;
	readonly gatewayContainer: string;
	readonly taskContainer: string;
}

export async function runFrontierSmoke(
	options: FrontierSmokeOptions,
	dependencies: { readonly docker?: DockerClient } = {},
): Promise<ResultType<FrontierSmokeResult, FrontierSmokeError>> {
	const task = await readFrontierTaskDefinition(options.taskDirectory);
	if (task.isErr()) return task;
	const revision = await verifyFrontierTaskRevision(task.value.taskDirectory);
	if (revision.isErr()) return revision;
	const model = await resolveLocalModelSource({
		model: options.model,
		...(options.dataDirectory === undefined ? {} : { dataDirectory: options.dataDirectory }),
	});
	if (model.isErr()) return model;
	const outputDirectory = await reserveTrialDirectory(options.outputDirectory);
	if (outputDirectory.isErr()) return outputDirectory;
	return runPreparedFrontierTrial(
		{
			task: task.value,
			model: model.value,
			maxTurns: options.maxTurns,
			outputDirectory: outputDirectory.value,
		},
		dependencies.docker ?? new NodeDockerClient(),
	);
}

export async function runPreparedFrontierTrial(
	input: RunTrialInput,
	docker: DockerClient,
): Promise<ResultType<FrontierSmokeResult, FrontierSmokeError>> {
	const trialId = `fh-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
	const resources = trialResources(trialId);
	const startedAt = new Date();
	const buildContext = await mkdtemp(join(tmpdir(), "jai-frontier-smoke-"));
	let outcome: FrontierSmokeResult;
	try {
		const available = await docker.ensureAvailable();
		if (available.isErr()) {
			outcome = failedResult(input, trialId, startedAt, "setup_failed", "setup", available.error, []);
		} else {
			const prepared = await prepareTrialImages(input, docker, resources, buildContext);
			if (prepared.isErr()) {
				outcome = failedResult(input, trialId, startedAt, "setup_failed", "setup", prepared.error, []);
			} else {
				const opened = await openTrialEnvironment(input, docker, resources);
				if (opened.isErr()) {
					outcome = failedResult(input, trialId, startedAt, "setup_failed", "setup", opened.error, []);
				} else {
					const agent = await runAgent(input, docker, resources);
					const artifacts = await collectArtifacts(input, docker, resources);
					if (agent.kind === "completed" && agent.cli.stopReason === "error") {
						const detail = agent.cli.errorMessage;
						outcome = failedResult(
							input,
							trialId,
							startedAt,
							"agent_failed",
							"agent",
							new FrontierDockerOperationFailed({
								action: "run Jai CLI in task",
								message: detail ? `CLI stopped with error; task logs: ${detail}` : "CLI stopped with error",
							}),
							artifacts,
						);
					} else {
						outcome = resultFromAgent(input, trialId, startedAt, agent, artifacts);
					}
				}
			}
		}
	} catch (error) {
		outcome = failedResult(
			input,
			trialId,
			startedAt,
			"setup_failed",
			"setup",
			new FrontierDockerOperationFailed({
				action: "prepare local smoke trial",
				message: frontierErrorMessage(error),
			}),
			[],
		);
	} finally {
		await cleanupTrialResources(docker, resources);
		await rm(buildContext, { recursive: true, force: true });
	}
	const written = await writeTrialResult(input.outputDirectory, outcome!);
	return written.isErr() ? written : Result.ok(outcome!);
}

function trialResources(trialId: string): TrialResources {
	const prefix = `jai-${trialId}`;
	return {
		runtimeImage: `${prefix}-runtime`,
		gatewayImage: `${prefix}-gateway`,
		taskImage: `${prefix}-task`,
		internalNetwork: `${prefix}-internal`,
		egressNetwork: `${prefix}-egress`,
		gatewayContainer: `${prefix}-gateway`,
		taskContainer: `${prefix}-task`,
	};
}

async function prepareTrialImages(
	input: RunTrialInput,
	docker: DockerClient,
	resources: TrialResources,
	buildContext: string,
): Promise<ResultType<void, FrontierDockerOperationFailed>> {
	const workspaceRoot = await findWorkspaceRoot(process.cwd());
	if (!workspaceRoot) {
		return Result.err(
			new FrontierDockerOperationFailed({
				action: "prepare runtime build context",
				message: "Run jai-frontier-smoke from inside the Jai mono workspace",
			}),
		);
	}
	const runtimeContext = join(buildContext, "runtime");
	const gatewayContext = join(buildContext, "gateway");
	const taskContext = join(buildContext, "task");
	await Promise.all([
		mkdir(join(runtimeContext, "app"), { recursive: true }),
		mkdir(join(runtimeContext, "packages"), { recursive: true }),
		mkdir(gatewayContext),
		mkdir(taskContext),
	]);
	await stageRuntimeContext(workspaceRoot, runtimeContext);
	await Promise.all([
		writeFile(join(runtimeContext, "Dockerfile"), runtimeDockerfile()),
		writeFile(join(gatewayContext, "Dockerfile"), gatewayDockerfile()),
		writeFile(join(gatewayContext, "gateway.mjs"), gatewayProgram()),
		writeFile(join(taskContext, "Dockerfile"), taskDockerfile()),
		writeFile(join(taskContext, "bootstrap.mjs"), taskBootstrapProgram()),
		writeFile(join(taskContext, "idle.mjs"), idleProgram()),
	]);
	const runtime = await docker.command(
		["build", "--platform", "linux/amd64", "--tag", resources.runtimeImage, runtimeContext],
		{
			action: "build Jai Linux runtime",
		},
	);
	if (runtime.isErr()) return runtime;
	const gateway = await docker.command(
		["build", "--platform", "linux/amd64", "--tag", resources.gatewayImage, gatewayContext],
		{
			action: "build provider gateway",
		},
	);
	if (gateway.isErr()) return gateway;
	const task = await docker.command(
		[
			"build",
			"--platform",
			"linux/amd64",
			"--build-arg",
			`JAI_RUNTIME_IMAGE=${resources.runtimeImage}`,
			"--build-arg",
			`TASK_IMAGE=${input.task.image}`,
			"--tag",
			resources.taskImage,
			taskContext,
		],
		{ action: "build task wrapper image" },
	);
	return task.isOk() ? Result.ok(undefined) : task;
}

async function stageRuntimeContext(workspaceRoot: string, destination: string): Promise<void> {
	await Promise.all([
		cp(join(workspaceRoot, "package.json"), join(destination, "package.json")),
		cp(join(workspaceRoot, "bun.lock"), join(destination, "bun.lock")),
		cp(join(workspaceRoot, "tsconfig.base.json"), join(destination, "tsconfig.base.json")),
		cp(join(workspaceRoot, "app", "cli"), join(destination, "app", "cli"), {
			recursive: true,
			filter: includeRuntimeFile,
		}),
		cp(join(workspaceRoot, "app", "connector"), join(destination, "app", "connector"), {
			recursive: true,
			filter: includeRuntimeFile,
		}),
		cp(join(workspaceRoot, "app", "server"), join(destination, "app", "server"), {
			recursive: true,
			filter: includeRuntimeFile,
		}),
		cp(join(workspaceRoot, "packages"), join(destination, "packages"), {
			recursive: true,
			filter: includeRuntimeFile,
		}),
	]);
}

function includeRuntimeFile(source: string): boolean {
	const name = basename(source);
	return !["node_modules", "dist", ".git", "coverage"].includes(name);
}

async function findWorkspaceRoot(start: string): Promise<string | undefined> {
	let current = resolve(start);
	while (true) {
		try {
			await stat(join(current, "app", "server", "package.json"));
			await stat(join(current, "app", "cli", "package.json"));
			return current;
		} catch {
			const parent = resolve(current, "..");
			if (parent === current) return undefined;
			current = parent;
		}
	}
}

async function openTrialEnvironment(
	input: RunTrialInput,
	docker: DockerClient,
	resources: TrialResources,
): Promise<ResultType<void, FrontierSmokeError>> {
	const internal = await docker.command(["network", "create", "--internal", resources.internalNetwork], {
		action: "create internal task network",
	});
	if (internal.isErr()) return internal;
	const egress = await docker.command(["network", "create", resources.egressNetwork], {
		action: "create gateway egress network",
	});
	if (egress.isErr()) return egress;
	const gateway = await docker.command(
		[
			"run",
			"--detach",
			"--name",
			resources.gatewayContainer,
			"--network",
			resources.internalNetwork,
			"--network-alias",
			gatewayNetworkAlias,
			"--read-only",
			"--tmpfs",
			"/tmp:rw,noexec,nosuid,size=16m",
			"--env",
			"JAI_GATEWAY_PORT",
			"--env",
			`JAI_GATEWAY_UPSTREAM_URL=${input.model.upstreamBaseUrl}`,
			"--env",
			`JAI_GATEWAY_MODEL=${input.model.remoteModelId}`,
			"--env",
			`JAI_GATEWAY_AUTHENTICATION=${input.model.upstreamAuthentication}`,
			"--env",
			`JAI_GATEWAY_ADAPTER=${input.model.adapter}`,
			...(input.model.upstreamApiKey === undefined ? [] : (["--env", "JAI_GATEWAY_API_KEY"] as const)),
			resources.gatewayImage,
		],
		{
			action: "start provider gateway",
			environment: gatewaySecretEnvironment(input.model),
		},
	);
	if (gateway.isErr()) return gateway;
	const connected = await docker.command(["network", "connect", resources.egressNetwork, resources.gatewayContainer], {
		action: "connect provider gateway to egress network",
	});
	if (connected.isErr()) return connected;
	const healthy = await waitForGatewayHealth(docker, resources.gatewayContainer);
	if (healthy.isErr()) {
		return Result.err(new FrontierGatewayUnhealthy({ message: "Internal provider gateway did not become healthy" }));
	}
	const task = await docker.command(taskContainerRunArguments(input, resources), {
		action: "start isolated task container",
	});
	if (task.isErr()) return task;
	const bootstrap = await docker.command(taskBootstrapArguments(input, resources), {
		action: "configure isolated Jai runtime",
	});
	if (bootstrap.isOk()) return Result.ok(undefined);
	const logs = await docker.command(["logs", resources.taskContainer], {
		action: "read failed task container logs",
	});
	if (logs.isErr()) return bootstrap;
	const detail = [logs.value.stdout, logs.value.stderr].join("\n").trim().slice(-2_000);
	return Result.err(
		new FrontierDockerOperationFailed({
			action: bootstrap.error.action,
			message: detail ? `${bootstrap.error.message}; task logs: ${detail}` : bootstrap.error.message,
		}),
	);
}

async function waitForGatewayHealth(
	docker: DockerClient,
	gatewayContainer: string,
): Promise<ResultType<void, FrontierDockerOperationFailed>> {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		const healthy = await docker.command(
			[
				"exec",
				gatewayContainer,
				"node",
				"-e",
				`fetch('http://127.0.0.1:${gatewayContainerPort}/__jai/health').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))`,
			],
			{ action: "check provider gateway health" },
		);
		if (healthy.isOk()) return Result.ok(undefined);
		await new Promise<void>((resolve) => setTimeout(resolve, 100));
	}
	return Result.err(
		new FrontierDockerOperationFailed({
			action: "check provider gateway health",
			message: "Gateway did not become healthy",
		}),
	);
}

function taskContainerRunArguments(input: RunTrialInput, resources: TrialResources): readonly string[] {
	const taskEnvironment = Object.entries(input.task.environment).flatMap(([key, value]) => [
		"--env",
		`${key}=${value}`,
	]);
	return [
		"run",
		"--detach",
		"--name",
		resources.taskContainer,
		"--network",
		resources.internalNetwork,
		"--cpus",
		String(input.task.limits.cpus),
		"--memory",
		`${input.task.limits.memoryMb}m`,
		"--env",
		`JAI_HOME=${taskDataDirectory}`,
		"--env",
		`JAI_FRONTIER_PROVIDER_ADAPTER=${input.model.adapter}`,
		"--env",
		`JAI_FRONTIER_REMOTE_MODEL=${input.model.remoteModelId}`,
		"--env",
		`JAI_FRONTIER_GATEWAY_BASE_URL=${taskGatewayBaseUrl(input.model)}`,
		"--env",
		`JAI_FRONTIER_MAX_TURNS=${input.maxTurns}`,
		...taskEnvironment,
		resources.taskImage,
		"/opt/jai/bun",
		"/opt/jai/idle.mjs",
	];
}

function taskBootstrapArguments(input: RunTrialInput, resources: TrialResources): readonly string[] {
	return [
		"exec",
		"--env",
		`JAI_HOME=${taskDataDirectory}`,
		"--env",
		`JAI_FRONTIER_PROVIDER_ADAPTER=${input.model.adapter}`,
		"--env",
		`JAI_FRONTIER_REMOTE_MODEL=${input.model.remoteModelId}`,
		"--env",
		`JAI_FRONTIER_GATEWAY_BASE_URL=${taskGatewayBaseUrl(input.model)}`,
		"--env",
		`JAI_FRONTIER_MAX_TURNS=${input.maxTurns}`,
		resources.taskContainer,
		"/opt/jai/bun",
		"/opt/jai/bootstrap.mjs",
	];
}

function gatewaySecretEnvironment(model: GatewayModelSource): Readonly<Record<string, string | undefined>> {
	return model.upstreamApiKey === undefined ? {} : { JAI_GATEWAY_API_KEY: model.upstreamApiKey };
}

async function runAgent(
	input: RunTrialInput,
	docker: DockerClient,
	resources: TrialResources,
): Promise<
	| { readonly kind: "completed"; readonly cli: CliFinalProjection }
	| { readonly kind: "agent_failed"; readonly error: FrontierDockerOperationFailed }
	| { readonly kind: "timed_out" }
> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), input.task.agentTimeoutMs);
	try {
		const executed = await docker.command(
			[
				"exec",
				"--interactive",
				"--env",
				`JAI_HOME=${taskDataDirectory}`,
				resources.taskContainer,
				"/opt/jai/bun",
				"/opt/jai/cli/main.js",
				"--cwd",
				taskWorkspace,
				"--no-session-persistence",
				"--model",
				`gateway/${input.model.remoteModelId}`,
				"--mode",
				"automate",
				"--output-format",
				"stream-json",
			],
			{ action: "run Jai CLI in task", input: input.task.instruction, signal: controller.signal },
		);
		if (controller.signal.aborted) {
			await docker.command(["kill", resources.taskContainer], { action: "stop timed out task" });
			return { kind: "timed_out" };
		}
		if (executed.isErr()) return { kind: "agent_failed", error: executed.error };
		const cli = parseCliFinalProjection(executed.value.stdout);
		return cli ? { kind: "completed", cli } : { kind: "agent_failed", error: invalidCliFinalEvent() };
	} finally {
		clearTimeout(timeout);
	}
}

function invalidCliFinalEvent(): FrontierDockerOperationFailed {
	return new FrontierDockerOperationFailed({
		action: "read Jai CLI final event",
		message: "Jai CLI did not emit a valid final event",
	});
}

function parseCliFinalProjection(stdout: string): CliFinalProjection | undefined {
	const errorMessage = stdout
		.trim()
		.split("\n")
		.map((line) => {
			try {
				const parsed = JSON.parse(line) as Record<string, unknown>;
				return parsed.type === "error" && record(parsed.error) && typeof parsed.error.message === "string"
					? parsed.error.message
					: undefined;
			} catch {
				return undefined;
			}
		})
		.find((message): message is string => message !== undefined);
	for (const line of stdout.trim().split("\n").reverse()) {
		try {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			if (parsed.type === "error") continue;
			const diagnostics = record(parsed.diagnostics);
			if (parsed.type !== "result" || !diagnostics) continue;
			if (
				typeof diagnostics.stop_reason !== "string" ||
				typeof diagnostics.tool_calls !== "number" ||
				typeof diagnostics.tool_errors !== "number" ||
				typeof parsed.total_cost_usd !== "number" ||
				typeof parsed.duration_ms !== "number"
			)
				continue;
			return {
				stopReason: diagnostics.stop_reason,
				toolCalls: diagnostics.tool_calls,
				toolErrors: diagnostics.tool_errors,
				totalCostUsd: parsed.total_cost_usd,
				durationMs: parsed.duration_ms,
				...(typeof diagnostics.error_message === "string"
					? { errorMessage: diagnostics.error_message }
					: errorMessage === undefined
						? {}
						: { errorMessage }),
			};
		} catch {
			// The stream can contain non-JSON provider or process output; only final DTO is relevant.
		}
	}
	return undefined;
}

async function collectArtifacts(
	input: RunTrialInput,
	docker: DockerClient,
	resources: TrialResources,
): Promise<readonly TrialArtifact[]> {
	const artifactDirectory = join(input.outputDirectory, "artifacts");
	await mkdir(artifactDirectory, { recursive: true });
	const artifacts: TrialArtifact[] = [];
	for (const [index, sourcePath] of input.task.artifacts.entries()) {
		const outputPath = join(artifactDirectory, `${index}-${basename(sourcePath)}`);
		const copied = await docker.command(["cp", `${resources.taskContainer}:${sourcePath}`, outputPath], {
			action: "collect task artifact",
		});
		if (copied.isErr()) {
			artifacts.push({ sourcePath, status: "missing" });
			continue;
		}
		const digest = await sha256File(outputPath);
		artifacts.push({
			sourcePath,
			status: "collected",
			outputPath: join("artifacts", `${index}-${basename(sourcePath)}`),
			...(digest === undefined ? {} : { sha256: digest }),
		});
	}
	return artifacts;
}

async function sha256File(path: string): Promise<string | undefined> {
	try {
		const file = await stat(path);
		if (!file.isFile()) return undefined;
		return createHash("sha256")
			.update(await readFile(path))
			.digest("hex");
	} catch {
		return undefined;
	}
}

function resultFromAgent(
	input: RunTrialInput,
	trialId: string,
	startedAt: Date,
	agent:
		| { readonly kind: "completed"; readonly cli: CliFinalProjection }
		| { readonly kind: "agent_failed"; readonly error: FrontierDockerOperationFailed }
		| { readonly kind: "timed_out" },
	artifacts: readonly TrialArtifact[],
): FrontierSmokeResult {
	if (agent.kind === "completed") {
		return baseResult(input, trialId, startedAt, "completed", artifacts, { cli: agent.cli });
	}
	if (agent.kind === "timed_out") {
		return failedResult(
			input,
			trialId,
			startedAt,
			"timed_out",
			"agent",
			new FrontierDockerOperationFailed({ action: "run Jai CLI in task", message: "Agent time limit elapsed" }),
			artifacts,
		);
	}
	return failedResult(input, trialId, startedAt, "agent_failed", "agent", agent.error, artifacts);
}

function failedResult(
	input: RunTrialInput,
	trialId: string,
	startedAt: Date,
	status: Exclude<TrialStatus, "completed" | "evidence_failed">,
	stage: "setup" | "agent",
	error: FrontierSmokeError,
	artifacts: readonly TrialArtifact[],
): FrontierSmokeResult {
	return baseResult(input, trialId, startedAt, status, artifacts, {
		failure: { stage, tag: error._tag, message: error.message },
	});
}

function baseResult(
	input: RunTrialInput,
	trialId: string,
	startedAt: Date,
	status: TrialStatus,
	artifacts: readonly TrialArtifact[],
	extra: Pick<FrontierSmokeResult, "cli" | "failure">,
): FrontierSmokeResult {
	return {
		format: "jai.frontier-smoke/v1",
		kind: "local-smoke-evidence",
		trialId,
		outputDirectory: input.outputDirectory,
		status,
		task: {
			name: input.task.name,
			sourceRevision: input.task.sourceRevision,
			image: input.task.image,
			limits: input.task.limits,
			agentTimeoutMs: input.task.agentTimeoutMs,
		},
		model: { requested: input.model.requestedModel, adapter: input.model.adapter },
		networkPolicy: "model-gateway-only",
		timing: { startedAt: startedAt.toISOString(), totalDurationMs: Math.max(0, Date.now() - startedAt.getTime()) },
		artifacts,
		...(extra.cli === undefined ? {} : { cli: extra.cli }),
		...(extra.failure === undefined ? {} : { failure: extra.failure }),
	};
}

async function cleanupTrialResources(docker: DockerClient, resources: TrialResources): Promise<void> {
	await docker.command(["rm", "--force", resources.taskContainer], { action: "remove trial task container" });
	await docker.command(["rm", "--force", resources.gatewayContainer], { action: "remove trial gateway container" });
	await docker.command(["network", "rm", resources.internalNetwork], { action: "remove trial internal network" });
	await docker.command(["network", "rm", resources.egressNetwork], { action: "remove trial egress network" });
	await docker.command(["image", "rm", "--force", resources.taskImage], { action: "remove trial task image" });
	await docker.command(["image", "rm", "--force", resources.gatewayImage], { action: "remove trial gateway image" });
	await docker.command(["image", "rm", "--force", resources.runtimeImage], { action: "remove trial runtime image" });
}

async function reserveTrialDirectory(parent: string): Promise<ResultType<string, FrontierOutputUnavailable>> {
	try {
		await mkdir(parent, { recursive: true });
		return Result.ok(await mkdtemp(join(parent, "trial-")));
	} catch {
		return Result.err(
			new FrontierOutputUnavailable({ message: "Could not create the requested trial output directory" }),
		);
	}
}

async function writeTrialResult(
	directory: string,
	result: FrontierSmokeResult,
): Promise<ResultType<void, FrontierOutputUnavailable>> {
	try {
		await writeFile(join(directory, "result.json"), `${JSON.stringify(result, null, "\t")}\n`, "utf8");
		return Result.ok(undefined);
	} catch {
		return Result.err(new FrontierOutputUnavailable({ message: "Could not write the trial result" }));
	}
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
