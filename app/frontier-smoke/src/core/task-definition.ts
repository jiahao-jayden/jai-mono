import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Result, type Result as ResultType } from "better-result";
import { parse } from "smol-toml";
import { FrontierConstraintUnsupported, FrontierTaskInvalid } from "./errors";

export const FRONTIER_HARNESS_REVISION = "0c402ae23724e2d937df0c7038b82203a829a385";

export interface FrontierTaskDefinition {
	readonly sourceRevision: string;
	readonly taskDirectory: string;
	readonly name: string;
	readonly instruction: string;
	readonly image: string;
	readonly agentTimeoutMs: number;
	readonly limits: {
		readonly cpus: number;
		readonly memoryMb: number;
		readonly storageMb: number;
	};
	readonly environment: Readonly<Record<string, string>>;
	readonly artifacts: readonly string[];
}

export async function readFrontierTaskDefinition(
	taskDirectory: string,
): Promise<ResultType<FrontierTaskDefinition, FrontierTaskInvalid | FrontierConstraintUnsupported>> {
	const directory = resolve(taskDirectory);
	const instructionPath = join(directory, "instruction.md");
	const manifestPath = join(directory, "task.toml");
	let instruction: string;
	let manifestSource: string;
	try {
		[instruction, manifestSource] = await Promise.all([
			readFile(instructionPath, "utf8"),
			readFile(manifestPath, "utf8"),
		]);
	} catch {
		return Result.err(
			new FrontierTaskInvalid({ message: `Task directory must contain instruction.md and task.toml: ${directory}` }),
		);
	}
	if (!instruction.trim()) return Result.err(new FrontierTaskInvalid({ message: "instruction.md must not be empty" }));

	let raw: unknown;
	try {
		raw = parse(manifestSource);
	} catch {
		return Result.err(new FrontierTaskInvalid({ message: "task.toml is not valid TOML" }));
	}
	const manifest = record(raw);
	if (!manifest) return Result.err(new FrontierTaskInvalid({ message: "task.toml must contain a table" }));

	const task = record(manifest.task);
	const environment = record(manifest.environment);
	const agent = record(manifest.agent);
	if (!task || !environment || !agent) {
		return Result.err(new FrontierTaskInvalid({ message: "task.toml requires task, environment, and agent tables" }));
	}

	const name = stringField(task, "name");
	const image = stringField(environment, "docker_image");
	const timeoutSec = positiveNumber(agent, "timeout_sec");
	const cpus = positiveNumber(environment, "cpus");
	const memoryMb = positiveInteger(environment, "memory_mb");
	const storageMb = positiveInteger(environment, "storage_mb");
	if (!name || !image || !timeoutSec || !cpus || !memoryMb || !storageMb) {
		return Result.err(
			new FrontierTaskInvalid({
				message: "task.toml requires task.name, environment image/CPU/memory/storage, and agent.timeout_sec",
			}),
		);
	}
	if (environment.gpus !== undefined && environment.gpus !== 0) {
		return Result.err(new FrontierConstraintUnsupported({ message: "GPU tasks are not supported by local smoke" }));
	}
	const network = validateNetwork(environment, agent);
	if (network.isErr()) return network;
	const taskEnvironment = stringRecord(environment.env);
	if (!taskEnvironment) {
		return Result.err(new FrontierTaskInvalid({ message: "environment.env must contain only string values" }));
	}
	if (Object.keys(taskEnvironment).some(isReservedRuntimeEnvironmentKey)) {
		return Result.err(
			new FrontierConstraintUnsupported({
				message: "Task environment must not override JAI_HOME, JAI runtime settings, or the internal gateway",
			}),
		);
	}
	const artifacts = stringList(manifest.artifacts);
	if (!artifacts || artifacts.some((artifact) => !artifact.startsWith("/"))) {
		return Result.err(new FrontierTaskInvalid({ message: "artifacts must be absolute paths" }));
	}
	return Result.ok({
		sourceRevision: FRONTIER_HARNESS_REVISION,
		taskDirectory: directory,
		name,
		instruction,
		image,
		agentTimeoutMs: Math.ceil(timeoutSec * 1000),
		limits: { cpus, memoryMb, storageMb },
		environment: taskEnvironment,
		artifacts,
	});
}

function validateNetwork(
	environment: Record<string, unknown>,
	agent: Record<string, unknown>,
): ResultType<void, FrontierConstraintUnsupported> {
	const agentNetwork = agent.network_mode;
	const environmentAllowsInternet = environment.allow_internet;
	if (agentNetwork === "no-network" || environmentAllowsInternet === false) return Result.ok(undefined);
	return Result.err(
		new FrontierConstraintUnsupported({
			message:
				"Only no-network tasks are supported because local smoke permits model access through the internal gateway only",
		}),
	);
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
	const candidate = value[key];
	return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function positiveNumber(value: Record<string, unknown>, key: string): number | undefined {
	const candidate = value[key];
	return typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0 ? candidate : undefined;
}

function positiveInteger(value: Record<string, unknown>, key: string): number | undefined {
	const candidate = positiveNumber(value, key);
	return candidate !== undefined && Number.isInteger(candidate) ? candidate : undefined;
}

function stringRecord(value: unknown): Readonly<Record<string, string>> | undefined {
	const source = record(value);
	if (!source) return value === undefined ? {} : undefined;
	const entries = Object.entries(source);
	if (entries.some(([, entry]) => typeof entry !== "string")) return undefined;
	return Object.fromEntries(entries) as Readonly<Record<string, string>>;
}

function stringList(value: unknown): readonly string[] | undefined {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return undefined;
	return value.map((entry) => entry.trim()).filter(Boolean);
}

function isReservedRuntimeEnvironmentKey(key: string): boolean {
	return key === "HOME" || key === "JAI_HOME" || key.startsWith("JAI_");
}
