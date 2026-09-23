import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearLogFile, deleteRotatedLogs, listLogFiles, readLogTail } from "../electron/logs";
import { DESKTOP_LOG_TAIL_BYTES } from "../shared/desktop-rpc";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("desktop logs", () => {
	test("只返回文件末尾，并拒绝跑出日志目录", async () => {
		const root = await createLogsRoot();
		const start = "START-SHOULD-NOT-APPEAR\n";
		const end = "END-OF-LOG\n";
		const filler = `${"x".repeat(120)}\n`.repeat(Math.ceil(DESKTOP_LOG_TAIL_BYTES / 100));
		await writeFile(join(root, "logs", "runtime-host", "host.log"), `${start}${filler}${end}`);
		await writeFile(join(root, "logs", "runtime-host", "host.log.1"), "old\n");
		await symlink(join(root, "logs", "runtime-host", "host.log"), join(root, "logs", "desktop", "linked.log"));

		const listed = await listLogFiles(root);
		expect(listed.map((file) => file.id)).toEqual(["runtime-host/host.log", "runtime-host/host.log.1"]);
		expect(listed[0]?.active).toBe(true);
		expect(listed[1]?.active).toBe(false);

		const tail = await readLogTail(root, "runtime-host/host.log");
		expect(tail.truncated).toBe(true);
		expect(tail.text.length).toBeLessThanOrEqual(DESKTOP_LOG_TAIL_BYTES);
		expect(tail.text).toContain("END-OF-LOG");
		expect(tail.text).not.toContain("START-SHOULD-NOT-APPEAR");
		expect(tail.bytes).toBeGreaterThan(DESKTOP_LOG_TAIL_BYTES);

		await expect(readLogTail(root, "../secret")).rejects.toThrow("Unknown log file");
		await expect(readLogTail(root, "desktop/linked.log")).rejects.toThrow("Log file is unavailable");
	});

	test("清空当前文件，删除时只动轮转副本", async () => {
		const root = await createLogsRoot();
		const current = join(root, "logs", "desktop", "main.log");
		const rotated = join(root, "logs", "desktop", "main.old.log");
		await writeFile(current, "keep-until-clear\n");
		await writeFile(rotated, "rotated\n");

		expect(await deleteRotatedLogs(root)).toBe(1);
		await expect(readFile(rotated, "utf8")).rejects.toThrow();
		expect(await readFile(current, "utf8")).toBe("keep-until-clear\n");

		await clearLogFile(root, "desktop/main.log");
		const tail = await readLogTail(root, "desktop/main.log");
		expect(tail.text).toBe("");
		expect(tail.truncated).toBe(false);
		expect(tail.bytes).toBe(0);
	});
});

async function createLogsRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "jai-desktop-logs-"));
	roots.push(root);
	await mkdir(join(root, "logs", "desktop"), { recursive: true });
	await mkdir(join(root, "logs", "runtime-host"), { recursive: true });
	return root;
}
