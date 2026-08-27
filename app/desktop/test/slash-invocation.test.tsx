import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SlashInvocationText } from "../src/components/shell/chat/slash-invocation";

describe("SlashInvocationText", () => {
	test("保留 /name 原文并为 hover 暴露 displayName", () => {
		const markup = renderToStaticMarkup(
			<SlashInvocationText
				text="/review inspect this patch"
				invocation={{ name: "review", kind: "command", commandKind: "skill", displayName: "Review changes" }}
			/>,
		);

		expect(markup).toContain('data-note="Review changes"');
		expect(markup).toContain('data-command-kind="skill"');
		expect(markup).toContain('title="Review changes"');
		expect(markup).toContain('<span class="slash-invocation"');
		expect(markup).toContain("/review");
		expect(markup).toContain(" inspect this patch");
	});
});
