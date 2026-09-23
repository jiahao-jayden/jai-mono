import { lstat, open, readdir, truncate, unlink } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { DESKTOP_LOG_TAIL_BYTES, type DesktopLogFile, type DesktopLogTail } from "../shared/desktop-rpc";

const LOG_DIRECTORIES = ["desktop", "runtime-host"] as const;
const LOG_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const LOG_ID_PATTERN = /^(desktop|runtime-host)\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ROTATED_LOG_PATTERN =
	/^(?:desktop\/main\.old\.log|runtime-host\/host\.log\.\d+|runtime-host\/telemetry\.jsonl\.\d+)$/;
const ACTIVE_LOGS = new Set(["desktop/main.log", "runtime-host/host.log", "runtime-host/telemetry.jsonl"]);

/** ponytail: 只读末尾 64KB。要看更早的内容再做分页，不要改成整文件读入。 */
export async function listLogFiles(dataDirectory: string): Promise<DesktopLogFile[]> {
	const files: DesktopLogFile[] = [];
	for (const directory of LOG_DIRECTORIES) {
		const dir = resolve(dataDirectory, "logs", directory);
		let names: string[];
		try {
			names = await readdir(dir);
		} catch (error) {
			if (isMissing(error)) continue;
			throw error;
		}
		for (const name of names) {
			if (!LOG_NAME_PATTERN.test(name)) continue;
			const id = `${directory}/${name}`;
			const info = await lstat(resolve(dir, name));
			if (!info.isFile()) continue;
			files.push({
				id,
				name,
				directory,
				bytes: info.size,
				modifiedAt: info.mtimeMs,
				active: ACTIVE_LOGS.has(id),
			});
		}
	}
	files.sort((left, right) => left.id.localeCompare(right.id));
	return files;
}

export async function readLogTail(dataDirectory: string, id: string): Promise<DesktopLogTail> {
	const file = await openLogFile(dataDirectory, id);
	try {
		const info = await file.stat();
		if (!info.isFile()) throw new Error("Log file is unavailable");
		const start = Math.max(0, info.size - DESKTOP_LOG_TAIL_BYTES);
		const length = info.size - start;
		const buffer = Buffer.alloc(length);
		const { bytesRead } = await file.read(buffer, 0, length, start);
		let text = buffer.subarray(0, bytesRead).toString("utf8");
		const truncated = start > 0;
		if (truncated) {
			const newline = text.indexOf("\n");
			if (newline >= 0) text = text.slice(newline + 1);
		}
		return { id, text, truncated, bytes: info.size };
	} finally {
		await file.close();
	}
}

export async function clearLogFile(dataDirectory: string, id: string): Promise<void> {
	const path = resolveLogFile(dataDirectory, id);
	const info = await lstat(path);
	if (!info.isFile()) throw new Error("Log file is unavailable");
	await truncate(path, 0);
}

export async function deleteRotatedLogs(dataDirectory: string): Promise<number> {
	const files = await listLogFiles(dataDirectory);
	let deleted = 0;
	for (const file of files) {
		if (!ROTATED_LOG_PATTERN.test(file.id)) continue;
		await unlink(resolveLogFile(dataDirectory, file.id));
		deleted += 1;
	}
	return deleted;
}

export function resolveLogFile(dataDirectory: string, id: string): string {
	if (!LOG_ID_PATTERN.test(id)) throw new Error("Unknown log file");
	const root = resolve(dataDirectory, "logs");
	const [directory, name] = id.split("/");
	if (!directory || !name) throw new Error("Unknown log file");
	const file = resolve(root, directory, name);
	const fromRoot = relative(root, file);
	if (fromRoot.startsWith("..") || fromRoot.includes(`..${sep}`) || !file.startsWith(`${root}${sep}`)) {
		throw new Error("Unknown log file");
	}
	return file;
}

async function openLogFile(dataDirectory: string, id: string) {
	const path = resolveLogFile(dataDirectory, id);
	const info = await lstat(path);
	if (!info.isFile()) throw new Error("Log file is unavailable");
	return open(path, "r");
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}
