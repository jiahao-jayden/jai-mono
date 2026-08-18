import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import { Language, type Node, Parser } from "web-tree-sitter";
import { bashAlwaysPattern, isDestructiveBashCommand } from "./rules";

export const bashPermissionScanArgument = "__jaiPermissionBashScan";

export interface BashPermissionScan {
	readonly patterns: readonly string[];
	readonly alwaysPatterns: readonly string[];
	readonly destructive: boolean;
	readonly opaque: boolean;
}

class BashParseFailed extends TaggedError("coding_permission.bash_parse_failed")<{
	readonly message: string;
}> {}

let parserPromise: Promise<Parser> | undefined;

export async function scanBashCommand(command: string): Promise<ResultType<BashPermissionScan, BashParseFailed>> {
	try {
		const parser = await getParser();
		const tree = parser.parse(command);
		if (!tree) return Result.err(new BashParseFailed({ message: "Tree-sitter returned no Bash syntax tree" }));
		const patterns = tree.rootNode
			.descendantsOfType("command")
			.filter((node): node is Node => node !== null)
			.map(commandSource)
			.filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
		const opaque = tree.rootNode.hasError || patterns.length === 0;
		return Result.ok({
			patterns,
			alwaysPatterns: patterns.flatMap((pattern) => {
				const always = bashAlwaysPattern(pattern);
				return always ? [always] : [];
			}),
			destructive: isDestructiveBashCommand(command) || patterns.some(isDestructiveBashCommand),
			opaque,
		});
	} catch (cause) {
		return Result.err(
			new BashParseFailed({
				message: cause instanceof Error ? cause.message : "Bash parser initialization failed",
			}),
		);
	}
}

export function bashScanFromArgs(args: Readonly<Record<string, unknown>>): BashPermissionScan | undefined {
	const value = args[bashPermissionScanArgument];
	if (!isRecord(value) || !Array.isArray(value.patterns) || !Array.isArray(value.alwaysPatterns)) return undefined;
	if (typeof value.destructive !== "boolean" || typeof value.opaque !== "boolean") return undefined;
	if (!value.patterns.every((item) => typeof item === "string")) return undefined;
	if (!value.alwaysPatterns.every((item) => typeof item === "string")) return undefined;
	return {
		patterns: value.patterns as string[],
		alwaysPatterns: value.alwaysPatterns as string[],
		destructive: value.destructive,
		opaque: value.opaque,
	};
}

function commandSource(node: Node): string {
	return (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim();
}

/**
 * Locations of the tree-sitter wasm assets. Bundled hosts (Electron main, packaged CLI) cannot
 * resolve these from node_modules at runtime, so they register absolute paths during startup.
 */
let wasmSources: { readonly parser: string; readonly bashLanguage: string } | undefined;

export function setBashParserWasmSources(sources: { readonly parser: string; readonly bashLanguage: string }): void {
	wasmSources = sources;
}

function resolveWasmSources(): { readonly parser: string; readonly bashLanguage: string } {
	if (wasmSources) return wasmSources;
	const require = createRequire(import.meta.url);
	wasmSources = {
		parser: require.resolve("web-tree-sitter/tree-sitter.wasm"),
		bashLanguage: require.resolve("tree-sitter-bash/tree-sitter-bash.wasm"),
	};
	return wasmSources;
}

async function getParser(): Promise<Parser> {
	parserPromise ??= (async () => {
		const sources = resolveWasmSources();
		const [parserWasm, languageWasm] = await Promise.all([
			loadWasmBytes(sources.parser),
			loadWasmBytes(sources.bashLanguage),
		]);
		await Parser.init({ wasmBinary: parserWasm });
		const language = await Language.load(languageWasm);
		const parser = new Parser();
		parser.setLanguage(language);
		return parser;
	})();
	return parserPromise;
}

async function loadWasmBytes(source: string): Promise<Uint8Array> {
	const dataUrlPrefix = "data:application/wasm;base64,";
	if (source.startsWith(dataUrlPrefix)) return Buffer.from(source.slice(dataUrlPrefix.length), "base64");
	return readFile(source.startsWith("file:") ? new URL(source) : source);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
