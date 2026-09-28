import type { CapabilityInventory, CapabilitySkillEntry } from "./inventory";

const TOOL_GUIDE =
	"These tools are loaded on demand. Search a name with SearchTools to get its toolRef and input schema, then call ExecuteTool. A toolRef stays valid for the whole session.";
const MCP_GUIDE =
	"These MCP tools are loaded on demand. Search a name with SearchTools to get its toolRef and input schema, then call ExecuteTool. A toolRef stays valid for the whole session.";
const SKILL_GUIDE = "Load a skill with the Skill tool before following it.";

/**
 * Renders the difference between what the branch was told and what exists now. A kind that was
 * never told is listed in full; otherwise only Added/Removed (and Updated for skills) appear.
 * Returns undefined when nothing changed so callers append no message at all.
 */
export function renderCapabilityNotice(told: CapabilityInventory, current: CapabilityInventory): string | undefined {
	const sections = [
		renderNames("tool", TOOL_GUIDE, told.tool, current.tool, (names) => names.map((name) => `- ${name}`)),
		renderNames("mcp", MCP_GUIDE, told.mcp, current.mcp, renderMcpGroups),
		renderSkills(told.skill, current.skill),
	].filter((section): section is string => section !== undefined);
	return sections.length > 0 ? sections.join("\n") : undefined;
}

function renderNames(
	tag: string,
	guide: string,
	told: readonly string[],
	current: readonly string[],
	render: (names: readonly string[]) => string[],
): string | undefined {
	const toldSet = new Set(told);
	const currentSet = new Set(current);
	const added = current.filter((name) => !toldSet.has(name));
	const removed = told.filter((name) => !currentSet.has(name));
	if (added.length === 0 && removed.length === 0) return undefined;
	const lines = [`<${tag}>`, guide];
	if (told.length === 0) {
		lines.push(...render(added));
	} else {
		if (added.length > 0) lines.push("Added:", ...render(added));
		if (removed.length > 0) lines.push("Removed:", ...render(removed));
	}
	lines.push(`</${tag}>`);
	return lines.join("\n");
}

function renderSkills(
	told: readonly CapabilitySkillEntry[],
	current: readonly CapabilitySkillEntry[],
): string | undefined {
	const toldByName = new Map(told.map((entry) => [entry.name, entry.description]));
	const currentNames = new Set(current.map((entry) => entry.name));
	const added = current.filter((entry) => !toldByName.has(entry.name));
	const updated = current.filter((entry) => {
		const previous = toldByName.get(entry.name);
		return previous !== undefined && previous !== entry.description;
	});
	const removed = told.filter((entry) => !currentNames.has(entry.name));
	if (added.length === 0 && updated.length === 0 && removed.length === 0) return undefined;
	const describe = (entries: readonly CapabilitySkillEntry[]) =>
		entries.map((entry) => `- ${entry.name}: ${entry.description}`);
	const lines = ["<skill>", SKILL_GUIDE];
	if (told.length === 0) {
		lines.push(...describe(added));
	} else {
		if (added.length > 0) lines.push("Added:", ...describe(added));
		if (updated.length > 0) lines.push("Updated:", ...describe(updated));
		if (removed.length > 0) lines.push("Removed:", ...removed.map((entry) => `- ${entry.name}`));
	}
	lines.push("</skill>");
	return lines.join("\n");
}

/** MCP tools are named `mcp__<namespace>__<server>__<tool>`; each server is listed once. */
function renderMcpGroups(names: readonly string[]): string[] {
	const groups = new Map<string, string[]>();
	for (const name of names) {
		const parts = name.split("__");
		const server = parts.length >= 4 && parts[0] === "mcp" ? parts[2] : undefined;
		const group = server || name;
		const tools = groups.get(group) ?? [];
		if (server) tools.push(parts.slice(3).join("__"));
		groups.set(group, tools);
	}
	return [...groups]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([group, tools]) =>
			tools.length > 0 ? `- ${group}: ${tools.sort((a, b) => a.localeCompare(b)).join(", ")}` : `- ${group}`,
		);
}
