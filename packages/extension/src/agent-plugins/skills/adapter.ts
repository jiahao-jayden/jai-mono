import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type {
	AgentPluginComponentAdapter,
	AgentPluginComponentContext,
	AgentPluginComponentResult,
} from "../package/component";
import { containedPath, isInside } from "../package/paths";
import type { AgentPluginSkillDescriptor } from "../package/types";
import type { AgentPluginDiagnostic } from "../shared/diagnostics";
import { parseSkillDocument, validateSkillFrontmatter } from "./document";

export const skillComponentAdapter: AgentPluginComponentAdapter<readonly AgentPluginSkillDescriptor[]> = {
	kind: "skills",
	load: discoverPluginSkills,
};

async function discoverPluginSkills(
	context: AgentPluginComponentContext,
): Promise<AgentPluginComponentResult<readonly AgentPluginSkillDescriptor[]>> {
	const diagnostics: AgentPluginDiagnostic[] = [];
	const skillsRoot = path.join(context.root, "skills");
	const skillsDirectory = await realpath(skillsRoot).catch((error) => {
		if (isNodeError(error, "ENOENT")) return undefined;
		diagnostics.push(componentDiagnostic("plugin_skills_path_invalid", "skills", "skills/ cannot be resolved"));
		return undefined;
	});
	if (!skillsDirectory) return { value: [], diagnostics };
	if (!isInside(skillsDirectory, context.root)) {
		diagnostics.push(componentDiagnostic("plugin_skills_path_escape", "skills", "skills/ escapes Plugin root"));
		return { value: [], diagnostics };
	}
	const directoryInfo = await stat(skillsDirectory).catch(() => undefined);
	if (!directoryInfo?.isDirectory()) {
		diagnostics.push(componentDiagnostic("plugin_skills_path_invalid", "skills", "skills/ must be a directory"));
		return { value: [], diagnostics };
	}
	const entries = await readdir(skillsDirectory, { withFileTypes: true });
	const skills: AgentPluginSkillDescriptor[] = [];
	for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
		const skillDirectory = path.join(skillsDirectory, entry.name);
		const skillDirectoryInfo = await stat(skillDirectory).catch(() => undefined);
		if (!skillDirectoryInfo?.isDirectory()) continue;
		const documentPath = path.join(skillDirectory, "SKILL.md");
		const documentInfo = await stat(documentPath).catch(() => undefined);
		if (!documentInfo?.isFile()) continue;
		try {
			const canonicalDirectory = await containedPath(context.root, skillDirectory, "Skill directory");
			const canonicalDocument = await containedPath(context.root, documentPath, "Skill document");
			const content = await readFile(canonicalDocument, "utf8");
			const { frontmatter } = parseSkillDocument(content);
			const parsed = validateSkillFrontmatter(frontmatter, entry.name);
			skills.push({
				name: parsed.name,
				description: parsed.description,
				contentRevision: createHash("sha256").update(content).digest("hex"),
				location: canonicalDocument,
				directory: canonicalDirectory,
				canonicalDirectory,
				source: {
					scope: "user",
					directory: "plugin",
					pluginName: context.manifest.name,
					...(context.manifest.version ? { pluginVersion: context.manifest.version } : {}),
					pluginRoot: context.root,
				},
				...(parsed.license === undefined ? {} : { license: parsed.license }),
				...(parsed.compatibility === undefined ? {} : { compatibility: parsed.compatibility }),
				allowedTools: parsed.allowedTools,
				metadata: parsed.metadata,
			});
		} catch (error) {
			diagnostics.push({
				...componentDiagnostic(
					"plugin_skill_invalid",
					"skill",
					error instanceof Error ? error.message : "Invalid Skill",
				),
				componentName: entry.name,
				relativePath: path.relative(context.root, documentPath),
			});
		}
	}
	return { value: skills, diagnostics };
}

function componentDiagnostic(code: string, scope: "skills" | "skill", message: string): AgentPluginDiagnostic {
	return { code, severity: "error", scope, message };
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === code;
}
