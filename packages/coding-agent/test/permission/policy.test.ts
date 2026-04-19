import { describe, expect, test } from "bun:test";
import { PermissionPolicy } from "../../src/permission/policy.js";
import { PermissionService } from "../../src/permission/service.js";

const CWD = "/tmp/fake-workspace";

function makePolicy() {
	const service = new PermissionService();
	const policy = new PermissionPolicy({
		cwd: CWD,
		settings: { dangerousPaths: [] },
		service,
	});
	return { service, policy };
}

describe("PermissionPolicy.dangerHandler", () => {
	test("safe tool call → undefined (passes through)", async () => {
		const { policy } = makePolicy();
		const result = await policy.dangerHandler({
			toolCallId: "tc1",
			toolName: "FileWrite",
			args: { path: "src/foo.ts", content: "x" },
		});
		expect(result).toBeUndefined();
	});

	test("dangerous tool call → asks user; allow_once → undefined", async () => {
		const { service, policy } = makePolicy();
		// Auto-reply with allow_once
		service.onPending((p) => service.reply(p.id, { kind: "allow_once" }));

		const result = await policy.dangerHandler({
			toolCallId: "tc1",
			toolName: "FileWrite",
			args: { path: "/etc/hosts", content: "x" },
		});
		expect(result).toBeUndefined();
	});

	test("user rejects → returns skip + error result", async () => {
		const { service, policy } = makePolicy();
		service.onPending((p) => service.reply(p.id, { kind: "reject", reason: "no" }));

		const result = await policy.dangerHandler({
			toolCallId: "tc1",
			toolName: "Bash",
			args: { command: "sudo rm -rf /tmp/foo" },
		});

		expect(result?.skip).toBe(true);
		expect(result?.result?.isError).toBe(true);
	});

	test("allow_session mutes subsequent calls with same muteKey", async () => {
		const { service, policy } = makePolicy();
		let askCount = 0;
		service.onPending((p) => {
			askCount++;
			service.reply(p.id, { kind: "allow_session" });
		});

		// First call: asks user
		await policy.dangerHandler({
			toolCallId: "tc1",
			toolName: "Bash",
			args: { command: "sudo apt update" },
		});
		expect(askCount).toBe(1);

		// Second call same command → mute hit, no ask
		await policy.dangerHandler({
			toolCallId: "tc2",
			toolName: "Bash",
			args: { command: "sudo apt update" },
		});
		expect(askCount).toBe(1);
	});

	test("allow_once does NOT mute subsequent calls", async () => {
		const { service, policy } = makePolicy();
		let askCount = 0;
		service.onPending((p) => {
			askCount++;
			service.reply(p.id, { kind: "allow_once" });
		});

		await policy.dangerHandler({
			toolCallId: "tc1",
			toolName: "Bash",
			args: { command: "sudo apt update" },
		});
		await policy.dangerHandler({
			toolCallId: "tc2",
			toolName: "Bash",
			args: { command: "sudo apt update" },
		});
		expect(askCount).toBe(2);
	});

	test("different muteKeys are independent", async () => {
		const { service, policy } = makePolicy();
		let askCount = 0;
		service.onPending((p) => {
			askCount++;
			service.reply(p.id, { kind: "allow_session" });
		});

		await policy.dangerHandler({
			toolCallId: "tc1",
			toolName: "Bash",
			args: { command: "sudo apt update" },
		});
		await policy.dangerHandler({
			toolCallId: "tc2",
			toolName: "Bash",
			args: { command: "sudo systemctl restart nginx" },
		});
		expect(askCount).toBe(2);
	});

	test("user dangerousPaths from settings is honored", async () => {
		const service = new PermissionService();
		const policy = new PermissionPolicy({
			cwd: CWD,
			settings: { dangerousPaths: ["src/secret"] },
			service,
		});
		let asked = false;
		service.onPending((p) => {
			asked = true;
			service.reply(p.id, { kind: "allow_once" });
		});

		await policy.dangerHandler({
			toolCallId: "tc1",
			toolName: "FileWrite",
			args: { path: "src/secret/key.ts", content: "x" },
		});
		expect(asked).toBe(true);
	});
});
