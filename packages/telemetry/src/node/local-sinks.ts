import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { TelemetrySink, TelemetrySpanRecord } from "../core/contracts";

export interface TelemetryTextOutput {
	write(text: string): unknown;
}

/** 当前日志文件之外，最多保留多少个较旧的轮转副本。 */
export interface JsonlFileTelemetrySinkOptions {
	readonly maxBytes: number;
	readonly maxFiles: number;
	readonly path: string;
}

/** 仅写 stderr；宿主负责传入与协议 stdout 完全分离的输出流。 */
export function createJsonlStderrTelemetrySink(output: TelemetryTextOutput): TelemetrySink {
	return {
		record(record): void {
			output.write(serializeRecord(record));
		},
	};
}

/** 写入可删除的 JSONL 诊断文件；它不读取、不恢复，也不拥有领域事实。 */
export function createJsonlFileTelemetrySink(options: JsonlFileTelemetrySinkOptions): TelemetrySink {
	return new JsonlFileTelemetrySink(options);
}

class JsonlFileTelemetrySink implements TelemetrySink {
	#writeTail: Promise<void> = Promise.resolve();

	constructor(private readonly options: JsonlFileTelemetrySinkOptions) {
		assertFileOptions(options);
	}

	record(record: TelemetrySpanRecord): Promise<void> {
		const write = this.#writeTail.then(() => this.#append(record));
		this.#writeTail = write.catch(() => undefined);
		return write;
	}

	async #append(record: TelemetrySpanRecord): Promise<void> {
		const line = serializeRecord(record);
		const bytes = Buffer.byteLength(line);
		if (bytes > this.options.maxBytes) return;
		await mkdir(dirname(this.options.path), { recursive: true });
		const existingBytes = await existingFileSize(this.options.path);
		if (existingBytes > 0 && existingBytes + bytes > this.options.maxBytes) {
			await rotateFile(this.options);
		}
		await appendFile(this.options.path, line, "utf8");
	}
}

function serializeRecord(record: TelemetrySpanRecord): string {
	const serialized = JSON.stringify(record);
	if (serialized === undefined) throw new TypeError("Telemetry sink received an unserializable span record");
	return `${serialized}\n`;
}

function assertFileOptions(options: JsonlFileTelemetrySinkOptions): void {
	if (!options.path.trim()) throw new TypeError("Telemetry JSONL path must not be empty");
	if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
		throw new RangeError("Telemetry JSONL maxBytes must be a positive integer");
	}
	if (!Number.isSafeInteger(options.maxFiles) || options.maxFiles < 0) {
		throw new RangeError("Telemetry JSONL maxFiles must be a non-negative integer");
	}
}

async function existingFileSize(path: string): Promise<number> {
	try {
		return (await stat(path)).size;
	} catch (error) {
		if (isMissingFileError(error)) return 0;
		throw error;
	}
}

async function rotateFile(options: JsonlFileTelemetrySinkOptions): Promise<void> {
	if (options.maxFiles === 0) {
		await rm(options.path, { force: true });
		return;
	}
	await rm(`${options.path}.${options.maxFiles}`, { force: true });
	for (let index = options.maxFiles - 1; index >= 1; index -= 1) {
		await renameIfPresent(`${options.path}.${index}`, `${options.path}.${index + 1}`);
	}
	await renameIfPresent(options.path, `${options.path}.1`);
}

async function renameIfPresent(source: string, destination: string): Promise<void> {
	try {
		await rename(source, destination);
	} catch (error) {
		if (isMissingFileError(error)) return;
		throw error;
	}
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}
