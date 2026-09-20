import { createRequire } from "node:module";
import type { IPty } from "node-pty";
import type { PtyAdapter, PtyProcess } from ".";

const require = createRequire(import.meta.url);

export function createNodePtyAdapter(): PtyAdapter {
	return {
		async spawn(input) {
			const nodePty = require("node-pty") as typeof import("node-pty");
			const ptyProcess = nodePty.spawn(input.shell, [...input.args], {
				cwd: input.cwd,
				cols: input.cols,
				rows: input.rows,
				env: input.env,
				name: process.platform === "win32" ? "xterm-color" : "xterm-256color",
			});
			return wrapProcess(ptyProcess);
		},
	};
}

function wrapProcess(process: IPty): PtyProcess {
	return {
		pid: process.pid,
		write: (data) => process.write(data),
		resize: (cols, rows) => process.resize(cols, rows),
		pause: () => process.pause(),
		resume: () => process.resume(),
		kill(signal) {
			if (globalThis.process.platform !== "win32") {
				try {
					globalThis.process.kill(-process.pid, signal as NodeJS.Signals);
					return;
				} catch {
					// Fall through when the PTY is not its own process group.
				}
			}
			process.kill(signal);
		},
		onData(listener) {
			const subscription = process.onData(listener);
			return () => subscription.dispose();
		},
		onExit(listener) {
			const subscription = process.onExit(listener);
			return () => subscription.dispose();
		},
	};
}
