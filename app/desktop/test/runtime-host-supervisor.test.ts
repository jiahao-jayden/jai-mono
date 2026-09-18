import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import type { DesktopRuntimeHostProcess } from "../electron/runtime-host/entrypoint";
import { managedRuntimeHostProcess } from "../electron/runtime-host/entrypoint";
import { DesktopRuntimeHostSupervisor } from "../electron/runtime-host/supervisor";

describe("DesktopRuntimeHostSupervisor", () => {
	test("does not launch duplicate children and restarts an unexpected exit", async () => {
		const children: FakeRuntimeHostProcess[] = [];
		const supervisor = new DesktopRuntimeHostSupervisor({
			runtimeHostEntrypoint: "runtime-host.js",
			launcher: () => {
				const child = new FakeRuntimeHostProcess();
				children.push(child);
				return child;
			},
			baseRestartDelayMs: 0,
		});
		supervisor.launchRuntimeHost({ entrypoint: "runtime-host.js", environment: {} });
		supervisor.launchRuntimeHost({ entrypoint: "runtime-host.js", environment: {} });
		expect(children).toHaveLength(1);

		children[0]!.exit(1, null);
		await waitFor(() => children.length === 2);

		await supervisor.close();
	});

	test("opens the circuit after the restart budget is exhausted", async () => {
		const children: FakeRuntimeHostProcess[] = [];
		const supervisor = new DesktopRuntimeHostSupervisor({
			runtimeHostEntrypoint: "runtime-host.js",
			launcher: () => {
				const child = new FakeRuntimeHostProcess();
				children.push(child);
				return child;
			},
			maxRestartAttempts: 2,
			baseRestartDelayMs: 0,
		});
		supervisor.launchRuntimeHost({ entrypoint: "runtime-host.js", environment: {} });
		children[0]!.exit(1, null);
		await waitFor(() => children.length === 2);
		children[1]!.exit(1, null);
		await waitFor(() => children.length === 3);
		children[2]!.exit(1, null);
		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(children).toHaveLength(3);
		await supervisor.close();
	});

	test("does not restart after an intentional close", async () => {
		const children: FakeRuntimeHostProcess[] = [];
		const supervisor = new DesktopRuntimeHostSupervisor({
			runtimeHostEntrypoint: "runtime-host.js",
			launcher: () => {
				const child = new FakeRuntimeHostProcess();
				children.push(child);
				return child;
			},
			baseRestartDelayMs: 0,
		});

		supervisor.launchRuntimeHost({ entrypoint: "runtime-host.js", environment: {} });
		await supervisor.close();
		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(children).toHaveLength(1);
	});

	test("observes exit and stderr from a real Node child", async () => {
		const child = spawn(process.execPath, ["-e", "process.stderr.write('host failed\\n'); process.exit(17)"], {
			stdio: ["ignore", "ignore", "pipe"],
		});
		const observed = managedRuntimeHostProcess(child);
		const stderr: string[] = [];
		observed.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
		let exit: { readonly code: number | null; readonly signal: string | null } | undefined;
		observed.onExit((code, signal) => {
			exit = { code, signal };
		});

		await observed.waitForExit();

		expect(exit).toEqual({ code: 17, signal: null });
		expect(stderr.join("")).toContain("host failed");
	});
});

class FakeRuntimeHostProcess implements DesktopRuntimeHostProcess {
	stderr = null;
	#exitListeners = new Set<(code: number | null, signal: string | null) => void>();
	#exited = false;

	onExit(listener: (code: number | null, signal: string | null) => void): () => void {
		if (this.#exited) queueMicrotask(() => listener(0, null));
		else this.#exitListeners.add(listener);
		return () => this.#exitListeners.delete(listener);
	}

	onError(): () => void {
		return () => {};
	}

	kill(): void {
		this.exit(0, null);
	}

	waitForExit(): Promise<void> {
		return this.#exited
			? Promise.resolve()
			: new Promise((resolve) => this.onExit(() => resolve()));
	}

	exit(code: number, signal: string | null): void {
		if (this.#exited) return;
		this.#exited = true;
		for (const listener of this.#exitListeners) listener(code, signal);
		this.#exitListeners.clear();
	}
}

async function waitFor(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (condition()) return;
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
	throw new Error("Timed out waiting for Runtime Host Supervisor");
}
