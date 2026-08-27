import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { FileFinder, type FileFinderApi, type GrepCursor, type GrepMode } from "@ff-labs/fff-node";
import { fileSearchError } from "@jai/agent";
import {
	type CodingAgentExtension,
	type CodingExtensionContext,
	CodingExtensionOperationFailed,
	type CodingExtensionTool,
	type CodingExtensionToolResult,
	defineExtension,
} from "@jai/coding-agent";
import { type Static, Type } from "@sinclair/typebox";
import { Result, type Result as ResultType } from "better-result";

const DEFAULT_FIND_LIMIT = 30;
const DEFAULT_GREP_LIMIT = 20;
const MAX_GREP_LIMIT = 50;
const MAX_CONTEXT = 20;
const INDEX_TIMEOUT_MS = 15_000;
const MAX_CURSOR_COUNT = 200;

const findParameters = Type.Object(
	{
		pattern: Type.String({ minLength: 1 }),
		path: Type.Optional(Type.String()),
		exclude: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000 })),
		cursor: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const grepParameters = Type.Object(
	{
		pattern: Type.String({ minLength: 1 }),
		path: Type.Optional(Type.String()),
		exclude: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
		caseSensitive: Type.Optional(Type.Boolean()),
		context: Type.Optional(Type.Integer({ minimum: 0, maximum: MAX_CONTEXT })),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000 })),
		cursor: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

type FindInput = Static<typeof findParameters>;
type GrepInput = Static<typeof grepParameters>;

export interface FffSearchExtensionOptions {
	readonly dataDirectory?: string;
}

interface FindCursor {
	readonly query: string;
	readonly pageSize: number;
	readonly nextPageIndex: number;
}

export class FffSearchRuntime {
	readonly #finder: FileFinderApi;
	readonly #findCursors = new Map<string, FindCursor>();
	readonly #grepCursors = new Map<string, GrepCursor>();
	#nextCursor = 0;

	constructor(finder: FileFinderApi) {
		this.#finder = finder;
	}

	async find(input: FindInput, signal?: AbortSignal): Promise<CodingExtensionToolResult> {
		throwIfAborted(signal);
		const resumed = input.cursor ? this.#findCursors.get(input.cursor) : undefined;
		if (input.cursor && !resumed) throw fileSearchError("search_failed", "Unknown find cursor");
		const query = resumed?.query ?? buildQuery(input.path, input.pattern, input.exclude);
		const pageSize = resumed?.pageSize ?? Math.max(1, input.limit ?? DEFAULT_FIND_LIMIT);
		const pageIndex = resumed?.nextPageIndex ?? 0;
		const result = this.#finder.fileSearch(query, { pageIndex, pageSize });
		if (!result.ok) throw fileSearchError("search_failed", result.error);
		throwIfAborted(signal);

		const nextCursor =
			result.value.totalMatched > pageIndex * pageSize + result.value.items.length
				? this.#storeFindCursor({ query, pageSize, nextPageIndex: pageIndex + 1 })
				: undefined;
		const text = result.value.items.length
			? result.value.items
					.map((item) => `${item.relativePath}${annotation(item.gitStatus, item.totalFrecencyScore)}`)
					.join("\n")
			: "No files found matching pattern";
		return {
			content: [{ type: "text", text: appendCursor(text, nextCursor) }],
			details: {
				count: result.value.items.length,
				totalMatched: result.value.totalMatched,
				...(nextCursor ? { cursor: nextCursor } : {}),
			},
		};
	}

