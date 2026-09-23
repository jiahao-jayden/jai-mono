import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { IntlProvider } from "react-intl";
import { renderToStaticMarkup as renderToStaticMarkupBase } from "react-dom/server";
import { ChatMessageQueue } from "../src/components/shell/chat/chat-message-queue";
import { resolveComposerEnterDelivery } from "../src/components/shell/chat/chat-composer";
import enMessages from "../src/i18n/compiled/en.json";

function renderToStaticMarkup(node: ReactNode): string {
	return renderToStaticMarkupBase(
		<IntlProvider locale="en" messages={enMessages}>
			{node}
		</IntlProvider>,
	);
}

describe("ChatMessageQueue", () => {
	test("running composer queues Enter, steers Ctrl/Cmd+Enter, stops on empty Enter", () => {
		expect(
			resolveComposerEnterDelivery({
				key: "Enter",
				shiftKey: false,
				metaKey: false,
				ctrlKey: false,
				isStreaming: true,
				hasMessageContent: true,
			}),
		).toBe("queue");
		expect(
			resolveComposerEnterDelivery({
				key: "Enter",
				shiftKey: false,
				metaKey: false,
				ctrlKey: false,
				isStreaming: true,
				hasMessageContent: false,
			}),
		).toBe("stop");
		expect(
			resolveComposerEnterDelivery({
				key: "Enter",
				shiftKey: false,
				metaKey: false,
				ctrlKey: true,
				isStreaming: true,
				hasMessageContent: true,
			}),
		).toBe("steer");
		expect(
			resolveComposerEnterDelivery({
				key: "Enter",
				shiftKey: false,
				metaKey: true,
				ctrlKey: false,
				isStreaming: true,
				hasMessageContent: true,
			}),
		).toBe("steer");
	});

	test("renders the stacked queue actions without replacing the queued message", () => {
		const markup = renderToStaticMarkup(
			<ChatMessageQueue
				messages={[{ id: "queued-1", text: "Inspect the failing test", mode: "manual", modelRef: "p/a" }]}
				onEdit={() => {}}
				onRemove={() => {}}
				onReorder={() => {}}
				onSteer={async () => false}
				steerEnabled
			/>,
		);

		expect(markup).toContain("Inspect the failing test");
		expect(markup).toContain(">Steer<");
		expect(markup).toContain('aria-label="Edit queued message: Inspect the failing test"');
		expect(markup).toContain('aria-label="Remove queued message: Inspect the failing test"');
	});
});
