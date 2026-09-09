import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../src/components/ui/button";

describe("Button", () => {
	test("disabled 状态不叠加自身 opacity 与 variant opacity", () => {
		const markup = renderToStaticMarkup(
			<Button variant="ghost" disabled>
				Click
			</Button>,
		);
		// Button should render disabled attribute
		expect(markup).toContain("disabled");
		// The disabled opacity should appear only once (on the root via variant),
		// not also on the bg layer
		const opacityMatches = markup.match(/opacity/g) ?? [];
		// Only the variant class's opacity-50 should be present, not a second
		// layered one
		expect(opacityMatches.length).toBeLessThanOrEqual(1);
	});

	test("navigation variant 渲染正确的交互与视觉类", () => {
		const markup = renderToStaticMarkup(
			<Button variant="navigation" active>
				Projects
			</Button>,
		);
		expect(markup).toContain("Projects");
		// Active navigation should render the selected background
		expect(markup).toContain("sidebar-active");
	});

	test("active prop 优先于 hover bg", () => {
		const markup = renderToStaticMarkup(
			<Button variant="ghost" active>
				Selected
			</Button>,
		);
		// Aside grammar: an engaged ghost button reads as a secondary surface.
		expect(markup).toContain("bg-secondary");
		// Should not contain the resting hover bg rule when active
		expect(markup).not.toContain("group-hover/button:bg-muted-hover");
	});

	test("icon-only 模式不改变 hover stroke", () => {
		const markup = renderToStaticMarkup(
			<Button variant="ghost" size="icon-sm">
				<svg />
			</Button>,
		);
		// Should not contain stroke transition on hover
		expect(markup).not.toContain("group-hover:stroke");
	});

	test("基类注入 focus ring", () => {
		const markup = renderToStaticMarkup(
			<Button variant="primary">Save</Button>,
		);
		// Aside grammar: the button base carries its own focus ring.
		expect(markup).toContain("focus-visible:ring-3");
		expect(markup).toContain("ring-ring");
	});
});
