import path from "node:path";
import { parseArgs } from "node:util";
import { Result, type Result as ResultType } from "better-result";
import { FrontierTaskInvalid } from "../core/errors";

export interface FrontierSmokeOptions {
	readonly taskDirectory: string;
	readonly model: string;
	readonly outputDirectory: string;
	readonly maxTurns: number;
	readonly dataDirectory?: string;
	readonly help: boolean;
}

export function parseFrontierSmokeOptions(
	argv: readonly string[],
): ResultType<FrontierSmokeOptions, FrontierTaskInvalid> {
	try {
		const parsed = parseArgs({
			args: argv,
			strict: true,
			allowPositionals: false,
			options: {
				"task-dir": { type: "string" },
				model: { type: "string" },
				"output-dir": { type: "string" },
				"max-turns": { type: "string", default: "40" },
				"jai-home": { type: "string" },
				help: { type: "boolean", short: "h", default: false },
			},
		});
		if (parsed.values.help) {
			return Result.ok({
				taskDirectory: "",
				model: "",
				outputDirectory: "",
				maxTurns: 40,
				help: true,
			});
		}
		const taskDirectory = path.resolve(requiredValue(parsed.values["task-dir"], "--task-dir"));
		const model = requiredValue(parsed.values.model, "--model");
		const outputDirectory = path.resolve(requiredValue(parsed.values["output-dir"], "--output-dir"));
		const maxTurns = Number(parsed.values["max-turns"]);
		if (!Number.isInteger(maxTurns) || maxTurns < 1) {
			return Result.err(new FrontierTaskInvalid({ message: "--max-turns must be a positive integer" }));
		}
		const dataDirectory = parsed.values["jai-home"]?.trim();
		return Result.ok({
			taskDirectory,
			model,
			outputDirectory,
			maxTurns,
			...(dataDirectory ? { dataDirectory: path.resolve(dataDirectory) } : {}),
			help: false,
		});
	} catch (error) {
		return Result.err(
			new FrontierTaskInvalid({
				message: error instanceof Error ? error.message : "Invalid Frontier smoke command line",
			}),
		);
	}
}

function requiredValue(value: string | undefined, flag: string): string {
	const trimmed = value?.trim();
	if (!trimmed) throw new FrontierTaskInvalid({ message: `${flag} is required` });
	return trimmed;
}

export function frontierSmokeHelp(): string {
	return `Usage:
  jai-frontier-smoke --task-dir <task> --model <profile/model> --output-dir <directory> [options]

Runs one local task-definition-compatible smoke trial. It is not an official Frontier score.

Options:
  --task-dir <path>       Directory containing instruction.md and task.toml
  --model <profile/model> Enabled model from local Jai configuration
  --output-dir <path>     Parent directory for an immutable trial result
  --max-turns <integer>   Agent turn limit (default: 40)
  --jai-home <path>       Read model profile from this isolated Jai data directory
  -h, --help              Show this help
`;
}
