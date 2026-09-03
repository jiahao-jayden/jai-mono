import { spawn } from "node:child_process";
import { Result, type Result as ResultType } from "better-result";
import { FrontierDockerOperationFailed, FrontierDockerUnavailable } from "../../core/errors";

export interface DockerCommandOptions {
	readonly action: string;
	readonly input?: string;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly signal?: AbortSignal;
}

export interface DockerCommandOutput {
	readonly stdout: string;
	readonly stderr: string;
}

export interface DockerClient {
	command(
		arguments_: readonly string[],
		options: DockerCommandOptions,
	): Promise<ResultType<DockerCommandOutput, FrontierDockerOperationFailed>>;
	ensureAvailable(): Promise<ResultType<void, FrontierDockerUnavailable>>;
}

export class NodeDockerClient implements DockerClient {
	async ensureAvailable(): Promise<ResultType<void, FrontierDockerUnavailable>> {
		const checked = await this.command(["version", "--format", "{{.Server.Version}}"], {
			action: "check Docker daemon",
		});
		return checked.isOk()
			? Result.ok(undefined)
			: Result.err(new FrontierDockerUnavailable({ message: "Docker daemon is not available" }));
	}

	async command(
		arguments_: readonly string[],
		options: DockerCommandOptions,
	): Promise<ResultType<DockerCommandOutput, FrontierDockerOperationFailed>> {
		return new Promise((resolve) => {
			let stdout = "";
			let stderr = "";
			let child: ReturnType<typeof spawn>;
			try {
				child = spawn("docker", arguments_, {
					env: { ...process.env, ...options.environment },
					stdio: "pipe",
					...(options.signal === undefined ? {} : { signal: options.signal }),
				});
			} catch {
				resolve(
					Result.err(
						new FrontierDockerOperationFailed({
							action: options.action,
							message: `Docker could not ${options.action}`,
						}),
					),
				);
				return;
			}
			const stdoutStream = child.stdout;
			const stderrStream = child.stderr;
			const stdinStream = child.stdin;
			if (!stdoutStream || !stderrStream || !stdinStream) {
				resolve(
					Result.err(
						new FrontierDockerOperationFailed({
							action: options.action,
							message: `Docker could not ${options.action}`,
						}),
					),
				);
				return;
			}
			stdoutStream.setEncoding("utf8");
			stderrStream.setEncoding("utf8");
			stdoutStream.on("data", (chunk: string) => {
				stdout = appendBounded(stdout, chunk);
			});
			stderrStream.on("data", (chunk: string) => {
				stderr = appendBounded(stderr, chunk);
			});
			child.once("error", () => {
				resolve(
					Result.err(
						new FrontierDockerOperationFailed({
							action: options.action,
							message: `Docker could not ${options.action}`,
						}),
					),
				);
			});
			child.once("close", (code) => {
				if (code === 0) {
					resolve(Result.ok({ stdout, stderr }));
					return;
				}
				resolve(
					Result.err(
						new FrontierDockerOperationFailed({
							action: options.action,
							message: dockerFailureMessage(options.action, stderr),
						}),
					),
				);
			});
			if (options.input !== undefined) stdinStream.end(options.input);
			else stdinStream.end();
		});
	}
}

function dockerFailureMessage(action: string, stderr: string): string {
	const detail = stderr.trim().slice(-1_000);
	return detail ? `Docker ${action} failed: ${detail}` : `Docker ${action} failed`;
}

function appendBounded(current: string, chunk: string): string {
	const combined = current + chunk;
	return combined.length <= 32_768 ? combined : combined.slice(-32_768);
}
