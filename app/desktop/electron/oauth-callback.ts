import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { TaggedError } from "better-result";

const oauthCallbackHost = "127.0.0.1";
const oauthCallbackPort = 43821;
const oauthCallbackPath = "/v1/oauth/callback";

export const desktopOAuthCallbackUrl = `http://${oauthCallbackHost}:${oauthCallbackPort}${oauthCallbackPath}`;

class DesktopOAuthCallbackServerFailed extends TaggedError("desktop_oauth.callback_server_failed")<{
	readonly cause?: unknown;
	readonly data: { readonly host: string; readonly port: number };
	readonly message: string;
}> {}

export class DesktopOAuthCallbackServer {
	readonly #onCallback: (url: string) => Promise<void>;
	#server: Server | undefined;
	#starting: Promise<void> | undefined;
	#closing: Promise<void> | undefined;

	constructor(options: { readonly onCallback: (url: string) => Promise<void> }) {
		this.#onCallback = options.onCallback;
	}

	async start(): Promise<void> {
		if (this.#server?.listening) return;
		this.#starting ??= this.#listen();
		try {
			await this.#starting;
		} finally {
			this.#starting = undefined;
		}
	}

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		const server = this.#server;
		this.#server = undefined;
		if (!server) return Promise.resolve();
		const closing = new Promise<void>((resolve) => {
			server.close(() => resolve());
		}).finally(() => {
			this.#closing = undefined;
		});
		this.#closing = closing;
		return closing;
	}

	async #listen(): Promise<void> {
		const server = createServer((request, response) => {
			void this.#handleRequest(request, response);
		});
		this.#server = server;
		await new Promise<void>((resolve, reject) => {
			const fail = (cause: unknown) => {
				server.off("listening", ready);
				this.#server = undefined;
				reject(
					new DesktopOAuthCallbackServerFailed({
						message: `JAI could not listen for OAuth callbacks on ${oauthCallbackHost}:${oauthCallbackPort}`,
						data: { host: oauthCallbackHost, port: oauthCallbackPort },
						cause,
					}),
				);
			};
			const ready = () => {
				server.off("error", fail);
				resolve();
			};
			server.once("error", fail);
			server.once("listening", ready);
			server.listen(oauthCallbackPort, oauthCallbackHost);
		});
	}

	async #handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const callback = request.url ? new URL(request.url, desktopOAuthCallbackUrl) : undefined;
		if (request.method !== "GET" || !callback || !isDesktopOAuthCallbackUrl(callback)) {
			writeCallbackPage(response, 404, "JAI could not find this OAuth callback.");
			return;
		}
		try {
			await this.#onCallback(callback.toString());
			writeCallbackPage(response, 200, "Your account is connected. You can return to JAI.");
		} catch {
			writeCallbackPage(response, 400, "JAI could not complete this authorization. Return to JAI and try again.");
		}
	}
}

export function isDesktopOAuthCallbackUrl(url: URL): boolean {
	return (
		url.protocol === "http:" &&
		url.hostname === oauthCallbackHost &&
		url.port === String(oauthCallbackPort) &&
		url.pathname === oauthCallbackPath
	);
}

function writeCallbackPage(response: ServerResponse, status: number, message: string): void {
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "text/html; charset=utf-8",
		"referrer-policy": "no-referrer",
	});
	response.end(
		`<!doctype html><html lang="en"><meta charset="utf-8"><title>JAI</title><body><p>${message}</p></body></html>`,
	);
}
