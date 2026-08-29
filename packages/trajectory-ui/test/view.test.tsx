import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TrajectoryView, type TrajectoryDataSource } from "../src";

describe("TrajectoryView", () => {
	test("renders the shared metadata-only empty trajectory state", () => {
		const source: TrajectoryDataSource = {
			async snapshot() {
				return { ok: true, value: { session: { sessionId: "session-1", cwd: "/workspace" }, cursor: { value: "1" }, items: [] } };
			},
			async subscribe() {
				return { ok: true, value: { close: () => undefined } };
			},
		};
		const html = renderToStaticMarkup(<TrajectoryView source={source} sessionId="session-1" />);
		expect(html).toContain("Session trajectory");
		expect(html).toContain("Loading Session…");
	});
});
