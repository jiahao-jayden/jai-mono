import { defineConfig } from "blume";

export default defineConfig({
	title: "Jai Coding Agent",
	description: "在 TypeScript 应用中集成 Jai Coding Agent：模型、会话、权限、工具与公开 API。",
	content: {
		sources: [{ type: "filesystem", root: "content" }],
	},
	logo: { href: "/docs" },
	navigation: {
		sidebar: {
			display: "group",
		},
	},
	// Standalone `blume dev` has no landing page. The marketing mount does not publish this redirect.
	redirects: [
		{ from: "/", to: "/docs" },
		{ from: "/docs/guides/permissions", to: "/docs/guides/permissions-and-approval" },
		{ from: "/docs/guides/approval-flow", to: "/docs/guides/permissions-and-approval" },
		{ from: "/docs/guides/tools-and-capabilities", to: "/docs/guides/tools-development" },
	],
});
