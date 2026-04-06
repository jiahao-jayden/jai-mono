import { type ChildProcess, spawn } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";

const DEFAULT_PORT = 18900;

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

	async start(cwd?: string): Promise<void> {
		if (this.child) return;

		const workspaceCwd = cwd ?? resolve(homedir(), ".jai", "workspace");
		const cliPath = resolve(__dirname, "../../packages/gateway/src/cli.ts");

		this.child = spawn("bun", ["run", cliPath, "--port", String(this._port)], {
			cwd: workspaceCwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env },
		});

		this.child.stdout?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			console.log("[gateway]", text.trimEnd());
			if (text.includes("listening")) {
				this._ready = true;
			}
		});

		this.child.stderr?.on("data", (chunk: Buffer) => {
			console.error("[gateway]", chunk.toString().trimEnd());
		});

		this.child.on("exit", (code) => {
			console.log(`[gateway] process exited with code ${code}`);
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
