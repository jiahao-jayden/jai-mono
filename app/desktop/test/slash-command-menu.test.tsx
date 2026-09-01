import { describe, expect, test } from "bun:test";
import { IntlProvider } from "react-intl";
import { renderToStaticMarkup as renderToStaticMarkupBase } from "react-dom/server";
import type { ReactNode } from "react";
import enMessages from "../src/i18n/compiled/en.json";
import {
	filterSlashCommands,
	slashCommandQuery,
	SlashCommandMenu,
} from "../src/components/shell/chat/slash-command-menu";

function renderToStaticMarkup(node: ReactNode): string {
	return renderToStaticMarkupBase(<IntlProvider locale="en" messages={enMessages}>{node}</IntlProvider>);
}

const commands = [
	{ name: "skill:review", displayName: "skill:review", description: "Review changes", commandKind: "skill" as const },
	{ name: "summarize", displayName: "summarize", description: "Summarize a target", commandKind: "file" as const },
];

describe("SlashCommandMenu", () => {
	test("仅在第一个 token 是 slash command 时筛选", () => {
		expect(slashCommandQuery("/skill:r")).toBe("skill:r");
		expect(slashCommandQuery("/skill:review target")).toBeUndefined();
		expect(slashCommandQuery("explain /review")).toBeUndefined();
		expect(filterSlashCommands(commands, "skill").map((command) => command.name)).toEqual(["skill:review"]);
	});

	test("渲染可选择的 Skill 与 file command", () => {
		const markup = renderToStaticMarkup(
			<SlashCommandMenu commands={commands} selectedIndex={0} onSelect={() => {}} />,
		);

		expect(markup).toContain('role="listbox"');
		expect(markup).toContain("/skill:review");
		expect(markup).toContain("/summarize");
	});
});
