import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { Result, type Result as ResultType, TaggedError } from "better-result";

export class RuntimeHostAlreadyOwned extends TaggedError("runtime_host.already_owned")<{
	readonly lockPath: string;
	readonly pid?: number;
	readonly message: string;
}> {}

export class RuntimeHostOwnerAcquireFailed extends TaggedError("runtime_host.owner_acquire_failed")<{
	readonly lockPath: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export interface LocalRuntimeOwner {
	readonly lockPath: string;
	release(): Promise<void>;
}

/**
 * OS-level ownership for the single local Runtime Host process. This lock is
 * process liveness only: durable facts remain in SQLite, never in the lock.
 */
export async function acquireLocalRuntimeOwner(
	lockPath: string,
	pid: number = process.pid,
): Promise<ResultType<LocalRuntimeOwner, RuntimeHostAlreadyOwned | RuntimeHostOwnerAcquireFailed>> {
	try {
		await mkdir(dirname(lockPath), { recursive: true });
		return await acquire(lockPath, pid);
	} catch (error) {
		return Result.err(
			new RuntimeHostOwnerAcquireFailed({
				message: `Could not acquire Runtime Host ownership at "${lockPath}"`,
				lockPath,
				cause: error,
			}),
		);
	}
}

async function acquire(
	lockPath: string,
	pid: number,
): Promise<ResultType<LocalRuntimeOwner, RuntimeHostAlreadyOwned | RuntimeHostOwnerAcquireFailed>> {
	try {
		const handle = await open(lockPath, "wx", 0o600);
		try {
			await handle.writeFile(JSON.stringify({ pid, createdAt: new Date().toISOString() }));
		} catch (error) {
			await handle.close();
			await unlink(lockPath).catch(() => {});
			return Result.err(
				new RuntimeHostOwnerAcquireFailed({
					message: `Could not write Runtime Host ownership at "${lockPath}"`,
					lockPath,
					cause: error,
				}),
			);
		}
		return Result.ok(new FileRuntimeOwner(lockPath, handle));
	} catch (error) {
		if (!isAlreadyExists(error)) {
			return Result.err(
				new RuntimeHostOwnerAcquireFailed({
					message: `Could not acquire Runtime Host ownership at "${lockPath}"`,
					lockPath,
					cause: error,
				}),
			);
		}
		const ownerPid = await ownerPidAt(lockPath);
		if (ownerPid !== undefined && !isProcessAlive(ownerPid)) {
			await unlink(lockPath).catch(() => {});
			return acquire(lockPath, pid);
		}
		return Result.err(
			new RuntimeHostAlreadyOwned({
				message: `A Runtime Host already owns "${lockPath}"`,
				lockPath,
				...(ownerPid === undefined ? {} : { pid: ownerPid }),
			}),
		);
	}
}

class FileRuntimeOwner implements LocalRuntimeOwner {
	#released = false;

	constructor(
		readonly lockPath: string,
		private readonly handle: Awaited<ReturnType<typeof open>>,
	) {}

	async release(): Promise<void> {
		if (this.#released) return;
		this.#released = true;
		await this.handle.close();
		await unlink(this.lockPath).catch(() => {});
	}
}

async function ownerPidAt(lockPath: string): Promise<number | undefined> {
	try {
		const parsed = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
		const pid = (parsed as { readonly pid?: unknown }).pid;
		return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : undefined;
	} catch {
		return undefined;
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return isPermissionDenied(error);
	}
}

function isAlreadyExists(error: unknown): boolean {
	return typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "EEXIST";
}

function isPermissionDenied(error: unknown): boolean {
	return typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "EPERM";
}
