import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, appendFile, chmod, lstat, mkdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { getErrorMessage } from "@jai/common";
import { TaggedError } from "better-result";
import { fileSystemError, shellError } from "../environment/errors";
import type {
	AbortOptions,
	AtomicWriteOptions,
	ExecutionEnvironment,
	FileStat,
	PathCapability,
	PathCapabilityManager,
	ResolvedPath,
	ResolvePathOptions,
	ShellExecuteOptions,
	ShellResult,
	TempFileOptions,
	TemporaryFile,
} from "../environment/types";
import { isNodeErrorCode, isNotFound, isPermissionDenied } from "./errors";

export interface NodeExecutionEnvironmentOptions {
	cwd: string;
	shellPath?: string;
	shellEnv?: Record<string, string>;
}

interface IssuedPathCapability extends PathCapability {
	readonly boundary: string;
}

interface PathCandidate {
	readonly requestedPath: string;
	readonly canonicalPath: string;
	readonly boundary: string;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw fileSystemError("aborted", "Operation aborted");
}

function isWithin(root: string, target: string): boolean {
	const pathFromRoot = relative(root, target);
	return (
		pathFromRoot === "" ||
		(!isAbsolute(pathFromRoot) && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`))
	);
}

async function canonicalizeMissing(target: string): Promise<string> {
	const missing: string[] = [];
	let current = target;
	while (true) {
		try {
			return join(await realpath(current), ...missing);
		} catch (error) {
			if (!isNotFound(error)) throw error;
			const parent = dirname(current);
			if (parent === current) throw error;
			missing.unshift(basename(current));
			current = parent;
		}
	}
}

async function realpathIfExists(target: string): Promise<string | undefined> {
	try {
		return await realpath(target);
	} catch (error) {
		if (isNotFound(error)) return undefined;
		throw error;
	}
}

async function resolveExecutable(
	command: string,
	environment: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
	const candidates =
		command.includes("/") || command.includes("\\")
			? [command]
			: (environment.PATH ?? "")
					.split(delimiter)
					.filter(Boolean)
					.map((directory) => join(directory, command));
	for (const candidate of candidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {}
	}
	return undefined;
}

function fileSystemFailure(error: unknown, resource: string): never {
	if (TaggedError.is(error)) throw error;
	if (isNotFound(error)) throw fileSystemError("not_found", `Path not found: ${resource}`, { resource, cause: error });
	if (isPermissionDenied(error)) {
		throw fileSystemError("permission_denied", `Permission denied: ${resource}`, { resource, cause: error });
	}
	if (isNodeErrorCode(error, "ABORT_ERR")) {
		throw fileSystemError("aborted", "Operation aborted", { resource, cause: error });
	}
	throw fileSystemError("io_error", getErrorMessage(error) || `I/O failed: ${resource}`, {
		resource,
		cause: error,
	});
}

export class NodeExecutionEnvironment implements ExecutionEnvironment, PathCapabilityManager {
	readonly #cwd: string;
	readonly #shellPath?: string;
	readonly #shellEnv?: Record<string, string>;
	readonly #issuedCapabilities = new WeakSet<PathCapability>();
	readonly #activeCapability = new AsyncLocalStorage<IssuedPathCapability>();

	constructor(options: NodeExecutionEnvironmentOptions) {
		this.#cwd = options.cwd;
		this.#shellPath = options.shellPath;
		this.#shellEnv = options.shellEnv;
	}

	async createPathCapability(input: string, options: ResolvePathOptions): Promise<PathCapability> {
		const candidate = await this.#resolveCandidate(input, options);
		const capability = Object.freeze({
			requestedPath: candidate.requestedPath,
			canonicalPath: candidate.canonicalPath,
			boundary: candidate.boundary,
		});
		this.#issuedCapabilities.add(capability);
		return capability;
	}

	async withPathCapability<T>(capability: PathCapability, operation: () => Promise<T>): Promise<T> {
		if (!this.#issuedCapabilities.has(capability)) {
			throw fileSystemError("outside_boundary", "Path capability was not issued by this environment");
		}
		this.#issuedCapabilities.delete(capability);
		return this.#activeCapability.run(capability as IssuedPathCapability, operation);
	}

	async resolvePath(input: string, options: ResolvePathOptions): Promise<ResolvedPath> {
		const candidate = await this.#resolveCandidate(input, options);
		const lexicalAllowed = isWithin(candidate.boundary, candidate.requestedPath);
		const canonicalAllowed = isWithin(candidate.boundary, candidate.canonicalPath);
		if (!lexicalAllowed || !canonicalAllowed) {
			const capability = this.#activeCapability.getStore();
			if (
				!capability ||
				capability.boundary !== candidate.boundary ||
				capability.requestedPath !== candidate.requestedPath ||
				capability.canonicalPath !== candidate.canonicalPath
			) {
				throw fileSystemError("outside_boundary", `Path escapes workspace: ${input}`, {
					resource: candidate.canonicalPath,
				});
			}
		}
		return { path: candidate.canonicalPath, canonicalPath: candidate.canonicalPath };
	}

	async #resolveCandidate(input: string, options: ResolvePathOptions): Promise<PathCandidate> {
		if (input.length === 0) throw fileSystemError("invalid_path", "Path cannot be empty", { resource: input });
		if (input.includes("\0")) {
			throw fileSystemError("invalid_path", "Path cannot contain NUL", { resource: input });
		}
		throwIfAborted(options.signal);
		try {
			const base = await realpath(resolve(options.base || this.#cwd));
			const boundary = await realpath(resolve(options.boundary));
			const boundaryStat = await stat(boundary);
			if (!boundaryStat.isDirectory()) {
				throw fileSystemError("not_directory", `Workspace root is not a directory: ${options.boundary}`, {
					resource: options.boundary,
				});
			}
			const requested = isAbsolute(input) ? resolve(input) : resolve(base, input);
			const existingPath = await realpathIfExists(requested);
			if (!existingPath && options.mustExist) {
				throw fileSystemError("not_found", `Path not found: ${input}`, { resource: input });
			}
			const canonicalPath = existingPath ?? (await canonicalizeMissing(requested));
			try {
				const targetStat = await stat(canonicalPath);
				if (options.expectedKind === "file" && !targetStat.isFile()) {
					throw fileSystemError("not_file", `Path is not a file: ${input}`, { resource: canonicalPath });
				}
				if (options.expectedKind === "directory" && !targetStat.isDirectory()) {
					throw fileSystemError("not_directory", `Path is not a directory: ${input}`, {
						resource: canonicalPath,
					});
				}
			} catch (error) {
				if (TaggedError.is(error)) throw error;
				if (!isNotFound(error) || options.mustExist) throw error;
			}
			throwIfAborted(options.signal);
			return { requestedPath: requested, canonicalPath, boundary };
		} catch (error) {
			fileSystemFailure(error, input);
		}
	}

	async stat(path: string, options: AbortOptions = {}): Promise<FileStat> {
		throwIfAborted(options.signal);
		try {
			await this.#assertActivePath(path, true);
			const value = await lstat(path);
			return {
				kind: value.isSymbolicLink() ? "symlink" : value.isDirectory() ? "directory" : "file",
				size: value.size,
				mtimeMs: value.mtimeMs,
			};
		} catch (error) {
			fileSystemFailure(error, path);
		}
	}

	async readFile(path: string, options: AbortOptions = {}): Promise<Uint8Array> {
		throwIfAborted(options.signal);
		try {
			const chunks: Uint8Array[] = [];
			for await (const chunk of this.readFileChunks(path, options)) chunks.push(chunk);
			const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
			const result = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				result.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return result;
		} catch (error) {
			fileSystemFailure(error, path);
		}
	}

	async *readFileChunks(path: string, options: AbortOptions = {}): AsyncIterable<Uint8Array> {
		throwIfAborted(options.signal);
		try {
			await this.#assertActivePath(path, true);
			for await (const chunk of createReadStream(path, { signal: options.signal })) {
				yield new Uint8Array(chunk as Buffer);
			}
		} catch (error) {
			fileSystemFailure(error, path);
		}
	}

	async createDirectory(path: string, options: { recursive?: boolean; signal?: AbortSignal } = {}): Promise<void> {
		throwIfAborted(options.signal);
		try {
			await mkdir(path, { recursive: options.recursive });
			throwIfAborted(options.signal);
		} catch (error) {
			fileSystemFailure(error, path);
		}
	}

	async writeFileAtomic(
		path: string,
		content: string | Uint8Array,
		options: AtomicWriteOptions = {},
	): Promise<{ created: boolean }> {
		throwIfAborted(options.signal);
		await this.#assertActivePath(path, false);
		const directory = dirname(path);
		await this.createDirectory(directory, { recursive: true, signal: options.signal });
		let mode: number | undefined;
		let created = true;
		try {
			const current = await stat(path);
			if (!current.isFile()) throw fileSystemError("not_file", `Path is not a file: ${path}`, { resource: path });
			mode = current.mode;
			created = false;
		} catch (error) {
			if (TaggedError.is(error) || !isNotFound(error)) fileSystemFailure(error, path);
		}
		const temporaryPath = join(directory, `.${basename(path)}.jai-${process.pid}-${randomUUID()}.tmp`);
		try {
			await writeFile(temporaryPath, content, { signal: options.signal });
			if (mode !== undefined && options.preserveMode !== false) await chmod(temporaryPath, mode);
			throwIfAborted(options.signal);
			await this.#assertActivePath(path, false);
			await rename(temporaryPath, path);
			return { created };
		} catch (error) {
			fileSystemFailure(error, path);
		} finally {
			await rm(temporaryPath, { force: true }).catch(() => {});
		}
	}

	async createTempFile(options: TempFileOptions = {}): Promise<TemporaryFile> {
		throwIfAborted(options.signal);
		const directory = join(tmpdir(), "jai-tool-output");
		await this.createDirectory(directory, { recursive: true, signal: options.signal });
		const path = join(directory, `${options.prefix ?? "tmp-"}${randomUUID()}${options.suffix ?? ""}`);
		try {
			await writeFile(path, new Uint8Array(), { flag: "wx", signal: options.signal });
		} catch (error) {
			fileSystemFailure(error, path);
		}
		return {
			path,
			append: async (content, appendOptions = {}) => {
				throwIfAborted(appendOptions.signal);
				try {
					await appendFile(path, content);
				} catch (error) {
					fileSystemFailure(error, path);
				}
			},
			remove: async (removeOptions = {}) => {
				throwIfAborted(removeOptions.signal);
				try {
					await rm(path, { force: true });
				} catch (error) {
					fileSystemFailure(error, path);
				}
			},
		};
	}

	async #assertActivePath(path: string, mustExist: boolean): Promise<void> {
		const capability = this.#activeCapability.getStore();
		if (!capability) return;
		let canonicalPath: string;
		try {
			const existing = await realpathIfExists(resolve(path));
			if (!existing && mustExist) {
				throw fileSystemError("not_found", `Path not found: ${path}`, { resource: path });
			}
			canonicalPath = existing ?? (await canonicalizeMissing(resolve(path)));
		} catch (error) {
			fileSystemFailure(error, path);
		}
		if (canonicalPath !== capability.canonicalPath) {
			throw fileSystemError("outside_boundary", "Authorized path changed before execution", {
				resource: canonicalPath,
			});
		}
	}

	async execute(command: string, options: ShellExecuteOptions): Promise<ShellResult> {
		if (options.signal?.aborted) throw shellError("aborted", "Operation aborted");
		const shellCommand = options.shell ?? this.#shellPath ?? process.env.SHELL ?? "/bin/sh";
		const shell = await resolveExecutable(
			shellCommand,
			this.#shellEnv ? { ...process.env, ...this.#shellEnv } : process.env,
		);
		if (!shell) {
			throw shellError("shell_unavailable", `Shell not found: ${shellCommand}`);
		}
		const startedAt = Date.now();
		const child = spawn(shell, ["-lc", command], {
			cwd: options.cwd,
			detached: process.platform !== "win32",
			env: this.#shellEnv ? { ...process.env, ...this.#shellEnv } : process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let spawnError: unknown;
		const completion = new Promise<number | null>((resolve) => {
			child.once("close", resolve);
			child.once("error", (error) => {
				spawnError = error;
				resolve(null);
			});
		});
		let timedOut = false;
		let aborted = false;
		let callbackError: unknown;
		let settled = false;
		let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
		const stop = () => {
			if (!child.pid) return;
			try {
				if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
				else child.kill();
			} catch {
				child.kill();
			}
			forceKillTimer ??= setTimeout(() => {
				try {
					if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
					else child.kill("SIGKILL");
				} catch {}
			}, 1_000);
		};
		const stdoutDecoder = new StringDecoder("utf8");
		const stderrDecoder = new StringDecoder("utf8");
		let outputQueue = Promise.resolve();
		let pendingOutputCallbacks = 0;
		const pauseOutput = () => {
			child.stdout?.pause();
			child.stderr?.pause();
		};
		const resumeOutput = () => {
			if (settled || callbackError) return;
			child.stdout?.resume();
			child.stderr?.resume();
		};
		const enqueueOutput = (stream: "stdout" | "stderr", text: string) => {
			if (!text || callbackError) return;
			pendingOutputCallbacks++;
			pauseOutput();
			outputQueue = outputQueue
				.then(async () => {
					if (!callbackError) await options.onOutput?.({ stream, text });
				})
				.catch((error) => {
					callbackError ??= error;
					child.stdout?.destroy();
					child.stderr?.destroy();
					stop();
				})
				.finally(() => {
					pendingOutputCallbacks--;
					if (pendingOutputCallbacks === 0) resumeOutput();
				});
		};
		const emit = (stream: "stdout" | "stderr", decoder: StringDecoder) => (chunk: Buffer) => {
			enqueueOutput(stream, decoder.write(chunk));
		};
		const onStdout = emit("stdout", stdoutDecoder);
		const onStderr = emit("stderr", stderrDecoder);
		child.stdout?.on("data", onStdout);
		child.stderr?.on("data", onStderr);
		const streamDone = (stream: typeof child.stdout) =>
			new Promise<void>((resolve) => {
				if (!stream || stream.readableEnded || stream.destroyed) {
					resolve();
					return;
				}
				stream.once("end", resolve);
				stream.once("close", resolve);
				stream.once("error", resolve);
			});
		const outputStreamsDone = Promise.all([streamDone(child.stdout), streamDone(child.stderr)]);
		const abort = () => {
			aborted = true;
			stop();
		};
		options.signal?.addEventListener("abort", abort, { once: true });
		const timeout = setTimeout(() => {
			timedOut = true;
			stop();
		}, options.timeoutMs);
		try {
			const exitCode = await completion;
			await outputStreamsDone;
			await outputQueue;
			for (const [stream, decoder] of [
				["stdout", stdoutDecoder],
				["stderr", stderrDecoder],
			] as const) {
				enqueueOutput(stream, decoder.end());
			}
			await outputQueue;
			settled = true;
			if (callbackError) {
				throw shellError("output_callback_failed", "Shell output callback failed", { cause: callbackError });
			}
			if (aborted || options.signal?.aborted) throw shellError("aborted", "Operation aborted");
			if (timedOut) throw shellError("timeout", `Command timed out after ${options.timeoutMs}ms`);
			if (spawnError) {
				throw shellError(
					isNotFound(spawnError) ? "shell_unavailable" : "spawn_failed",
					getErrorMessage(spawnError),
					{ cause: spawnError },
				);
			}
			return { exitCode, durationMs: Date.now() - startedAt };
		} finally {
			settled = true;
			clearTimeout(timeout);
			if (forceKillTimer) clearTimeout(forceKillTimer);
			options.signal?.removeEventListener("abort", abort);
			child.stdout?.off("data", onStdout);
			child.stderr?.off("data", onStderr);
		}
	}
}
