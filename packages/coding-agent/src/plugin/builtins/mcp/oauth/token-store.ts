import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
	OAuthClientInformationMixed,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export type ServerCredentials = {
	tokens?: OAuthTokens;
	clientInformation?: OAuthClientInformationMixed;
	codeVerifier?: string;
};

type StoreShape = Record<string, ServerCredentials>;

/**
 * 把 MCP server 的 OAuth tokens / 客户端注册信息 / PKCE code verifier
 * 持久化到 `~/.jai/mcp-tokens.json`，权限 `0o600`。
 *
 * 写入是 atomic 的（先写 tmp 再 rename），避免崩溃时半截文件。
 */
export class TokenStore {
	private cache: StoreShape | null = null;
	private writePromise: Promise<unknown> = Promise.resolve();

	constructor(private readonly path: string) {}

	private async load(): Promise<StoreShape> {
		if (this.cache) return this.cache;
		try {
			const raw = await readFile(this.path, "utf8");
			const parsed = JSON.parse(raw) as StoreShape;
			this.cache = parsed && typeof parsed === "object" ? parsed : {};
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				this.cache = {};
			} else {
				throw err;
			}
		}
		return this.cache!;
	}

	private async write(next: StoreShape): Promise<void> {
		this.cache = next;
		// 串行化写入
		this.writePromise = this.writePromise.then(async () => {
			await mkdir(dirname(this.path), { recursive: true });
			const tmp = `${this.path}.tmp.${process.pid}`;
			await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
			// rename 在 POSIX 是 atomic 的
			const { rename, chmod } = await import("node:fs/promises");
			await rename(tmp, this.path);
			// 兜底：rename 后再确认权限
			try {
				const s = await stat(this.path);
				if ((s.mode & 0o777) !== 0o600) {
					await chmod(this.path, 0o600);
				}
			} catch {
				// ignore
			}
		});
		await this.writePromise;
	}

	async get(serverName: string): Promise<ServerCredentials | undefined> {
		const all = await this.load();
		return all[serverName];
	}

	async patch(serverName: string, patch: Partial<ServerCredentials>): Promise<void> {
		const all = { ...(await this.load()) };
		const prev = all[serverName] ?? {};
		all[serverName] = { ...prev, ...patch };
		await this.write(all);
	}

	async clear(serverName: string, scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
		const all = { ...(await this.load()) };
		const entry = all[serverName];
		if (!entry) return;
		if (scope === "all" || scope === "tokens") entry.tokens = undefined;
		if (scope === "all" || scope === "client") entry.clientInformation = undefined;
		if (scope === "all" || scope === "verifier") entry.codeVerifier = undefined;
		// "discovery" 我们当前不缓存
		all[serverName] = entry;
		await this.write(all);
	}
}
