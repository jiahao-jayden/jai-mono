import { defineConfig } from "blume";

export default defineConfig({
	title: "Jai Coding Agent",
	description: "在 TypeScript 应用中集成 Jai Coding Agent：模型、会话、权限、工具与公开 API。",
	basePath: "/docs",
	content: {
		sources: [{ type: "filesystem", root: "content/docs" }],
	},
	logo: { href: "/docs" },
	navigation: {
		sidebar: {
			display: "group",
		},
	},
	// Standalone `blume dev` has no landing page. The marketing mount does not publish this redirect.
	redirects: [
		{ from: "/guides/permissions", to: "/guides/permissions-and-approval" },
		{ from: "/guides/approval-flow", to: "/guides/permissions-and-approval" },
		{ from: "/guides/tools-and-capabilities", to: "/guides/tools-development" },
	],
});
