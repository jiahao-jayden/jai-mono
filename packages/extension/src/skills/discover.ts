import { CodingSkillCatalog, type CodingSkillCatalogOptions } from "./catalog";
import { CodingPromptCommandCatalog } from "./command-catalog";

/**
 * Safe command metadata for a host UI. It intentionally excludes catalog
 * locations and plugin-provided Skills, neither of which is a slash target.
 */
export interface SkillsCommandDescriptor {
	readonly name: string;
	readonly displayName: string;
	readonly description: string;
	readonly kind: "file" | "skill";
	readonly argumentHint?: string;
}

/**
 * Reads the Commands a host may offer before an Operation exists. Catalogs
 * are closed immediately: discovery has no handlers, tools, or watchers.
 */
export async function discoverSkillsCommands(
	options: CodingSkillCatalogOptions,
): Promise<readonly SkillsCommandDescriptor[]> {
	const skillCatalog = new CodingSkillCatalog(options);
	const commandCatalog = new CodingPromptCommandCatalog(options);
	try {
		await Promise.all([skillCatalog.load(), commandCatalog.load()]);
		const skills = skillCatalog.snapshot.skills
			.filter((skill) => skill.source.directory !== "plugin")
			.map((skill) => ({
				name: `skill:${skill.name}`,
				displayName: `skill:${skill.name}`,
				description: `Load the ${skill.name} Skill into the current prompt`,
				kind: "skill" as const,
			}));
		const commands = commandCatalog.snapshot.commands.map((command) => ({
			name: command.name,
			displayName: command.displayName,
			description: command.description,
			kind: "file" as const,
			...(command.argumentHint === undefined ? {} : { argumentHint: command.argumentHint }),
		}));
		return [...commands, ...skills].toSorted((left, right) => left.name.localeCompare(right.name));
	} finally {
		skillCatalog.close();
		commandCatalog.close();
	}
}
