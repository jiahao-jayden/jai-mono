import { defineConfig } from "blume";

export default defineConfig({
	title: "Jai Coding Agent",
	description: "面向 SDK、CLI 与 WorkBuddy 的 Jai Coding Agent 文档。",
	content: {
		sources: [{ type: "filesystem", root: "content" }],
	},
});
