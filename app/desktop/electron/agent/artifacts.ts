import type { DesktopArtifact } from "../../shared/desktop-rpc";

export function sortArtifacts(artifacts: Iterable<DesktopArtifact>): DesktopArtifact[] {
	return [...artifacts].sort((left, right) => right.updatedAt - left.updatedAt);
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
