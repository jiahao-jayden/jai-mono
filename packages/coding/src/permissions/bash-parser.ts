import { fileURLToPath } from "node:url";
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

async function getParser(): Promise<Parser> {
	parserPromise ??= (async () => {
		const treeSitterWasm = fileURLToPath(import.meta.resolve("web-tree-sitter/tree-sitter.wasm"));
		await Parser.init({ locateFile: () => treeSitterWasm });
		const language = await Language.load(
			fileURLToPath(import.meta.resolve("tree-sitter-bash/tree-sitter-bash.wasm")),
		);
		const parser = new Parser();
		parser.setLanguage(language);
		return parser;
	})();
	return parserPromise;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
