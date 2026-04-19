import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "../../utils/frontmatter.js";

export type CommandTemplate = {
	name: string;
	description: string;
	argumentHint?: string;
	content: string;
	filePath: string;
};

/** Expand $ARGUMENTS placeholder with args string. Only $ARGUMENTS is supported (M1). */
export function expandTemplate(content: string, args: string): string {
	return content.replace(/\$ARGUMENTS/g, args);
}

export async function loadCommandTemplatesFromDir(dir: string): Promise<CommandTemplate[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}

	const results: CommandTemplate[] = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		const filePath = join(dir, entry.name);
		try {
			const raw = await readFile(filePath, "utf8");
			const { frontmatter, body } = parseFrontmatter<{
				description?: string;
				"argument-hint"?: string;
			}>(raw);

			const name = entry.name.replace(/\.md$/, "");
			const firstLine = body.split("\n").find((l) => l.trim()) ?? "";
			const description =
				frontmatter.description ?? (firstLine.length > 60 ? `${firstLine.slice(0, 60)}...` : firstLine);

			results.push({
				name,
				description,
				argumentHint: frontmatter["argument-hint"],
				content: body,
				filePath,
			});
		} catch {
			// Skip malformed files silently; loader logs at the upper level
		}
	}
	return results;
}