	async grep(input: GrepInput, signal?: AbortSignal): Promise<CodingExtensionToolResult> {
		throwIfAborted(signal);
		const cursor = input.cursor ? this.#grepCursors.get(input.cursor) : undefined;
		if (input.cursor && !cursor) throw fileSearchError("search_failed", "Unknown grep cursor");
		const pattern = input.pattern;
		const mode = resolveGrepMode(pattern);
		const query = buildQuery(input.path, pattern, input.exclude);
		const limit = Math.min(MAX_GREP_LIMIT, Math.max(1, input.limit ?? DEFAULT_GREP_LIMIT));
		const context = Math.min(MAX_CONTEXT, Math.max(0, input.context ?? 0));
		const result = this.#finder.grep(query, {
			mode,
			smartCase: input.caseSensitive !== true,
			pageSize: limit,
			maxMatchesPerFile: limit,
			cursor: cursor ?? null,
			beforeContext: context,
			afterContext: context,
			classifyDefinitions: false,
		});
		if (!result.ok) throw fileSearchError("search_failed", result.error);
		if (result.value.regexFallbackError) {
			throw fileSearchError("invalid_pattern", result.value.regexFallbackError);
		}
		throwIfAborted(signal);

		const nextCursor = result.value.nextCursor ? this.#storeGrepCursor(result.value.nextCursor) : undefined;
		const text = formatGrep(
			result.value.items.map((item) => ({
				path: item.relativePath,
				line: item.lineNumber,
				text: item.lineContent,
				before: item.contextBefore ?? [],
				after: item.contextAfter ?? [],
				gitStatus: item.gitStatus,
				score: item.totalFrecencyScore,
			})),
		);
		return {
			content: [{ type: "text", text: appendCursor(text, nextCursor) }],
			details: {
				matches: result.value.totalMatched,
				totalFiles: result.value.totalFiles,
				...(nextCursor ? { cursor: nextCursor } : {}),
			},
		};
	}

	close(): void {
		this.#findCursors.clear();
		this.#grepCursors.clear();
		this.#finder.destroy();
	}

	#storeFindCursor(cursor: FindCursor): string {
		const id = `fff_c${++this.#nextCursor}`;
		this.#findCursors.set(id, cursor);
		trimCursors(this.#findCursors);
		return id;
	}

	#storeGrepCursor(cursor: GrepCursor): string {
		const id = `fff_c${++this.#nextCursor}`;
		this.#grepCursors.set(id, cursor);
		trimCursors(this.#grepCursors);
		return id;
	}
}

export function createFffSearchExtension(
	options: FffSearchExtensionOptions = {},
): CodingAgentExtension<any, any, FffSearchRuntime> {
	let runtime: FffSearchRuntime | undefined;
	const findTool: CodingExtensionTool<any, any, FffSearchRuntime, typeof findParameters> = {
		name: "fffind",
		description:
			"Fuzzy file and path search. Results are ranked by frecency and Git status, with cursor pagination for large result sets.",
		parameters: findParameters,
		authorization: {
			owner: "core",
			permission: { sideEffect: "read", dataSensitivity: "sensitive", reason: "Search workspace files" },
		},
		presentation: {
			activityKind: "search",
			title: (_runtime, args) => `Find ${stringArgument(args, "pattern") ?? "files"}`,
		},
		executionMode: "parallel",
		execute: (active, call) => active.instance.find(call.args as FindInput, call.signal),
	};
	const grepTool: CodingExtensionTool<any, any, FffSearchRuntime, typeof grepParameters> = {
		name: "ffgrep",
		description:
			"Search file contents with smart-case literal or regex matching. Results are grouped by file and support cursor pagination.",
		parameters: grepParameters,
		authorization: {
			owner: "core",
			permission: { sideEffect: "read", dataSensitivity: "sensitive", reason: "Search workspace contents" },
		},
		presentation: {
			activityKind: "search",
			title: (_runtime, args) => `Search ${stringArgument(args, "pattern") ?? "files"}`,
		},
		executionMode: "parallel",
		execute: (active, call) => active.instance.grep(call.args as GrepInput, call.signal),
	};

	return defineExtension({
		id: "jai.fff-search",
		tools: [findTool, grepTool],
		lifecycle: {
			activate: async (context) => {
				const created = await createFinder(context, options);
				if (created.isErr()) return created;
				const next = new FffSearchRuntime(created.value);
				runtime = next;
				return Result.ok(next);
			},
			deactivate: (active) => {
				active.instance.close();
				if (runtime === active.instance) runtime = undefined;
			},
		},
	});
}

