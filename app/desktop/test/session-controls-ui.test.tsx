import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup as renderToStaticMarkupBase } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { type DesktopSessionControls, defaultDesktopSessionControls } from "../shared/session-controls";
import { ChatComposer } from "../src/components/shell/chat/chat-composer";
import { ModelControls } from "../src/components/shell/chat/model-controls";
import enMessages from "../src/i18n/compiled/en.json";

function render(node: ReactNode): string {
	return renderToStaticMarkupBase(
		<IntlProvider locale="en" messages={enMessages}>
			{node}
		</IntlProvider>,
	);
}

function renderComposer(controls: DesktopSessionControls, status: "ready" | "submitted" = "ready"): string {
	return render(
		<ChatComposer
			value=""
			onValueChange={() => {}}
			onSend={async () => false}
			onStop={async () => {}}
			status={status}
			disabled={false}
			queue={[]}
			onEditQueuedMessage={() => {}}
			onRemoveQueuedMessage={() => {}}
			onReorderQueuedMessages={() => {}}
			onSteerQueuedMessage={async () => false}
			projects={[]}
			projectBusy={false}
			projectLoading={false}
			projectLoadError={false}
			onChooseProject={async () => {}}
			onRetryProjects={() => {}}
			selectedModelRef="provider/model"
			selectedControls={controls}
			providerLoading={false}
			providerError={false}
			onOpenProviderSettings={() => {}}
			onSelectProviderModel={() => {}}
			onSelectControls={() => {}}
		/>,
	);
}

describe("Composer Session controls", () => {
	test("permission dropdown shows the current permission mode, not the retired agent modes", () => {
		const markup = renderComposer({ ...defaultDesktopSessionControls, permissionMode: "allow" });

		expect(markup).toContain('aria-label="Permissions: Allow"');
		expect(markup).toContain('title="Allow routine workspace changes while keeping safety boundaries"');
		expect(markup).not.toContain("Automate");
		expect(markup).not.toContain("Manual");
	});

	test("Plan stays visible next to an unchanged permission mode and offers a way out", () => {
		const planned = renderComposer({
			...defaultDesktopSessionControls,
			permissionMode: "ask",
			interactionMode: "plan",
		});
		const normal = renderComposer({ ...defaultDesktopSessionControls, permissionMode: "ask" });

		expect(planned).toContain('aria-label="Permissions: Ask"');
		expect(planned).toContain('aria-label="Plan mode on. Click to turn off"');
		expect(normal).not.toContain("Plan mode on");
	});

	test("controls are disabled while a message is being submitted", () => {
		const markup = renderComposer(defaultDesktopSessionControls, "submitted");

		expect(markup).toMatch(/aria-label="Add files and modes"[^>]*disabled=""|disabled=""[^>]*aria-label="Add files and modes"/);
		expect(markup).toMatch(
			/aria-label="Permissions: Ask"[^>]*disabled=""|disabled=""[^>]*aria-label="Permissions: Ask"/,
		);
	});
});

describe("ModelControls", () => {
	test("renders nothing for a model without reasoning or Fast mode", () => {
		const markup = render(
			<ModelControls
				capabilities={{ reasoningLevels: [], supportsFastMode: false }}
				controls={{ ...defaultDesktopSessionControls, reasoningLevel: "high", fastMode: true }}
				disabled={false}
				onChange={() => {}}
			/>,
		);

		expect(markup).toBe("");
	});

	test("shows the level the model will receive for a higher stored wish", () => {
		const markup = render(
			<ModelControls
				capabilities={{ reasoningLevels: ["low", "medium", "high"], supportsFastMode: false }}
				controls={{ ...defaultDesktopSessionControls, reasoningLevel: "max" }}
				disabled={false}
				onChange={() => {}}
			/>,
		);

		expect(markup).toContain('aria-label="Reasoning"');
		expect(markup).toContain("High");
		expect(markup).not.toContain("Fast mode");
	});

	test("falls back to the model default when no supported level is at or below the wish", () => {
		const markup = render(
			<ModelControls
				capabilities={{ reasoningLevels: ["high", "xhigh"], supportsFastMode: true }}
				controls={{ ...defaultDesktopSessionControls, reasoningLevel: "low", fastMode: true }}
				disabled
				onChange={() => {}}
			/>,
		);

		expect(markup).toContain("Model default");
		expect(markup).toContain("Fast mode");
		expect(markup).toContain('aria-checked="true"');
	});

	test("burns the particle trail only at the highest reasoning level", () => {
		const renderAt = (reasoningLevel: DesktopSessionControls["reasoningLevel"]) =>
			render(
				<ModelControls
					capabilities={{ reasoningLevels: ["low", "medium", "high"], supportsFastMode: false }}
					controls={{ ...defaultDesktopSessionControls, reasoningLevel }}
					disabled={false}
					onChange={() => {}}
				/>,
			);

		expect(renderAt("high")).toContain("<canvas");
		expect(renderAt("medium")).not.toContain("<canvas");
	});
});
