import { execFile } from "node:child_process";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import type {
	DesktopWorkspaceGitChange,
	DesktopWorkspaceGitChangeKind,
	DesktopWorkspaceGitDiff,
	DesktopWorkspaceGitStatus,
} from "../../shared/desktop-rpc";
import { isInside } from "./paths";

const MAX_GIT_OUTPUT_BYTES = 10_000_000;
export const MAX_GIT_DIFF_FILE_BYTES = 1_000_000;

export class WorkspaceGitUnavailable extends TaggedError("workspace_git.unavailable")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}
export class WorkspaceGitStatusFailed extends TaggedError("workspace_git.status_failed")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}
export class WorkspaceGitInvalidOutput extends TaggedError("workspace_git.invalid_output")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}
export class WorkspaceGitDiffFailed extends TaggedError("workspace_git.diff_failed")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export type WorkspaceGitError =
	| WorkspaceGitUnavailable
	| WorkspaceGitStatusFailed
	| WorkspaceGitInvalidOutput
	| WorkspaceGitDiffFailed;

interface GitCommandOutput {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

export type GitProcessRunner = (
	args: readonly string[],
	cwd: string,
) => Promise<ResultType<GitCommandOutput, WorkspaceGitUnavailable | WorkspaceGitStatusFailed>>;

export async function readWorkspaceGitStatus(
	workspaceRoot: string,
	run: GitProcessRunner = runGit,
): Promise<ResultType<DesktopWorkspaceGitStatus, WorkspaceGitError>> {
	const snapshot = await readWorkspaceGitSnapshot(workspaceRoot, run);
	return snapshot.map((value) => value.status);
}

export async function readWorkspaceGitDiff(
	workspaceRoot: string,
	requestedPath: string,
	run: GitProcessRunner = runGit,
): Promise<ResultType<DesktopWorkspaceGitDiff, WorkspaceGitError>> {
	return Result.gen(async function* () {
		const safePath = yield* validRepositoryPath(requestedPath);
		const snapshot = yield* Result.await(readWorkspaceGitSnapshot(workspaceRoot, run));
		if (snapshot.status.kind === "not-repository") {
			return Result.ok({ kind: "not-changed", path: safePath } satisfies DesktopWorkspaceGitDiff);
		}
		const change = snapshot.status.changes.find((candidate) => candidate.path === safePath);
		if (!change) return Result.ok({ kind: "not-changed", path: safePath } satisfies DesktopWorkspaceGitDiff);

		const oldPath = change.oldPath ?? change.path;
		const expectsOld = snapshot.hasHead && change.kind !== "added" && change.kind !== "untracked";
		const expectsNew = change.kind !== "deleted";
		const oldSide = expectsOld
			? yield* Result.await(readHeadFile(snapshot.repositoryRoot, oldPath, run))
			: ({ kind: "missing" } as const);
		const newSide = expectsNew
			? yield* Result.await(readWorktreeFile(snapshot.repositoryRoot, change.path))
			: ({ kind: "missing" } as const);
		const unavailableReason = diffUnavailableReason(oldSide, newSide, expectsOld, expectsNew);
		if (unavailableReason) {
			return Result.ok({
				kind: "unavailable",
				path: change.path,
				...(change.oldPath ? { oldPath: change.oldPath } : {}),
				reason: unavailableReason,
			} satisfies DesktopWorkspaceGitDiff);
		}

		const oldContent = oldSide.kind === "content" ? decodeText(oldSide.value) : Result.ok<string | null>(null);
		const newContent = newSide.kind === "content" ? decodeText(newSide.value) : Result.ok<string | null>(null);
		if (oldContent.isErr() || newContent.isErr()) {
			return Result.ok({
				kind: "unavailable",
				path: change.path,
				...(change.oldPath ? { oldPath: change.oldPath } : {}),
				reason: "invalid-encoding",
			} satisfies DesktopWorkspaceGitDiff);
		}
		return Result.ok({
			kind: "text",
			path: change.path,
			...(change.oldPath ? { oldPath: change.oldPath } : {}),
			changeKind: change.kind,
			oldContent: oldContent.value,
			newContent: newContent.value,
		} satisfies DesktopWorkspaceGitDiff);
	});
}

interface WorkspaceGitSnapshot {
	readonly repositoryRoot: string;
	readonly hasHead: boolean;
	readonly status: DesktopWorkspaceGitStatus;
}

async function readWorkspaceGitSnapshot(
	workspaceRoot: string,
	run: GitProcessRunner,
): Promise<ResultType<WorkspaceGitSnapshot, WorkspaceGitError>> {
	return Result.gen(async function* () {
		const canonicalWorkspaceResult = await Result.tryPromise({
			try: () => realpath(workspaceRoot),
			catch: (cause) => new WorkspaceGitStatusFailed({ message: "Workspace root is unavailable.", cause }),
		});
		const canonicalWorkspaceRoot = yield* canonicalWorkspaceResult;
		const rootResult = yield* Result.await(run(["rev-parse", "--show-toplevel"], canonicalWorkspaceRoot));
		if (rootResult.exitCode !== 0) {
			if (rootResult.stderr.includes("not a git repository")) {
				return Result.ok({
					repositoryRoot: canonicalWorkspaceRoot,
					hasHead: false,
					status: { kind: "not-repository" },
				} satisfies WorkspaceGitSnapshot);
			}
			return yield* Result.err(new WorkspaceGitStatusFailed({ message: "Git repository root could not be read." }));
		}

		const repositoryRootResult = await Result.tryPromise({
			try: () => realpath(rootResult.stdout.trim()),
			catch: (cause) => new WorkspaceGitStatusFailed({ message: "Git repository root is unavailable.", cause }),
		});
		const repositoryRoot = yield* repositoryRootResult;
		if (!path.isAbsolute(repositoryRoot) || !isInside(canonicalWorkspaceRoot, repositoryRoot)) {
			return yield* Result.err(
				new WorkspaceGitInvalidOutput({
					message: "Git returned a repository root outside the workspace boundary.",
				}),
			);
		}

		const statusResult = yield* Result.await(
			run(["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"], repositoryRoot),
		);
		if (statusResult.exitCode !== 0) {
			return yield* Result.err(new WorkspaceGitStatusFailed({ message: "Git status could not be read." }));
		}
		const parsed = parsePorcelainV2(statusResult.stdout);
		if (parsed.isErr()) return yield* parsed;
		return Result.ok({
			repositoryRoot,
			hasHead: parsed.value.hasHead,
			status: {
				kind: "repository",
				rootName: path.basename(repositoryRoot),
				branch: parsed.value.branch,
				detached: parsed.value.detached,
				changes: parsed.value.changes,
			},
		} satisfies WorkspaceGitSnapshot);
	});
}

export function parsePorcelainV2(output: string): ResultType<
	{
		readonly branch: string | null;
		readonly detached: boolean;
		readonly hasHead: boolean;
		readonly changes: readonly DesktopWorkspaceGitChange[];
	},
	WorkspaceGitInvalidOutput
> {
	const records = output.split("\0");
	const changes: DesktopWorkspaceGitChange[] = [];
	let branch: string | null = null;
	let detached = false;
	let hasHead = false;

	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		if (!record) continue;
		if (record.startsWith("# branch.head ")) {
			const head = record.slice("# branch.head ".length);
			detached = head === "(detached)";
			branch = detached ? null : head;
			continue;
		}
		if (record.startsWith("# branch.oid ")) {
			hasHead = record.slice("# branch.oid ".length) !== "(initial)";
			continue;
		}
		if (record.startsWith("# ")) continue;
		if (record.startsWith("? ")) {
			const filePath = validRepositoryPath(record.slice(2));
			if (filePath.isErr()) return filePath;
			changes.push({ path: filePath.value, kind: "untracked", staged: false, unstaged: true });
			continue;
		}
		if (record.startsWith("! ")) continue;

		const recordType = record[0];
		const fieldCount = recordType === "1" ? 8 : recordType === "2" ? 9 : recordType === "u" ? 10 : 0;
		if (fieldCount === 0) return invalidOutput("Git status returned an unknown record type.");
		const fields = splitPrefixFields(record, fieldCount);
		if (fields.isErr()) return fields;
		const xy = fields.value.fields[1];
		if (xy?.length !== 2) return invalidOutput("Git status returned an invalid XY state.");
		const filePath = validRepositoryPath(fields.value.remainder);
		if (filePath.isErr()) return filePath;
		let oldPath: string | undefined;
		if (recordType === "2") {
			const original = records[index + 1];
			if (!original) return invalidOutput("Git rename status omitted the original path.");
			const originalPath = validRepositoryPath(original);
			if (originalPath.isErr()) return originalPath;
			oldPath = originalPath.value;
			index += 1;
		}
		changes.push({
			path: filePath.value,
			...(oldPath ? { oldPath } : {}),
			kind: changeKind(recordType, xy),
			staged: recordType === "u" || xy[0] !== ".",
			unstaged: recordType === "u" || xy[1] !== ".",
		});
	}