async function createFinder(
	context: CodingExtensionContext,
	options: FffSearchExtensionOptions,
): Promise<ResultType<FileFinderApi, CodingExtensionOperationFailed>> {
	try {
		const dataDirectory = options.dataDirectory;
		if (dataDirectory) await mkdir(dataDirectory, { recursive: true });
		const created = FileFinder.create({
			basePath: context.cwd,
			aiMode: true,
			enableFsRootScanning: false,
			enableHomeDirScanning: false,
			...(dataDirectory
				? {
						frecencyDbPath: join(dataDirectory, "frecency"),
						historyDbPath: join(dataDirectory, "history"),
					}
				: {}),
		});
		if (!created.ok) {
			return Result.err(
				new CodingExtensionOperationFailed({ message: `FFF could not initialize: ${created.error}` }),
			);
		}
		const ready = await created.value.waitForIndexReady(INDEX_TIMEOUT_MS);
		if (!ready.ok || !ready.value) {
			created.value.destroy();
			return Result.err(
				new CodingExtensionOperationFailed({ message: ready.ok ? "FFF index did not become ready" : ready.error }),
			);
		}
		return Result.ok(created.value);
	} catch (cause) {
		return Result.err(new CodingExtensionOperationFailed({ message: "FFF could not initialize", cause }));
	}
}

function buildQuery(path: string | undefined, pattern: string, exclude: string | string[] | undefined): string {
	const constraints = path ? [validateConstraint(path)] : [];
	const excludes = typeof exclude === "string" ? [exclude] : (exclude ?? []);
	for (const value of excludes) constraints.push(`!${validateConstraint(value)}`);
	return [...constraints, pattern].filter(Boolean).join(" ");
}

function validateConstraint(value: string): string {
	const trimmed = value.trim();
	if (
		!trimmed ||
		trimmed.startsWith("/") ||
		trimmed.startsWith("~") ||
		trimmed === ".." ||
		trimmed.startsWith("../") ||
		trimmed.includes("/../")
	) {
		throw fileSearchError("outside_boundary", `Search path must stay inside the workspace: ${value}`);
	}
	return trimmed;
}

function resolveGrepMode(pattern: string): GrepMode {
	const hasRegexSyntax = /[.*+?^${}()|[\]\\]/.test(pattern);
	if (!hasRegexSyntax) return "plain";
	try {
		new RegExp(pattern);
		return "regex";
	} catch (cause) {
		throw fileSearchError("invalid_pattern", `Invalid regular expression: ${pattern}`, { cause });
	}
}

function formatGrep(
	items: readonly {
		path: string;
		line: number;
		text: string;
		before: readonly string[];
		after: readonly string[];
		gitStatus: string;
		score: number;
	}[],
): string {
	if (items.length === 0) return "No matches found";
	const lines: string[] = [];
	let currentPath = "";
	for (const item of items) {
		if (item.path !== currentPath) {
			if (lines.length > 0) lines.push("");
			currentPath = item.path;
			lines.push(`${item.path}${annotation(item.gitStatus, item.score)}`);
		}
		item.before.forEach((line, index) =>
			lines.push(` ${item.line - item.before.length + index}- ${truncateLine(line)}`),
		);
		lines.push(` ${item.line}: ${truncateLine(item.text)}`);
		item.after.forEach((line, index) => lines.push(` ${item.line + index + 1}- ${truncateLine(line)}`));
	}
	return lines.join("\n");
}

function appendCursor(text: string, cursor: string | undefined): string {
	return cursor ? `${text}\n\n[Continue with cursor="${cursor}"]` : text;
}

function annotation(gitStatus: string, frecency: number): string {
	if (gitStatus && gitStatus !== "clean" && gitStatus !== "unknown") return `  [${gitStatus} in git]`;
	if (frecency >= 25) return "  [VERY often touched file]";
	if (frecency >= 20) return "  [often touched file]";
	return "";
}

function truncateLine(value: string): string {
	const trimmed = value.trim();
	return trimmed.length <= 500 ? trimmed : `${trimmed.slice(0, 500)}...`;
}

function trimCursors<T>(cursors: Map<string, T>): void {
	while (cursors.size > MAX_CURSOR_COUNT) {
		const first = cursors.keys().next().value;
		if (!first) return;
		cursors.delete(first);
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw fileSearchError("aborted", "Operation aborted");
}

function stringArgument(args: unknown, key: string): string | undefined {
	if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === "string" && value.trim() ? value : undefined;
}
