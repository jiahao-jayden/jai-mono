import { spawn } from "node:child_process";
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
 * Client-only launcher for Desktop/CLI. It first joins an existing Host; only
 * when none exists does it spawn the packaged daemon. This module imports no
 * SQLite adapter, RuntimeHost, or Coding Agent implementation.
 */
export async function connectJaiRuntimeHost(
	options: ConnectJaiRuntimeHostOptions = {},
): Promise<ResultType<LocalAcpV2Client, RuntimeHostClientConnectError>> {
	const environment = options.environment ?? process.env;
	const dataDirectory = options.dataDirectory ?? resolveJaiDataDirectory(environment);
	const endpoint = options.endpoint ?? localAcpV2EndpointFor(dataDirectory);
	const connected = await openLocalAcpV2Client(endpoint);
	if (connected.isOk()) return connected;
	try {
		const entrypoint = options.runtimeHostEntrypoint ?? packagedRuntimeHostEntrypoint();
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
			cause: connected.error,
		}),
	);
}

function packagedRuntimeHostEntrypoint(): string {
	const require = createRequire(import.meta.url);
	const packageManifest = require.resolve("@jai/server/package.json");
	return join(dirname(packageManifest), "dist", "main.js");
}
