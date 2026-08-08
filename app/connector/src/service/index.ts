import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Result, type Result as ResultType } from "better-result";
import {
	ConnectorRuntimeConfigInvalid,
	ConnectorRuntimeDiscoveryInvalid,
	ConnectorRuntimeLockUnavailable,
} from "../errors";
import { startConnectorHttpServer } from "../http";
import type { ConnectorService } from "../types";

export interface ConnectorRuntimePaths {
	readonly rootDirectory: string;
	readonly discoveryFile: string;
	readonly runtimeTokenFile: string;
	readonly lockFile: string;
	readonly logDirectory: string;
	readonly stateDirectory: string;
}

export interface ConnectorDiscoveryDocument {
	readonly protocolVersion: 1;
	readonly endpoint: string;
	readonly pid: number;
	readonly instanceId: string;
	readonly readyAt: number;
}

export interface ManagedConnectorServiceOptions {
	readonly paths?: Partial<ConnectorRuntimePaths>;
	readonly homeDirectory?: string;
	readonly host?: string;
	readonly port?: number;
}

export interface ManagedConnectorService {
	readonly discovery: ConnectorDiscoveryDocument;
	readonly runtimeToken: string;
	readonly close: () => Promise<void>;
}

interface HeldLock {
	readonly close: () => Promise<void>;
}

export function resolveConnectorRuntimePaths(homeDirectory = homedir()): ConnectorRuntimePaths {
	const rootDirectory = join(homeDirectory, ".jai", "connector");
	return {
		rootDirectory,
		discoveryFile: join(rootDirectory, "service.json"),
		runtimeTokenFile: join(rootDirectory, "runtime-token"),
		lockFile: join(rootDirectory, "service.lock"),
		logDirectory: join(rootDirectory, "logs"),
		stateDirectory: join(rootDirectory, "state"),
	};
}

export async function startManagedConnectorService(
	service: ConnectorService,
	options: ManagedConnectorServiceOptions = {},
): Promise<ResultType<ManagedConnectorService, ConnectorRuntimeConfigInvalid | ConnectorRuntimeLockUnavailable>> {
	const paths = resolveConnectorRuntimePathsWithOverrides(options.homeDirectory, options.paths);
	const pathError = validatePaths(paths);
	if (pathError) return Result.err(pathError);
	await mkdir(paths.rootDirectory, { recursive: true, mode: 0o700 });
	await mkdir(paths.logDirectory, { recursive: true, mode: 0o700 });
	await mkdir(paths.stateDirectory, { recursive: true, mode: 0o700 });
	const lock = await acquireLock(paths.lockFile);
	if (lock.isErr()) return lock;
	const runtimeToken = randomBytes(32).toString("base64url");
	const instanceId = randomUUID();
	try {
		await writeSecret(paths.runtimeTokenFile, runtimeToken);
		const http = await startConnectorHttpServer(service, {
			host: options.host ?? "127.0.0.1",
			port: options.port ?? 0,
			runtimeToken,
		});
		const discovery: ConnectorDiscoveryDocument = {
			protocolVersion: 1,
			endpoint: http.url,
			pid: process.pid,
			instanceId,
			readyAt: Date.now(),
		};
		await writeJsonAtomically(paths.discoveryFile, discovery, 0o600);
		let closed = false;
		return Result.ok({
			discovery,
			runtimeToken,
			close: async () => {
				if (closed) return;
				closed = true;
				await http.close().catch(() => {});
				const current = await readDiscovery(paths.discoveryFile);
				if (current.isOk() && current.value.instanceId === instanceId)
					await rm(paths.discoveryFile, { force: true });
				await rm(paths.runtimeTokenFile, { force: true });
				await lock.value.close();
			},
		});
	} catch (error) {
		await rm(paths.runtimeTokenFile, { force: true });
		await lock.value.close();
		throw error;
	}
}

export async function readConnectorDiscovery(
	pathsOrFile: Pick<ConnectorRuntimePaths, "discoveryFile"> | string,
): Promise<ResultType<ConnectorDiscoveryDocument, ConnectorRuntimeDiscoveryInvalid>> {
	const file = typeof pathsOrFile === "string" ? pathsOrFile : pathsOrFile.discoveryFile;
	return readDiscovery(file);
}

