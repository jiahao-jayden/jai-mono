import path from "node:path";
import type { DesktopArtifact, DesktopArtifactFormat } from "../../shared/desktop-rpc";

const artifactExtensions: Readonly<Record<string, DesktopArtifactFormat>> = {
	".html": "html",
	".htm": "html",
	".markdown": "markdown",
	".md": "markdown",
	".mdown": "markdown",
	".mkd": "markdown",
};

export function projectArtifact(
	toolName: string,
	args: unknown,
	toolCallId: string,
	updatedAt: number,
): DesktopArtifact | undefined {
	if ((toolName !== "Write" && toolName !== "Edit") || !isRecord(args) || typeof args.path !== "string")
		return undefined;
	const pathValue = args.path.trim();
	if (!pathValue) return undefined;
	const format = artifactExtensions[path.extname(pathValue).toLowerCase()];
	if (!format) return undefined;
	return {
		id: `artifact:${pathValue}`,
		toolCallId,
		path: pathValue,
		format,
		updatedAt,
	};
}

export function sortArtifacts(artifacts: Iterable<DesktopArtifact>): DesktopArtifact[] {
	return [...artifacts].sort((left, right) => right.updatedAt - left.updatedAt);
}

export interface DesktopArtifactCatalog {
	readonly version: 1;
	readonly items: readonly DesktopArtifact[];
}

/**
 * Artifact 元数据属于 session appState，而不是 transcript。
 * 这里只投影 renderer 需要的白名单字段；文件内容仍从工作区读取。
 */
export function projectArtifactCatalog(value: unknown): DesktopArtifact[] {
	if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.items)) return [];
	const items = value.items.flatMap((candidate) => {
		if (!isRecord(candidate)) return [];
		const format = candidate.format === "markdown" || candidate.format === "html" ? candidate.format : undefined;
		if (
			typeof candidate.id !== "string" ||
			typeof candidate.toolCallId !== "string" ||
			typeof candidate.path !== "string" ||
			!format ||
			typeof candidate.updatedAt !== "number" ||
			!Number.isFinite(candidate.updatedAt)
		) {
			return [];
		}
		const artifact: DesktopArtifact = {
			id: candidate.id,
			toolCallId: candidate.toolCallId,
			path: candidate.path,
			format,
			updatedAt: candidate.updatedAt,
		};
		return [artifact];
	});
	return items.length === value.items.length ? sortArtifacts(items) : [];
}

export function artifactCatalog(items: Iterable<DesktopArtifact>): DesktopArtifactCatalog {
	return { version: 1, items: sortArtifacts(items) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
