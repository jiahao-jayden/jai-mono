import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "../../../utils/frontmatter.js";
import type { SkillFrontmatter, SkillInfo } from "./types.js";

const SKILL_FILENAME = "SKILL.md";
const MAX_DESCRIPTION_CHARS = 1536;

type SkillSource = SkillInfo["source"];

type ScanDir = {
	path: string;
	source: SkillSource;
};

export function buildScanDirs(cwd: string, jaiHome: string): ScanDir[] {
	return [
		{ path: join(cwd, ".jai", "skills"), source: "project-jai" },
		{ path: join(cwd, ".agents", "skills"), source: "project-agents" },
		{ path: join(jaiHome, "skills"), source: "global-jai" },
		{ path: join(jaiHome, "..", ".agents", "skills"), source: "global-agents" },
	];
}

async function listSubdirs(dir: string): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}
	const out: string[] = [];
	for (const e of entries) {
		const full = join(dir, e.name);
		if (e.isDirectory()) {
			out.push(full);
			continue;
		}
		if (e.isSymbolicLink()) {
			try {
				const s = await stat(full);
				if (s.isDirectory()) out.push(full);
			} catch {
				// dangling link
			}
		}
	}
	return out;
}

async function loadSkill(skillDir: string, source: SkillSource): Promise<SkillInfo | null> {
	const skillFile = join(skillDir, SKILL_FILENAME);
	let raw: string;
	try {
		raw = await readFile(skillFile, "utf8");
	} catch {
		return null;
	}

	const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(raw);
	const dirName = skillDir.split("/").pop() ?? "";
	const name = frontmatter.name ?? dirName;

	if (!name) return null;

	const firstLine = body.split("\n").find((l) => l.trim()) ?? "";
	const rawDesc = frontmatter.description ?? (firstLine.length > 60 ? `${firstLine.slice(0, 60)}...` : firstLine);
	const description = rawDesc.slice(0, MAX_DESCRIPTION_CHARS);

	return {
		name,
		description,
		path: skillFile,
		body,
		frontmatter,
		source,
	};
}

export type DiscoverSkillsOptions = {
	cwd: string;
	jaiHome: string;
	log?: { warn(msg: string): void };
};

export async function discoverSkills(options: DiscoverSkillsOptions): Promise<SkillInfo[]> {
	const scanDirs = buildScanDirs(options.cwd, options.jaiHome);
	const seen = new Map<string, SkillInfo>();

	for (const { path: dirPath, source } of scanDirs) {
		const subdirs = await listSubdirs(dirPath);
		for (const subdir of subdirs) {
			try {
				const skill = await loadSkill(subdir, source);
				if (!skill) continue;
				if (seen.has(skill.name)) continue;
				seen.set(skill.name, skill);
			} catch (err) {
				options.log?.warn(
					`Failed to load skill from ${subdir}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
	}

	return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}