	return Result.ok({ branch, detached, hasHead, changes });
}

function splitPrefixFields(
	record: string,
	fieldCount: number,
): ResultType<{ readonly fields: readonly string[]; readonly remainder: string }, WorkspaceGitInvalidOutput> {
	const fields: string[] = [];
	let start = 0;
	for (let index = 0; index < fieldCount; index += 1) {
		const separator = record.indexOf(" ", start);
		if (separator < 0) return invalidOutput("Git status returned an incomplete record.");
		fields.push(record.slice(start, separator));
		start = separator + 1;
	}
	return record.length > start
		? Result.ok({ fields, remainder: record.slice(start) })
		: invalidOutput("Git status returned an empty path.");
}

export function validRepositoryPath(value: string): ResultType<string, WorkspaceGitInvalidOutput> {
	if (
		value.length === 0 ||
		path.posix.isAbsolute(value) ||
		value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
	) {
		return invalidOutput("Git status returned a path outside the repository boundary.");
	}
	return Result.ok(value);
}

type GitFileSide =
	| { readonly kind: "content"; readonly value: Buffer }
	| { readonly kind: "missing" }
	| { readonly kind: "submodule" }
	| { readonly kind: "too-large" };

async function readWorktreeFile(
	repositoryRoot: string,
	filePath: string,
): Promise<ResultType<GitFileSide, WorkspaceGitDiffFailed>> {
	return Result.tryPromise({
		try: async () => {
			const candidate = path.resolve(repositoryRoot, filePath);
			if (!isInside(candidate, repositoryRoot)) {
				throw new WorkspaceGitDiffFailed({ message: "Git diff path escaped the repository." });
			}
			let info: Awaited<ReturnType<typeof lstat>>;
			try {
				info = await lstat(candidate);
			} catch (cause) {
				if (processErrorCode(cause) === "ENOENT") return { kind: "missing" } as const;
				throw cause;
			}
			if (info.isDirectory()) return { kind: "submodule" } as const;
			if (info.isSymbolicLink()) {
				const target = await readlink(candidate);
				return Buffer.byteLength(target) > MAX_GIT_DIFF_FILE_BYTES
					? ({ kind: "too-large" } as const)
					: ({ kind: "content", value: Buffer.from(target) } as const);
			}
			if (!info.isFile()) return { kind: "missing" } as const;
			if (info.size > MAX_GIT_DIFF_FILE_BYTES) return { kind: "too-large" } as const;
			return { kind: "content", value: await readFile(candidate) } as const;
		},
		catch: (cause) =>
			cause instanceof WorkspaceGitDiffFailed
				? cause
				: new WorkspaceGitDiffFailed({ message: "Working tree file could not be read.", cause }),
	});
}

