import { spawn } from "node:child_process";
import { readFile, stat, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import { resolveJaiDataDirectory } from "../../runtime/paths";
import { type AcpLocalClientConnectFailed, type LocalAcpV2Client, openLocalAcpV2Client } from "./local-client";
import { localAcpV2EndpointFor } from "./local-endpoint";

export class RuntimeHostClientLaunchFailed extends TaggedError("runtime_host_client.launch_failed")<{
	readonly endpoint: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export type RuntimeHostClientConnectError = RuntimeHostClientLaunchFailed | AcpLocalClientConnectFailed;

export interface ConnectJaiRuntimeHostOptions {
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly dataDirectory?: string;
	readonly endpoint?: string;
	/** Desktop's packaged Runtime Host entrypoint, when it lives outside app.asar. */
	readonly runtimeHostEntrypoint?: string;
	/** Host-owned launcher for a packaged Runtime Host that cannot use Node's child_process. */
	readonly launchRuntimeHost?: (input: {
		readonly entrypoint: string;
		readonly environment: Readonly<Record<string, string | undefined>>;
	}) => void;
	readonly retryDelayMs?: number;
	readonly retryCount?: number;
}

/**
 * Client-only launcher for Desktop/CLI. It joins a live Host only when that
 * process is at least as new as the Runtime Host entrypoint on disk; an older
 * lock is replaced so `desktop:dev` rebuilds are not silently ignored.
 */
export async function connectJaiRuntimeHost(
	options: ConnectJaiRuntimeHostOptions = {},
): Promise<ResultType<LocalAcpV2Client, RuntimeHostClientConnectError>> {
	const environment = options.environment ?? process.env;
	const dataDirectory = options.dataDirectory ?? resolveJaiDataDirectory(environment);
	const endpoint = options.endpoint ?? localAcpV2EndpointFor(dataDirectory);
	const lockPath = join(dataDirectory, "runtime-host.lock");
	const entrypoint = options.runtimeHostEntrypoint ?? packagedRuntimeHostEntrypoint();
	const connected = await openLocalAcpV2Client(endpoint);
	if (connected.isOk()) {
		if (!(await isLocalRuntimeHostStale(lockPath, entrypoint))) return connected;
		await connected.value.close();
		await stopLocalRuntimeHost(lockPath, endpoint);
	}
	try {
		const runtimeEnvironment = { ...environment, JAI_HOME: dataDirectory, JAI_RUNTIME_ENDPOINT: endpoint };
		if (options.launchRuntimeHost) {
			options.launchRuntimeHost({ entrypoint, environment: runtimeEnvironment });
		} else {
			const child = spawn(process.execPath, [entrypoint], {
				detached: true,
				stdio: "ignore",
				env: runtimeEnvironment,
			});
			child.unref();
		}
	} catch (cause) {
		return Result.err(
			new RuntimeHostClientLaunchFailed({
				message: `Could not launch Runtime Host for "${endpoint}"`,
				endpoint,
				cause,
			}),
		);
	}
	const retryDelayMs = options.retryDelayMs ?? 50;
	const retryCount = options.retryCount ?? 60;
	for (let attempt = 0; attempt < retryCount; attempt += 1) {
		await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
		const retried = await openLocalAcpV2Client(endpoint);
		if (retried.isOk()) return retried;
	}
	return Result.err(
		new RuntimeHostClientLaunchFailed({
			message: `Runtime Host did not become available at "${endpoint}"`,
			endpoint,
			cause: connected.isErr() ? connected.error : undefined,
		}),
	);
}

/** True when the on-disk Host bundle is newer than the process holding the lock. */
export async function isLocalRuntimeHostStale(lockPath: string, entrypoint: string): Promise<boolean> {
	let entrypointMtimeMs: number;
	try {
		entrypointMtimeMs = (await stat(entrypoint)).mtimeMs;
	} catch {
		return false;
	}
	try {
		const parsed = JSON.parse(await readFile(lockPath, "utf8")) as { readonly createdAt?: unknown };
		if (typeof parsed.createdAt !== "string") return false;
		const createdAt = Date.parse(parsed.createdAt);
		return Number.isFinite(createdAt) && entrypointMtimeMs > createdAt;
	} catch {
		return false;
	}
}

/** Stops the lock holder so the next connect can spawn the current Host bundle. */
export async function stopLocalRuntimeHost(lockPath: string, endpoint: string): Promise<void> {
	const pid = await lockPid(lockPath);
	if (pid !== undefined) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// The lock holder is already gone.
		}
		const deadline = Date.now() + 500;
		while (Date.now() < deadline && isPidAlive(pid)) {
			await new Promise<void>((resolve) => setTimeout(resolve, 25));
		}
	}
	await unlink(lockPath).catch(() => {});
	if (process.platform !== "win32") await unlink(endpoint).catch(() => {});
}

function packagedRuntimeHostEntrypoint(): string {
	const require = createRequire(import.meta.url);
	const packageManifest = require.resolve("@jai/server/package.json");
	return join(dirname(packageManifest), "dist", "main.js");
}

async function lockPid(lockPath: string): Promise<number | undefined> {
	try {
		const parsed = JSON.parse(await readFile(lockPath, "utf8")) as { readonly pid?: unknown };
		return typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0 ? parsed.pid : undefined;
	} catch {
		return undefined;
	}
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
