// harness 按能力分目录，每个能力自带契约、实现与对 Agent 的接线。
// 后续 compaction（Spec 16）、skills（Spec 17）各自新增一个同级目录。
export { AgentHarness, type AgentHarnessOptions } from "./agent-harness";
export { type PromptSlot, type PromptSlotContent, renderPrompt } from "./prompt";
export * from "./session";
