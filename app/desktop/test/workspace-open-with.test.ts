import { describe, expect, test } from "bun:test";
import {
	assertMacOSApplicationQueryResult,
	createOpenWithService,
	isMacOSApplicationPath,
} from "../electron/workspace/open-with";

function service(options: {
	readonly stdout?: string | (() => string);
	readonly platform?: NodeJS.Platform;
	readonly openPath?: (filePath: string) => Promise<string>;
}) {
	const commands: { command: string; args: readonly string[] }[] = [];
	const openWith = createOpenWithService({
		platform: options.platform ?? "darwin",
		openPath: options.openPath ?? (async () => ""),
		runner: {
			async runCommand(command, args) {
				commands.push({ command, args });
			},
			async runCommandOutput() {
				const stdout = options.stdout ?? "{}";
				return typeof stdout === "function" ? stdout() : stdout;
			},
			async startDetached(command, args) {
				commands.push({ command, args });
			},
		},
	});
	return { openWith, commands };
}

const validApplication = {
	id: "com.apple.TextEdit",
	name: "TextEdit",
	path: "/System/Applications/TextEdit.app",
	isDefault: true,
};

describe("isMacOSApplicationPath", () => {
	test("只接受已知 Applications 根目录下的 .app 绝对路径", () => {
		expect(isMacOSApplicationPath("/Applications/Xcode.app")).toBe(true);
		expect(isMacOSApplicationPath("/System/Applications/TextEdit.app")).toBe(true);
		expect(isMacOSApplicationPath("/tmp/Evil.app")).toBe(false);
		expect(isMacOSApplicationPath("/Applications/Xcode")).toBe(false);
		expect(isMacOSApplicationPath("Applications/Xcode.app")).toBe(false);
		expect(isMacOSApplicationPath("/Applications/../tmp/Evil.app")).toBe(false);
	});
});

describe("assertMacOSApplicationQueryResult", () => {
	test("接受结构正确的响应", () => {
		const result = assertMacOSApplicationQueryResult({ applications: [validApplication] });
		expect(result.applications).toEqual([validApplication]);
	});

	test("拒绝形状错误的响应", () => {
		expect(() => assertMacOSApplicationQueryResult(null)).toThrow();
		expect(() => assertMacOSApplicationQueryResult({})).toThrow();
		expect(() => assertMacOSApplicationQueryResult({ applications: "nope" })).toThrow();
	});

	test("拒绝允许名单之外的应用路径", () => {
		expect(() =>
			assertMacOSApplicationQueryResult({
				applications: [{ ...validApplication, path: "/tmp/Evil.app" }],
			}),
		).toThrow();
	});

	test("拒绝字段缺失或类型错误的应用", () => {
		for (const bad of [
			{ ...validApplication, id: "" },
			{ ...validApplication, name: "" },
			{ ...validApplication, isDefault: "yes" },
			{ id: "a", name: "b", path: "/Applications/A.app" },
		]) {
			expect(() => assertMacOSApplicationQueryResult({ applications: [bad] })).toThrow();
		}
	});
});

describe("OpenWithService", () => {
	test("解析 osascript 输出并投影为 DTO", async () => {
		const { openWith } = service({ stdout: JSON.stringify({ applications: [validApplication] }) });
		const result = await openWith.applicationsFor("/project/readme.md");
		expect(result.applications).toEqual([{ id: validApplication.id, name: "TextEdit", isDefault: true }]);
		expect(result.defaultApplication?.id).toBe(validApplication.id);
	});

	test("osascript 返回非法 JSON 时抛出可控错误", async () => {
		const { openWith } = service({ stdout: "not json" });
		await expect(openWith.applicationsFor("/project/readme.md")).rejects.toThrow();
	});

	test("按扩展名缓存查询结果，失败后不缓存", async () => {
		let calls = 0;
		const { openWith } = service({
			stdout: () => {
				calls += 1;
				if (calls === 1) throw new Error("boom");
				return JSON.stringify({ applications: [validApplication] });
			},
		});
		await expect(openWith.applicationsFor("/project/a.md")).rejects.toThrow();
		expect(calls).toBe(1);

		await openWith.applicationsFor("/project/b.md");
		expect(calls).toBe(2);
		// Same extension now resolves from cache.
		await openWith.applicationsFor("/project/c.md");
		expect(calls).toBe(2);
	});

	test("非 macOS 平台返回空列表", async () => {
		const { openWith } = service({ platform: "linux" });
		expect(await openWith.applicationsFor("/project/readme.md")).toEqual({ applications: [] });
	});

	test("用选定应用打开时按 bundle id 调用 open -b", async () => {
		const { openWith, commands } = service({ stdout: JSON.stringify({ applications: [validApplication] }) });
		await openWith.openWithApplication(validApplication.id, "/project/readme.md");
		expect(commands).toEqual([
			{ command: "open", args: ["-b", validApplication.id, "/project/readme.md"] },
		]);
	});

	test("选定的应用不在候选列表时拒绝启动", async () => {
		const { openWith, commands } = service({ stdout: JSON.stringify({ applications: [validApplication] }) });
		await expect(openWith.openWithApplication("com.evil.app", "/project/readme.md")).rejects.toThrow();
		expect(commands).toEqual([]);
	});

	test("默认打开失败时把系统消息作为错误抛出", async () => {
		const { openWith } = service({ openPath: async () => "No application can open this file" });
		await expect(openWith.openWithDefault("/project/readme.md")).rejects.toThrow();
	});

	test("Cursor 在 macOS 用 open -a，其它平台走可分离进程", async () => {
		const mac = service({});
		await mac.openWith.openInCursor("/project/readme.md");
		expect(mac.commands).toEqual([{ command: "open", args: ["-a", "Cursor", "/project/readme.md"] }]);

		const linux = service({ platform: "linux" });
		await linux.openWith.openInCursor("/project/readme.md");
		expect(linux.commands).toEqual([{ command: "cursor", args: ["/project/readme.md"] }]);

		const win = service({ platform: "win32" });
		await win.openWith.openInCursor("/project/readme.md");
		expect(win.commands).toEqual([{ command: "Cursor.exe", args: ["/project/readme.md"] }]);
	});
});
