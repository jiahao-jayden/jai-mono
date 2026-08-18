import { execFile, spawn } from "node:child_process";
import path from "node:path";
import type { DesktopWorkspaceOpenApplication, DesktopWorkspaceOpenApplications } from "../../shared/desktop-rpc";
import { macOSApplicationQuery } from "./open-with-query";
import { isInside, workspaceFileError } from "./paths";

const MACOS_APPLICATION_QUERY_MAX_BYTES = 1_500_000;
const macOSApplicationRoots = ["/Applications", "/System/Applications", `${process.env.HOME ?? ""}/Applications`];

export interface MacOSOpenApplication {
	readonly id: string;
	readonly name: string;
	readonly path: string;
	readonly isDefault: boolean;
}

export interface MacOSOpenApplications {
	readonly applications: readonly MacOSOpenApplication[];
}

/**
 * The seam sits at the process boundary: everything above it is data handling
 * tests can drive with a fake stdout, everything below spawns a real process.
 */
export interface OpenWithProcessRunner {
	runCommand(command: string, args: readonly string[]): Promise<void>;
	runCommandOutput(command: string, args: readonly string[]): Promise<string>;
	startDetached(command: string, args: readonly string[]): Promise<void>;
}

export interface OpenWithServiceOptions {
	readonly runner?: Partial<OpenWithProcessRunner>;
	readonly platform?: NodeJS.Platform;
	/** Resolves an application icon as a data URL. Absent icons stay absent. */
	readonly fileIcon?: (applicationPath: string) => Promise<string | undefined>;
}

export interface OpenWithService {
	applicationsFor(filePath: string): Promise<DesktopWorkspaceOpenApplications>;
	openWithApplication(applicationId: string, filePath: string): Promise<void>;
	openWithDefault(filePath: string): Promise<void>;
	openInCursor(filePath: string): Promise<void>;
}

export function createOpenWithService(
	options: OpenWithServiceOptions & { readonly openPath: (filePath: string) => Promise<string> },
): OpenWithService {
	const platform = options.platform ?? process.platform;
	const runner = { ...defaultProcessRunner, ...options.runner };
	const applicationsByExtension = new Map<string, Promise<MacOSOpenApplications>>();

	async function macOSApplications(filePath: string): Promise<MacOSOpenApplications> {
		if (platform !== "darwin") return { applications: [] };
		const extension = path.extname(filePath).toLowerCase();
		const cached = applicationsByExtension.get(extension);
		if (cached) return cached;

		const applications = queryMacOSApplications(runner, filePath);
		applicationsByExtension.set(extension, applications);
		try {
			return await applications;
		} catch (cause) {
			if (applicationsByExtension.get(extension) === applications) applicationsByExtension.delete(extension);
			throw cause;
		}
	}

	return {
		async applicationsFor(filePath) {
			const applications = await macOSApplications(filePath);
			const applicationDtos = await Promise.all(
				applications.applications.map(async (application): Promise<DesktopWorkspaceOpenApplication> => {
					const iconDataUrl = await options.fileIcon?.(application.path);
					return {
						id: application.id,
						name: application.name,
						isDefault: application.isDefault,
						...(iconDataUrl ? { iconDataUrl } : {}),
					};
				}),
			);
			const defaultApplication = applicationDtos.find((application) => application.isDefault);
			return { applications: applicationDtos, ...(defaultApplication ? { defaultApplication } : {}) };
		},

		async openWithApplication(applicationId, filePath) {
			const application = (await macOSApplications(filePath)).applications.find(
				(candidate) => candidate.id === applicationId,
			);
			if (!application) throw workspaceFileError({ message: "The selected application cannot open this file." });
			if (platform !== "darwin") {
				throw workspaceFileError({ message: "Opening with a selected application is only available on macOS." });
			}
			await runner.runCommand("open", ["-b", application.id, filePath]);
		},

		async openWithDefault(filePath) {
			const failure = await options.openPath(filePath);
			if (failure) throw workspaceFileError({ message: failure });
		},

		async openInCursor(filePath) {
			if (platform === "darwin") {
				await runner.runCommand("open", ["-a", "Cursor", filePath]);
				return;
			}
			await runner.startDetached(platform === "win32" ? "Cursor.exe" : "cursor", [filePath]);
		},
	};
}

async function queryMacOSApplications(runner: OpenWithProcessRunner, filePath: string): Promise<MacOSOpenApplications> {
	try {
		const output = await runner.runCommandOutput("/usr/bin/osascript", [
			"-l",
			"JavaScript",
			"-e",
			macOSApplicationQuery,
			"--",
			filePath,
		]);
		return assertMacOSApplicationQueryResult(JSON.parse(output));
	} catch (cause) {
		throw workspaceFileError({ message: "Available applications could not be loaded.", cause });
	}
}

/** Validates what an external process handed back, including the launch allowlist. */
export function assertMacOSApplicationQueryResult(value: unknown): MacOSOpenApplications {
	if (!isRecord(value) || !Array.isArray(value.applications)) {
		throw workspaceFileError({ message: "Available applications returned an invalid response." });
	}
	const applications: MacOSOpenApplication[] = [];
	for (const candidate of value.applications) {
		if (
			!isRecord(candidate) ||
			typeof candidate.id !== "string" ||
			candidate.id.length === 0 ||
			typeof candidate.name !== "string" ||
			candidate.name.length === 0 ||
			typeof candidate.isDefault !== "boolean" ||
			typeof candidate.path !== "string" ||
			!isMacOSApplicationPath(candidate.path)
		) {
			throw workspaceFileError({ message: "Available applications returned an invalid application." });
		}
		applications.push({
			id: candidate.id,
			name: candidate.name,
			path: candidate.path,
			isDefault: candidate.isDefault,
		});
	}
	return { applications };
}

/** Only bundles inside a known Applications root may be launched. */
export function isMacOSApplicationPath(applicationPath: string): boolean {
	return (
		path.isAbsolute(applicationPath) &&
		applicationPath.endsWith(".app") &&
		macOSApplicationRoots.some((root) => root && isInside(applicationPath, root))
	);
}

const defaultProcessRunner: OpenWithProcessRunner = {
	runCommand(command, args) {
		return new Promise((resolve, reject) => {
			const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
			child.once("error", reject);
			child.once("close", (code) => {
				if (code === 0) resolve();
				else reject(new Error(`Command exited with status ${code ?? "unknown"}`));
			});
		});
	},
	runCommandOutput(command, args) {
		return new Promise((resolve, reject) => {
			execFile(
				command,
				args,
				{ encoding: "utf8", maxBuffer: MACOS_APPLICATION_QUERY_MAX_BYTES },
				(error, stdout) => {
					if (error) reject(error);
					else resolve(stdout);
				},
			);
		});
	},
	startDetached(command, args) {
		return new Promise((resolve, reject) => {
			const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
			child.once("error", reject);
			child.once("spawn", () => {
				child.unref();
				resolve();
			});
		});
	},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
