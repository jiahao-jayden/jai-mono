import { describe, expect, test } from "bun:test";
import { parseMarkdownIntoBlocks } from "streamdown";

const markdownFixture = `# 标题

这是一个包含超长链接的段落：https://example.com/${"long-path/".repeat(24)}。

| 列一 | 列二 |
| --- | --- |
| ${"宽表格内容 ".repeat(16)} | \`inline code\` |

- 第一层
  - 第二层
    - 第三层

![示例图片](https://example.com/image.png)

\`\`\`typescript
${"const veryLongLine = 'value';\n".repeat(24)}`;

describe("Streamdown Markdown boundaries", () => {
	test("超长 URL、宽表、三层列表、图片与未闭合代码围栏能拆分为安全的流式 blocks", () => {
		const blocks = parseMarkdownIntoBlocks(markdownFixture);

		expect(blocks.length).toBeGreaterThan(4);
		expect(blocks.join("\n")).toContain("https://example.com/");
		expect(blocks.join("\n")).toContain("第三层");
		expect(blocks.at(-1)).toContain("const veryLongLine");
	});
});
