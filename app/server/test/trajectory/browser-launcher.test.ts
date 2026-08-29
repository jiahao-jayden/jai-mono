import { describe, expect, test } from "bun:test";
import { createTrajectoryBrowserLauncher, type TrajectoryHttpServer } from "../../src/trajectory";

describe("Trajectory Browser launcher", () => {
	test("passes only a one-time launch nonce to the system browser", async () => {
		const urls: string[] = [];
		const server: TrajectoryHttpServer = {
			origin: "http://127.0.0.1:43123",
			issue: () => ({ token: "bearer-secret", expiresAt: "2026-08-29T00:05:00.000Z" }),
			issueBrowserLaunch: () => ({ launchId: "launch-nonce", expiresAt: "2026-08-29T00:01:00.000Z" }),
			close: () => undefined,
		};
		const launcher = createTrajectoryBrowserLauncher(server, async (url) => { urls.push(url); });
		const opened = await launcher.open({ sessionId: "session-1", scopes: ["prompt"] });
		expect(opened.isOk()).toBe(true);
		expect(urls).toEqual(["http://127.0.0.1:43123/trajectory/#launch=launch-nonce&sessionId=session-1"]);
		expect(urls[0]).not.toContain("bearer-secret");
	});

	test("projects a system browser failure without leaking the launch URL", async () => {
		const server: TrajectoryHttpServer = {
			origin: "http://127.0.0.1:43123",
			issue: () => ({ token: "bearer-secret", expiresAt: "2026-08-29T00:05:00.000Z" }),
			issueBrowserLaunch: () => ({ launchId: "launch-nonce", expiresAt: "2026-08-29T00:01:00.000Z" }),
			close: () => undefined,
		};
		const launcher = createTrajectoryBrowserLauncher(server, async () => {
			throw new Error("browser unavailable");
		});
		const opened = await launcher.open({ sessionId: "session-1", scopes: [] });
		expect(opened.isErr()).toBe(true);
		if (opened.isErr()) {
			expect(opened.error.message).toBe("Could not open the trajectory in a browser");
			expect(JSON.stringify(opened.error.toJSON())).not.toContain("launch-nonce");
		}
	});

});
