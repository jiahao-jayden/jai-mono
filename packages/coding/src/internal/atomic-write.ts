import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new Error("Operation aborted");
}

export async function atomicWrite(
	target: string,
	content: string | Uint8Array,
	signal?: AbortSignal,
): Promise<{ created: boolean }> {
	throwIfAborted(signal);
	const directory = dirname(target);
	await mkdir(directory, { recursive: true });
	throwIfAborted(signal);

	let mode: number | undefined;
	let created = true;
	try {
		const current = await stat(target);
		if (!current.isFile()) throw new Error(`Path is not a file: ${target}`);
		mode = current.mode;
		created = false;
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}

	const temporaryPath = join(directory, `.${basename(target)}.jai-${process.pid}-${randomUUID()}.tmp`);
	try {
		try {
			await writeFile(temporaryPath, content, { signal });
		} catch (error) {
			if (signal?.aborted) throw new Error("Operation aborted");
			throw error;
		}
		if (mode !== undefined) await chmod(temporaryPath, mode);
		throwIfAborted(signal);
		await rename(temporaryPath, target);
		return { created };
	} finally {
		await rm(temporaryPath, { force: true });
	}
}
