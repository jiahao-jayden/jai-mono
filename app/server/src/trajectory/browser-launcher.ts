import { spawn } from "node:child_process";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import type { TrajectoryBrowserLaunch, TrajectoryHttpServer } from "./http";
import type { TrajectoryContentScope } from "./types";

export class TrajectoryBrowserLaunchFailed extends TaggedError("trajectory.browser_launch_failed")<{
	readonly message: string;
	cause?: unknown;
}> {}

/** A local-control adapter that starts the system browser without returning the bearer capability. */
export interface TrajectoryBrowserLauncher {
	open(input: {
		readonly sessionId: string;
		readonly scopes: readonly TrajectoryContentScope[];
	}): Promise<ResultType<void, TrajectoryBrowserLaunchFailed>>;
}

export function createTrajectoryBrowserLauncher(
	server: TrajectoryHttpServer,
	openUrl: (url: string) => Promise<void> = openSystemBrowser,
): TrajectoryBrowserLauncher {
	return new SystemTrajectoryBrowserLauncher(server, openUrl);
}

class SystemTrajectoryBrowserLauncher implements TrajectoryBrowserLauncher {
	constructor(
		private readonly server: TrajectoryHttpServer,
		private readonly openUrl: (url: string) => Promise<void>,
	) {}

	async open(input: {
		readonly sessionId: string;
		readonly scopes: readonly TrajectoryContentScope[];
	}): Promise<ResultType<void, TrajectoryBrowserLaunchFailed>> {
		const launch = this.server.issueBrowserLaunch(input);
		const url = trajectoryUrl(this.server.origin, input.sessionId, launch);
		try {
			await this.openUrl(url);
			return Result.ok(undefined);
		} catch (cause) {
			return Result.err(
				new TrajectoryBrowserLaunchFailed({ message: "Could not open the trajectory in a browser", cause }),
			);
		}
	}
}

function trajectoryUrl(origin: string, sessionId: string, launch: TrajectoryBrowserLaunch): string {
	const fragment = new URLSearchParams({ launch: launch.launchId, sessionId });
	return `${origin}/trajectory/#${fragment.toString()}`;
}

async function openSystemBrowser(url: string): Promise<void> {
	const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { detached: true, stdio: "ignore" });
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}
