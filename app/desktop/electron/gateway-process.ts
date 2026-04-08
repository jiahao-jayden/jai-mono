import { type ChildProcess, execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { app } from "electron";
import { gatewayLog } from "./logger";

const DEFAULT_PORT = 18900;

function findBun(): string {
	const candidates = [resolve(homedir(), ".bun", "bin", "bun"), "/opt/homebrew/bin/bun", "/usr/local/bin/bun"];
	for (const p of candidates) {
		if (existsSync(p)) return p;
	}
	try {
		return execSync("which bun", { encoding: "utf-8" }).trim();
	} catch {
		return "bun";
	}
}

export class GatewayProcess {
	private child: ChildProcess | null = null;
	private _port = DEFAULT_PORT;
	private _ready = false;

	get port(): number {
		return this._port;
	}

	get ready(): boolean {
		return this._ready;
	}

	get baseURL(): string {
		return `http://127.0.0.1:${this._port}`;
	}

	async start(): Promise<void> {
		if (this.child) return;

		const jaiHome = resolve(homedir(), ".jai");
		if (!existsSync(jaiHome)) {
			mkdirSync(jaiHome, { recursive: true });
		}

		const appRoot = app.getAppPath();
		const cliPath = resolve(appRoot, "../../packages/gateway/src/cli.ts");
		const bunPath = findBun();

		gatewayLog.info("cli:", cliPath, "bun:", bunPath, "jaiHome:", jaiHome);

		this.child = spawn(bunPath, ["run", cliPath, "--port", String(this._port)], {
			cwd: jaiHome,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env },
		});

		this.child.stdout?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			gatewayLog.info(text.trimEnd());
			if (text.includes("listening")) {
				this._ready = true;
			}
		});

		this.child.stderr?.on("data", (chunk: Buffer) => {
			gatewayLog.error(chunk.toString().trimEnd());
		});

		this.child.on("exit", (code) => {
			gatewayLog.warn(`process exited with code ${code}`);
			this.child = null;
			this._ready = false;
		});

		await this.waitForReady();
	}

	private waitForReady(timeout = 15_000): Promise<void> {
		return new Promise((resolve, reject) => {
			const start = Date.now();
			const check = async () => {
				if (this._ready) return resolve();
				try {
					const res = await fetch(`${this.baseURL}/health`);
					if (res.ok) {
						this._ready = true;
						return resolve();
					}
				} catch {}
				if (Date.now() - start > timeout) {
					return reject(new Error("Gateway failed to start within timeout"));
				}
				setTimeout(check, 200);
			};
			setTimeout(check, 300);
		});
	}

	dispose(): void {
		if (this.child) {
			this.child.kill();
			this.child = null;
		}
		this._ready = false;
	}
}

export const gatewayProcess = new GatewayProcess();