async function readHeadFile(
	repositoryRoot: string,
	filePath: string,
	run: GitProcessRunner,
): Promise<ResultType<GitFileSide, WorkspaceGitError>> {
	const object = `HEAD:${filePath}`;
	const sizeResult = await run(["cat-file", "-s", object], repositoryRoot);
	if (sizeResult.isErr()) return sizeResult;
	if (sizeResult.value.exitCode !== 0) return Result.ok({ kind: "missing" });
	const size = Number(sizeResult.value.stdout.trim());
	if (!Number.isSafeInteger(size) || size < 0) {
		return Result.err(new WorkspaceGitInvalidOutput({ message: "Git returned an invalid blob size." }));
	}
	if (size > MAX_GIT_DIFF_FILE_BYTES) return Result.ok({ kind: "too-large" });
	return Result.tryPromise({
		try: () =>
			new Promise<GitFileSide>((resolve, reject) => {
				execFile(
					"git",
					["cat-file", "blob", object],
					{ cwd: repositoryRoot, encoding: "buffer", maxBuffer: MAX_GIT_DIFF_FILE_BYTES + 1 },
					(error, stdout) => {
						if (error) reject(error);
						else resolve({ kind: "content", value: stdout });
					},
				);
			}),
		catch: (cause) => new WorkspaceGitDiffFailed({ message: "HEAD file could not be read.", cause }),
	});
}

