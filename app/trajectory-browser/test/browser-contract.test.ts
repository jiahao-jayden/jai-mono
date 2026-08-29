import { describe, expect, test } from "bun:test";
import { takeBrowserTrajectoryBootstrap } from "../src/bootstrap";

describe("Browser trajectory bootstrap", () => {
	test("rejects a bearer capability in the fragment", () => {
		const location = new URL("http://127.0.0.1:43210/trajectory/#capability=secret&sessionId=session-1");
		let replacement = "";
		const bootstrap = takeBrowserTrajectoryBootstrap(location as unknown as Location, { replaceState: (_state, _title, url) => { replacement = String(url); } } as History);
		expect(bootstrap).toBeUndefined();
		expect(replacement).toBe("/trajectory/");
	});

	test("uses a one-time launch nonce without placing a bearer in the URL", () => {
		const location = new URL("http://127.0.0.1:43210/trajectory/#launch=launch-1&sessionId=session-1");
		let replacement = "";
		const bootstrap = takeBrowserTrajectoryBootstrap(location as unknown as Location, {
			replaceState: (_state, _title, url) => { replacement = String(url); },
		} as History);
		expect(bootstrap).toEqual({ origin: "http://127.0.0.1:43210", sessionId: "session-1", launchId: "launch-1" });
		expect(replacement).toBe("/trajectory/");
	});

	test("rejects a missing fragment capability", () => {
		const location = new URL("http://127.0.0.1:43210/trajectory/");
		const bootstrap = takeBrowserTrajectoryBootstrap(location as unknown as Location, { replaceState() {} } as unknown as History);
		expect(bootstrap).toBeUndefined();
	});
});
