import type { AgentMessage } from "@jai/agent";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { renderCapabilityNotice } from "./render";

const skillEntrySchema = Type.Object(
	{ name: Type.String(), description: Type.String() },
	{ additionalProperties: false },
);

/**
 * What the model can reach besides provider tools. It is written into each notice's
 * metadata, so the journal itself records what the current branch was told.
 */
export const capabilityInventorySchema = Type.Object(
	{
		tool: Type.Array(Type.String()),
		mcp: Type.Array(Type.String()),
		skill: Type.Array(skillEntrySchema),
	},
	{ additionalProperties: false },
);

export type CapabilityInventory = Static<typeof capabilityInventorySchema>;
export type CapabilitySkillEntry = Static<typeof skillEntrySchema>;

export const emptyCapabilityInventory: CapabilityInventory = { tool: [], mcp: [], skill: [] };

/** Sorted and deduplicated so rendering and metadata stay byte-stable across refreshes. */
export function createCapabilityInventory(input: {
	readonly tool: Iterable<string>;
	readonly mcp: Iterable<string>;
	readonly skill: Iterable<CapabilitySkillEntry>;
}): CapabilityInventory {
	const skills = new Map<string, CapabilitySkillEntry>();
	for (const entry of input.skill) skills.set(entry.name, { name: entry.name, description: entry.description });
	return {
		tool: [...new Set(input.tool)].sort((a, b) => a.localeCompare(b)),
		mcp: [...new Set(input.mcp)].sort((a, b) => a.localeCompare(b)),
		skill: [...skills.values()].sort((a, b) => a.name.localeCompare(b.name)),
	};
}

/**
 * The Told Inventory: the inventory recorded by the last notice among `messages`. Callers pass
 * the current branch's messages after the latest compaction, so compaction resets it to empty
 * and the next notice lists everything again.
 */
export function foldToldInventory(messages: readonly AgentMessage[]): CapabilityInventory {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message || !("metadata" in message)) continue;
		const value = message.metadata?.capabilityInventory;
		if (value !== undefined && Value.Check(capabilityInventorySchema, value)) return value;
	}
	return emptyCapabilityInventory;
}

export function createCapabilityNotice(
	told: CapabilityInventory,
	current: CapabilityInventory,
	timestamp: number,
): AgentMessage | undefined {
	const content = renderCapabilityNotice(told, current);
	if (!content) return undefined;
	return { role: "user", content, metadata: { synthetic: true, capabilityInventory: current }, timestamp };
}
