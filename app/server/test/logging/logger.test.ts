import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostLogPath, openHostLog } from "../../src/logging";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runtime host log", () => {
	test("writes a scoped line and redacts credentials", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-host-log-"));
		roots.push(root);
		const stderr: string[] = [];
		const log = openHostLog({
			dataDirectory: root,
			environment: {},
			stderr: { write: (text) => stderr.push(text) },
		});
		log.scope("session").error("agent stopped", {
			sessionId: "session-1",
			operationId: "operation-1",
			errorMessage:
				"failed https://user:pw-supersecret@example.com/v1?api_key=abcd Bearer sk-live-token Cookie: session=abc",
		});
		log.scope("session").debug("hidden detail");
		await log.close();

		const text = await readFile(hostLogPath(root), "utf8");
		expect(text).toContain("ERROR [session] agent stopped");
		expect(text).toContain('sessionId="session-1"');
		expect(text).toContain('operationId="operation-1"');
		expect(text).toContain("[REDACTED]");
		expect(text).not.toContain("pw-supersecret");
		expect(text).not.toContain("abcd");
		expect(text).not.toContain("sk-live-token");
		expect(text).not.toContain("session=abc");
		expect(text).not.toContain("hidden detail");
		expect(text).not.toContain("\u001b");
		const stderrText = stderr.join("");
		expect(stderrText).toContain("ERROR [session] agent stopped");
		expect(stderrText).not.toContain("pw-supersecret");
		expect(stderrText).not.toContain("\u001b");
	});

	test("colors stderr when FORCE_COLOR is set and keeps the file plain", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-host-log-"));
		roots.push(root);
		const stderr: string[] = [];
		const originalWrite = process.stderr.write.bind(process.stderr);
		process.stderr.write = ((chunk: string | Uint8Array) => {
			stderr.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
		const previousForce = process.env.FORCE_COLOR;
		const previousNoColor = process.env.NO_COLOR;
		process.env.FORCE_COLOR = "1";
		delete process.env.NO_COLOR;
		try {
			const log = openHostLog({ dataDirectory: root, environment: {}, stderr: process.stderr });
			log.scope("runtime").info("listening", { endpoint: "/tmp/jai.sock" });
			await log.close();
		} finally {
			process.stderr.write = originalWrite;
			if (previousForce === undefined) delete process.env.FORCE_COLOR;
			else process.env.FORCE_COLOR = previousForce;
			if (previousNoColor === undefined) delete process.env.NO_COLOR;
			else process.env.NO_COLOR = previousNoColor;
		}

		const text = await readFile(hostLogPath(root), "utf8");
		expect(text).toContain("INFO [runtime] listening");
		expect(text).not.toContain("\u001b");
		const stderrText = stderr.join("");
		expect(stderrText).toContain("\u001b[36mINFO\u001b[0m");
		expect(stderrText).toContain("listening");
	});
});
