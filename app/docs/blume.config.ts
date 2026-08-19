import { defineConfig } from "blume";

export default defineConfig({
	title: "Jai Coding Agent",
	description: "在 TypeScript 应用中集成 Jai Coding Agent：模型、会话、权限、工具与公开 API。",
	content: {
		sources: [{ type: "filesystem", root: "content" }],
	},
	navigation: {
		sidebar: {
			display: "group",
		},
	},
});
