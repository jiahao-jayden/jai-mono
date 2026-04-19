import { describe, expect, test } from "bun:test";
import { PermissionService } from "../../src/permission/service.js";
import type { PermissionRequest } from "../../src/permission/types.js";

const sampleRequest: PermissionRequest = {
	category: "external_write",
	reason: "写入工作区外的文件：/tmp/x",
	muteKey: "external_write_dir:/tmp",
};

describe("PermissionService - request/reply", () => {
	test("request returns id + pending promise", () => {
		const svc = new PermissionService();
		const { id, promise } = svc.request({ toolCallId: "tc1", toolName: "FileWrite", request: sampleRequest });
		expect(id).toMatch(/^perm_/);
		expect(promise).toBeInstanceOf(Promise);
		expect(svc.listPending()).toHaveLength(1);
	});

	test("reply resolves with allow_once", async () => {
		const svc = new PermissionService();
		const { id, promise } = svc.request({ toolCallId: "tc1", toolName: "FileWrite", request: sampleRequest });
		svc.reply(id, { kind: "allow_once" });
		await expect(promise).resolves.toEqual({ kind: "allow_once" });
		expect(svc.listPending()).toHaveLength(0);
	});

	test("reply with allow_session", async () => {
		const svc = new PermissionService();
		const { id, promise } = svc.request({ toolCallId: "tc1", toolName: "Bash", request: sampleRequest });
		svc.reply(id, { kind: "allow_session" });
		await expect(promise).resolves.toEqual({ kind: "allow_session" });
	});

	test("reply with unknown id is silent no-op", () => {
		const svc = new PermissionService();
		expect(() => svc.reply("nope", { kind: "allow_once" })).not.toThrow();
	});

	test("multiple concurrent pendings are independent", async () => {
		const svc = new PermissionService();
		const a = svc.request({ toolCallId: "tc1", toolName: "FileWrite", request: sampleRequest });
		const b = svc.request({ toolCallId: "tc2", toolName: "Bash", request: sampleRequest });
		svc.reply(a.id, { kind: "allow_session" });
		svc.reply(b.id, { kind: "reject" });
		await expect(a.promise).resolves.toEqual({ kind: "allow_session" });
		await expect(b.promise).resolves.toEqual({ kind: "reject" });
	});
});

describe("PermissionService - abort", () => {
	test("abort single pending → resolves as reject", async () => {
		const svc = new PermissionService();
		const { id, promise } = svc.request({ toolCallId: "tc1", toolName: "FileWrite", request: sampleRequest });
		svc.abort(id, "user closed");
		const decision = await promise;
		expect(decision).toEqual({ kind: "reject", reason: "user closed" });
	});

	test("abortAll rejects every pending", async () => {
		const svc = new PermissionService();
		const a = svc.request({ toolCallId: "tc1", toolName: "FileWrite", request: sampleRequest });
		const b = svc.request({ toolCallId: "tc2", toolName: "Bash", request: sampleRequest });
		svc.abortAll("session aborted");
		await expect(a.promise).resolves.toEqual({ kind: "reject", reason: "session aborted" });
		await expect(b.promise).resolves.toEqual({ kind: "reject", reason: "session aborted" });
		expect(svc.listPending()).toHaveLength(0);
	});
});

describe("PermissionService - listeners", () => {
	test("listeners are notified after pending is registered", () => {
		const svc = new PermissionService();
		let observedListLengthAtNotify = -1;
		svc.onPending(() => {
			observedListLengthAtNotify = svc.listPending().length;
		});
		svc.request({ toolCallId: "tc1", toolName: "FileWrite", request: sampleRequest });
		expect(observedListLengthAtNotify).toBe(1);
	});

	test("unsubscribe stops further notifications", () => {
		const svc = new PermissionService();
		let count = 0;
		const off = svc.onPending(() => {
			count++;
		});
		svc.request({ toolCallId: "tc1", toolName: "FileWrite", request: sampleRequest });
		off();
		svc.request({ toolCallId: "tc2", toolName: "FileWrite", request: sampleRequest });
		expect(count).toBe(1);
	});

	test("listener throwing does not crash service", () => {
		const svc = new PermissionService();
		svc.onPending(() => {
			throw new Error("boom");
		});
		expect(() => svc.request({ toolCallId: "tc1", toolName: "FileWrite", request: sampleRequest })).not.toThrow();
		expect(svc.listPending()).toHaveLength(1);
	});
});
