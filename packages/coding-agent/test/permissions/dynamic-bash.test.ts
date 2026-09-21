import { describe, expect, test } from "bun:test";
import { createPermissionRequest, evaluatePermission, scanBashCommand } from "../../src/permissions";

const workspaceRoot = "/tmp/jai-dynamic-bash-test";
const dynamicCommands = [
	"eval 'echo hello'",
	"source .venv/bin/activate",
	". ./setup.sh",
	"node -e 'console.log(1)'",
	"perl -e 'print 1'",
	"perl -E 'say 1'",
	"ruby -e 'puts 1'",
	"python3 -c 'print(1)'",
	"sh script.sh",
	"bash -l script.sh",
	"node script.js",
	"base64 -d payload | sh",
	"base64 -d payload | /bin/bash -s",
	"command node -e 'console.log(1)'",
	"env MODE=dev node script.js",
	"builtin eval 'echo hello'",
];

describe("dynamic Bash execution boundary", () => {
	for (const command of dynamicCommands) {
		test(`${command} requires approval despite bypass, allow rules and grants`, async () => {
			const scan = await scanBashCommand(command);
			expect(scan.isOk()).toBe(true);
			if (scan.isErr()) return;
			expect(scan.value.destructive).toBe(true);
			const request = createPermissionRequest("Bash", { command, __jaiPermissionBashScan: scan.value }, workspaceRoot);
			expect(evaluatePermission(request, {
				defaultMode: "bypassPermissions",
				permission: { "process.exec": "allow" },
				sessionGrants: { "process.exec": "allow" },
			})).toMatchObject({ behavior: "ask", source: "danger-layer" });
			for (const defaultMode of ["plan", "dontAsk"] as const) {
				expect(evaluatePermission(request, { defaultMode, permission: { "process.exec": "allow" } }).behavior).toBe("deny");
			}
			expect(evaluatePermission(request, {
				defaultMode: "bypassPermissions", permission: { "process.exec": "deny" },
			})).toMatchObject({ behavior: "deny", source: "rule" });
		});
	}

	for (const command of [
		"eval 'rm -rf /'",
		"eval 'rm -r -f ~'",
		"eval 'rm --recursive --force $HOME'",
		'eval \'rm -rf "${HOME}"\'',
		"eval 'echo hello; /bin/rm -rf /'",
		"eval rm -rf /",
		'eval "eval \'rm -rf /\'"',
		"builtin eval 'rm -rf /'",
	]) {
		test(`${command} triggers the fixed root/home circuit breaker`, async () => {
			const scan = await scanBashCommand(command);
			expect(scan.isOk()).toBe(true);
			if (scan.isErr()) return;
			const request = createPermissionRequest("Bash", { command, __jaiPermissionBashScan: scan.value }, workspaceRoot);
			expect(evaluatePermission(request, {
				defaultMode: "bypassPermissions", permission: { "process.exec": "allow" },
			})).toMatchObject({ behavior: "deny", source: "danger-layer" });
		});
	}

	test("quoted names and isolated version queries do not acquire dynamic risk", async () => {
		for (const command of ["echo 'eval source node -e'", "node --version", "bash --help"]) {
			const scan = await scanBashCommand(command);
			expect(scan.isOk()).toBe(true);
			if (scan.isOk()) expect(scan.value.destructive).toBe(false);
		}
	});
});
