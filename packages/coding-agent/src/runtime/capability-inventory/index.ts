/**
 * Capability Inventory: what the model can reach besides provider tools (`tool`: deferred
 * non-MCP tools, `mcp`: MCP tools, `skill`: Agent Skills). The inventory the model was last
 * told is not separate state: it is folded from notice messages in the Session journal.
 */
export {
	type CapabilityInventory,
	type CapabilitySkillEntry,
	createCapabilityInventory,
	createCapabilityNotice,
	emptyCapabilityInventory,
	foldToldInventory,
} from "./inventory";
export { renderCapabilityNotice } from "./render";