function diffUnavailableReason(
	oldSide: GitFileSide,
	newSide: GitFileSide,
	expectsOld: boolean,
	expectsNew: boolean,
): Extract<DesktopWorkspaceGitDiff, { readonly kind: "unavailable" }>["reason"] | undefined {
	if (oldSide.kind === "too-large" || newSide.kind === "too-large") return "too-large";
	if (oldSide.kind === "submodule" || newSide.kind === "submodule") return "submodule";
	if ((expectsOld && oldSide.kind === "missing") || (expectsNew && newSide.kind === "missing")) return "missing";
	if (
		(oldSide.kind === "content" && oldSide.value.includes(0)) ||
		(newSide.kind === "content" && newSide.value.includes(0))
	)
		return "binary";
	return undefined;
}

function decodeText(value: Buffer): ResultType<string, WorkspaceGitInvalidOutput> {
	return Result.try({
		try: () => new TextDecoder("utf-8", { fatal: true }).decode(value),
		catch: (cause) => new WorkspaceGitInvalidOutput({ message: "Git diff file is not valid UTF-8.", cause }),
	});
}

function changeKind(recordType: string, xy: string): DesktopWorkspaceGitChangeKind {
	if (recordType === "u" || xy.includes("U")) return "conflict";
	if (recordType === "2" || xy.includes("R")) return "renamed";
	if (xy.includes("A")) return "added";
	if (xy.includes("D")) return "deleted";
	return "modified";
}

function invalidOutput(message: string): ResultType<never, WorkspaceGitInvalidOutput> {
	return Result.err(new WorkspaceGitInvalidOutput({ message }));
}

const runGit: GitProcessRunner = (args, cwd) =>
	Result.tryPromise({
		try: () =>
			new Promise<GitCommandOutput>((resolve, reject) => {
				execFile(
					"git",
					args,
					{
						cwd,
						encoding: "utf8",
						maxBuffer: MAX_GIT_OUTPUT_BYTES,
						env: { ...process.env, LC_ALL: "C" },
					},
					(error, stdout, stderr) => {
						if (error && typeof error.code === "string") {
							reject(error);
							return;
						}
						resolve({ exitCode: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
					},
				);
			}),
		catch: (cause) =>
			processErrorCode(cause) === "ENOENT"
				? new WorkspaceGitUnavailable({ message: "The Git executable is unavailable.", cause })
				: new WorkspaceGitStatusFailed({ message: "The Git process failed.", cause }),
	});

function processErrorCode(value: unknown): string | undefined {
	return value && typeof value === "object" && "code" in value && typeof value.code === "string"
		? value.code
		: undefined;
}
