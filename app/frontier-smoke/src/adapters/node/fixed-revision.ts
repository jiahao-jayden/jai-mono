import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Result, type Result as ResultType } from "better-result";
import { FrontierTaskInvalid } from "../../core/errors";
import { FRONTIER_HARNESS_REVISION } from "../../core/task-definition";

const execFileAsync = promisify(execFile);

/** The task must come from the exact public definition revision recorded in every result. */
export async function verifyFrontierTaskRevision(
	taskDirectory: string,
): Promise<ResultType<void, FrontierTaskInvalid>> {
	try {
		const [head, status] = await Promise.all([
			gitOutput(taskDirectory, ["rev-parse", "HEAD"]),
			gitOutput(taskDirectory, ["status", "--porcelain"]),
		]);
		if (head !== FRONTIER_HARNESS_REVISION) {
			return Result.err(
				new FrontierTaskInvalid({
					message: `Task repository must be checked out at Frontier revision ${FRONTIER_HARNESS_REVISION}`,
				}),
			);
		}
		if (status) {
			return Result.err(new FrontierTaskInvalid({ message: "Task repository must have a clean working tree" }));
		}
		return Result.ok(undefined);
	} catch {
		return Result.err(
			new FrontierTaskInvalid({
				message: "Task directory must be inside a clean frontier-harness-eval Git checkout",
			}),
		);
	}
}

async function gitOutput(directory: string, arguments_: readonly string[]): Promise<string> {
	const output = await execFileAsync("git", ["-C", directory, ...arguments_], { encoding: "utf8" });
	return output.stdout.trim();
}
