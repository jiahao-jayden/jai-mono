import { randomBytes } from "node:crypto";

type PendingFlow = {
	serverName: string;
	authUrl?: URL;
	resolve?: (code: string) => void;
	reject?: (err: Error) => void;
	abort?: AbortController;
};

/**
 * 管理 MCP server 进行中的 OAuth 授权 flow。
 *
 * 一个 server 同一时间最多一个 pending flow。
 * SDK 通过 `state` 参数把回调和 flow 关联起来。
 *
 * 取消时（用户主动 cancel / abort）通过 AbortController 同步关闭。
 */
export class PendingFlows {
	private byServer = new Map<string, PendingFlow>();
	private byState = new Map<string, string>(); // state → serverName

	createState(serverName: string): string {
		const state = randomBytes(16).toString("hex");
		this.byState.set(state, serverName);
		return state;
	}

	/**
	 * SDK 调到 redirectToAuthorization 时记录 URL。
	 * 若已有 wait() 创建的 flow，复用并升级；否则创建一个轻量记录，
	 * 让 manager 在 catch 到 UnauthorizedError 后能 getAuthUrl() 读到。
	 */
	registerAuthUrl(serverName: string, authUrl: URL): void {
		const flow = this.byServer.get(serverName);
		if (flow) {
			flow.authUrl = authUrl;
			return;
		}
		this.byServer.set(serverName, { serverName, authUrl });
	}

	/** 等 gateway callback 注入 code。返回 code，或在 abort/超时时 reject。 */
	wait(serverName: string, timeoutMs: number): { promise: Promise<string>; cancel: () => void } {
		this.cancelExisting(serverName);

		const abort = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;

		const promise = new Promise<string>((resolve, reject) => {
			const flow: PendingFlow = {
				serverName,
				resolve,
				reject,
				abort,
			};
			this.byServer.set(serverName, flow);

			timer = setTimeout(() => {
				this.cancelExisting(serverName, new Error(`OAuth flow timeout after ${timeoutMs}ms`));
			}, timeoutMs);

			abort.signal.addEventListener("abort", () => {
				if (timer) clearTimeout(timer);
				if (this.byServer.get(serverName) === flow) {
					this.byServer.delete(serverName);
				}
				reject(new Error("OAuth flow cancelled"));
			});
		});

		return {
			promise,
			cancel: () => this.cancelExisting(serverName),
		};
	}

	/** Gateway callback 拿 code 后调用，按 state 找 flow 并完成。 */
	fulfillByState(state: string, code: string): boolean {
		const serverName = this.byState.get(state);
		if (!serverName) return false;
		const flow = this.byServer.get(serverName);
		if (!flow || !flow.resolve) return false;
		this.byState.delete(state);
		this.byServer.delete(serverName);
		flow.resolve(code);
		return true;
	}

	getAuthUrl(serverName: string): URL | undefined {
		return this.byServer.get(serverName)?.authUrl;
	}

	/**
	 * 由 manager 的 completeAuthByState 直接消费：根据 state 找到 server，
	 * 清掉所有相关索引；不需要内部的 wait 协调。
	 */
	consumeStateForCompletion(state: string): string | undefined {
		const serverName = this.byState.get(state);
		if (!serverName) return undefined;
		this.byState.delete(state);
		const flow = this.byServer.get(serverName);
		if (flow) {
			this.byServer.delete(serverName);
			// 不调 abort——这是「成功」路径，不要 reject 任何 wait()
		}
		return serverName;
	}

	cancelExisting(serverName: string, err?: Error): void {
		const flow = this.byServer.get(serverName);
		if (!flow) return;
		this.byServer.delete(serverName);
		// state 由 fulfillByState 清理；这里残留也不影响
		// 先 reject 再 abort：abort listener 也会调 reject，但 promise 一旦
		// settled 后续 reject 是 no-op；这样调用方拿到的是真正的错误（如 timeout）。
		if (err && flow.reject) {
			flow.reject(err);
		}
		flow.abort?.abort();
	}
}
