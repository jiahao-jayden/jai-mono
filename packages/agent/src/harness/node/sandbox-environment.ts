import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { shellError } from "../environment/errors";
import type { ShellExecuteOptions, ShellExecutionPolicy, ShellResult } from "../environment/types";
import { NodeExecutionEnvironment, type NodeExecutionEnvironmentOptions } from "./environment";

const STDERR_TAIL_BYTES = 8_192;
const require = createRequire(import.meta.url);
const sandboxCliPath = join(dirname(require.resolve("@anthropic-ai/sandbox-runtime")), "cli.js");

/**
 * Runs every Shell call in a separate sandbox-runtime CLI process. The CLI owns
 * one SandboxManager instance, so two calls can never share its module-global
 * policy, proxy, credentials, or cleanup state.
 */
export class SandboxedNodeExecutionEnvironment extends NodeExecutionEnvironment {
	readonly #activePolicies = new Set<AbortController>();

	constructor(options: NodeExecutionEnvironmentOptions) {
		if (options.shellPath) throw new Error("The sandbox adapter does not support a custom Shell path");
		super(options);
	}

	/** Stops every live process tree before a replacement config can take effect. */
	cancelActivePolicies(): void {
		for (const controller of this.#activePolicies) controller.abort();
	}

	async execute(command: string, options: ShellExecuteOptions): Promise<ShellResult> {
		if (options.signal?.aborted) throw shellError("aborted", "Operation aborted");
		if (options.shell) throw new Error("The sandbox adapter does not support a custom Shell path");
		const policy = this.currentExecutionPolicy();
		if (!policy) throw new Error("Sandboxed Shell execution reached spawn without an ExecutionPolicy");
		await ensureSandboxAvailable();
		const policyController = new AbortController();
		this.#activePolicies.add(policyController);
		const signal = options.signal
			? AbortSignal.any([options.signal, policyController.signal])
			: policyController.signal;
		let directory: string | undefined;
		let stderrTail = "";
		try {
			directory = await mkdtemp(join(tmpdir(), "jai-shell-sandbox-"));
			const settingsPath = join(directory, "settings.json");
			const settings = sandboxSettings(policy, settingsPath);
			await writeFile(settingsPath, `${JSON.stringify(settings)}\n`, { mode: 0o600 });
			const result = await this.runProcess(
				{
					file: process.execPath,
					args: [sandboxCliPath, "--settings", settingsPath, "-c", command],
					environment: policy.environment,
					spawnFailure: (error) => {
						throw shellError("sandbox_unavailable", "Could not start the Shell sandbox", { cause: error });
					},
				},
				{
					...options,
					signal,
					onOutput: async (chunk) => {
						if (chunk.stream === "stderr") stderrTail = `${stderrTail}${chunk.text}`.slice(-STDERR_TAIL_BYTES);
						await options.onOutput?.(chunk);
					},
				},
			);
			if (isSandboxStartupFailure(stderrTail)) {
				throw shellError("sandbox_unavailable", "Sandbox enforcement could not start on this system");
			}
			return result;
		} catch (error) {
			if (isShellError(error)) throw error;
			throw shellError("sandbox_unavailable", "Could not prepare the Shell sandbox", { cause: error });
		} finally {
			this.#activePolicies.delete(policyController);
			if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
		}
	}
}

function sandboxSettings(policy: ShellExecutionPolicy, settingsPath: string): SandboxRuntimeConfig {
	return {
		// Network is a distinct capability; process.exec never grants it implicitly.
		network: { allowedDomains: [], deniedDomains: [], strictAllowlist: true },
		filesystem: {
			// Do not pass broad allowRead roots: sandbox-runtime permits allowRead to
			// reopen a denied descendant. Its default read behavior plus these exact
			// denies preserves the user rule's Deny priority.
			denyRead: [...policy.deniedReadPaths, settingsPath],
			allowWrite: [...policy.writableRoots],
			denyWrite: [...policy.deniedWritePaths, settingsPath],
		},
	};
}

async function ensureSandboxAvailable(): Promise<void> {
	if (process.platform !== "darwin" && process.platform !== "linux") {
		throw shellError("sandbox_unavailable", `Sandbox enforcement is unavailable on ${process.platform}`);
	}
	if (!SandboxManager.isSupportedPlatform()) {
		throw shellError("sandbox_unavailable", "Sandbox runtime does not support this platform");
	}
	const dependencies = await SandboxManager.checkDependenciesAsync();
	const unsafeWarnings = dependencies.warnings.filter((warning) => /seccomp|unix socket/i.test(warning));
	if (dependencies.errors.length > 0 || unsafeWarnings.length > 0) {
		throw shellError("sandbox_unavailable", "Sandbox dependencies are unavailable");
	}
}

/**
 * ponytail: matches sandbox-runtime 0.0.77 bootstrap diagnostics by text, because the CLI
 * exits 1 for both a failed workload and a failed sandbox. Recheck on every upgrade;
 * upgrade path is a distinct bootstrap exit code from the CLI.
 */
export function isSandboxStartupFailure(output: string): boolean {
	return /(?:apply-seccomp: (?:unshare|write \/proc\/self|mount)|bwrap: (?:Creating new namespace failed|Can't mount proc))/.test(
		output,
	);
}

function isShellError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"_tag" in error &&
		typeof error._tag === "string" &&
		error._tag.startsWith("shell.")
	);
}