export async function readConnectorRuntimeToken(
	pathsOrFile: Pick<ConnectorRuntimePaths, "runtimeTokenFile"> | string,
): Promise<ResultType<string, ConnectorRuntimeConfigInvalid>> {
	const file = typeof pathsOrFile === "string" ? pathsOrFile : pathsOrFile.runtimeTokenFile;
	try {
		const token = (await readFile(file, "utf8")).trim();
		if (!token)
			return Result.err(
				new ConnectorRuntimeConfigInvalid({
					message: "Connector runtime token is empty",
					data: { reason: "token_empty", path: file },
				}),
			);
		return Result.ok(token);
	} catch (cause) {
		return Result.err(
			new ConnectorRuntimeConfigInvalid({
				message: "Connector runtime token could not be read",
				data: { reason: "token_unreadable", path: file },
				cause,
			}),
		);
	}
}

async function readDiscovery(
	file: string,
): Promise<ResultType<ConnectorDiscoveryDocument, ConnectorRuntimeDiscoveryInvalid>> {
	try {
		const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
		if (!isDiscovery(parsed)) {
			return Result.err(
				new ConnectorRuntimeDiscoveryInvalid({
					message: "Connector discovery file is invalid",
					data: { discoveryFile: file, reason: "schema" },
				}),
			);
		}
		return Result.ok(parsed);
	} catch (cause) {
		return Result.err(
			new ConnectorRuntimeDiscoveryInvalid({
				message: "Connector discovery file could not be read",
				data: { discoveryFile: file, reason: "unreadable" },
				cause,
			}),
		);
	}
}

async function acquireLock(
	lockFile: string,
	reclaimed = false,
): Promise<ResultType<HeldLock, ConnectorRuntimeLockUnavailable>> {
	try {
		const handle = await open(lockFile, "wx", 0o600);
		await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: Date.now() })}\n`, "utf8");
		await handle.close();
		let released = false;
		return Result.ok({
			close: async () => {
				if (released) return;
				released = true;
				await rm(lockFile, { force: true });
			},
		});
	} catch (cause) {
		if (isNodeError(cause, "EEXIST")) {
			if (!reclaimed && (await isStaleLock(lockFile))) {
				await rm(lockFile, { force: true });
				return acquireLock(lockFile, true);
			}
			return Result.err(
				new ConnectorRuntimeLockUnavailable({
					message: "Another Connector Service instance owns the runtime lock",
					data: { lockFile },
				}),
			);
		}
		throw cause;
	}
}

async function isStaleLock(lockFile: string): Promise<boolean> {
	try {
		const parsed: unknown = JSON.parse(await readFile(lockFile, "utf8"));
		if (!isRecord(parsed) || typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0)
			return true;
		try {
			process.kill(parsed.pid, 0);
			return false;
		} catch (error) {
			return isNodeError(error, "ESRCH");
		}
	} catch {
		return true;
	}
}

export function resolveConnectorRuntimePathsWithOverrides(
	homeDirectory = homedir(),
	overrides?: Partial<ConnectorRuntimePaths>,
): ConnectorRuntimePaths {
	const base = resolveConnectorRuntimePaths(homeDirectory);
	const rootDirectory =
		overrides?.rootDirectory ?? (overrides?.discoveryFile ? dirname(overrides.discoveryFile) : base.rootDirectory);
	const derived =
		overrides?.rootDirectory || overrides?.discoveryFile ? resolveConnectorRuntimePaths(rootDirectory) : base;
	return { ...derived, ...overrides, rootDirectory };
}

function validatePaths(paths: ConnectorRuntimePaths): ConnectorRuntimeConfigInvalid | undefined {
	for (const [key, value] of Object.entries(paths)) {
		if (!value)
			return new ConnectorRuntimeConfigInvalid({
				message: "Connector runtime path is empty",
				data: { reason: "path_empty", path: key },
			});
	}
}

async function writeSecret(file: string, value: string): Promise<void> {
	await mkdir(dirname(file), { recursive: true, mode: 0o700 });
	await writeFile(file, `${value}\n`, { encoding: "utf8", mode: 0o600 });
	await chmod(file, 0o600);
}

async function writeJsonAtomically(file: string, value: unknown, mode: number): Promise<void> {
	await mkdir(dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
		await chmod(temporary, mode);
		await rename(temporary, file);
	} finally {
		await rm(temporary, { force: true });
	}
}

function isDiscovery(value: unknown): value is ConnectorDiscoveryDocument {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return (
		record.protocolVersion === 1 &&
		typeof record.endpoint === "string" &&
		typeof record.pid === "number" &&
		Number.isInteger(record.pid) &&
		typeof record.instanceId === "string" &&
		typeof record.readyAt === "number"
	);
}

function isNodeError(value: unknown, code: string): boolean {
	return typeof value === "object" && value !== null && "code" in value && value.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
