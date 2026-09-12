import { describe, expect, test } from "bun:test";
import { findOpenFenceLanguage } from "@lobehub/streamdown";

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

	describe("LobeHub Streamdown Markdown boundaries", () => {
	test("识别未闭合代码围栏并保留流式内容", () => {
		expect(findOpenFenceLanguage(markdownFixture)).toBe("typescript");
		expect(markdownFixture).toContain("https://example.com/");
		expect(markdownFixture).toContain("第三层");
		expect(markdownFixture).toContain("const veryLongLine");
	});
});
