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
	const success = status >= 200 && status < 300;
	const title = success ? "Account connected" : status === 404 ? "Callback not found" : "Authorization failed";
	const statusLabel = success ? "Connected" : "Not connected";
	const nextStep = success
		? "You can close this tab and return to JAI."
		: "Return to JAI and start the connection again.";
	const tone = success ? "success" : "error";
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
		"content-type": "text/html; charset=utf-8",
		"referrer-policy": "no-referrer",
		"x-content-type-options": "nosniff",
		"x-frame-options": "DENY",
	});
	response.end(
		`<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="color-scheme" content="light dark">
	<meta name="theme-color" content="${success ? "#3e8e7e" : "#b42318"}">
	<title>${title} · JAI</title>
	<style>
		:root {
			font-family: "Avenir Next", Avenir, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			color: #2c2c2b;
			background: #f7f7f4;
			font-synthesis: none;
		}
		* { box-sizing: border-box; }
		body {
			min-height: 100vh;
			margin: 0;
			display: grid;
			place-items: center;
			padding: 32px 20px;
			background:
				radial-gradient(circle at 50% 0%, rgba(62, 142, 126, 0.08), transparent 42%),
				#f7f7f4;
		}
		main {
			width: min(100%, 460px);
			padding: 32px;
			border: 1px solid #deded8;
			border-radius: 16px;
			background: #fff;
		}
		.brand {
			display: flex;
			align-items: center;
			gap: 9px;
			margin-bottom: 44px;
			font-family: Georgia, "Times New Roman", serif;
			font-size: 20px;
			font-weight: 600;
			letter-spacing: -0.02em;
		}
		.brand-mark {
			width: 10px;
			height: 10px;
			border-radius: 50%;
			background: #3e8e7e;
			box-shadow: 0 0 0 5px rgba(62, 142, 126, 0.12);
		}
		.status {
			display: inline-flex;
			align-items: center;
			gap: 8px;
			min-height: 28px;
			padding: 0 11px;
			border-radius: 999px;
			font-size: 12px;
			font-weight: 650;
		}
		.status::before {
			content: "";
			width: 7px;
			height: 7px;
			border-radius: 50%;
			background: currentColor;
		}
		.success .status { color: #31705f; background: #e8f3ef; }
		.error .status { color: #9f2d24; background: #fcebe9; }
		h1 {
			margin: 18px 0 10px;
			font-family: Georgia, "Times New Roman", serif;
			font-size: clamp(30px, 8vw, 38px);
			font-weight: 400;
			line-height: 1.12;
			letter-spacing: -0.025em;
		}
		p {
			margin: 0;
			color: #6e6e69;
			font-size: 15px;
			line-height: 1.65;
		}
		.next-step {
			margin-top: 26px;
			padding-top: 20px;
			border-top: 1px solid #e7e7e2;
			color: #3f3f3c;
			font-size: 13px;
			font-weight: 550;
		}
		@media (max-width: 520px) {
			body { padding: 16px; }
			main { padding: 26px 24px; }
			.brand { margin-bottom: 36px; }
		}
		@media (prefers-color-scheme: dark) {
			:root { color: #f3f3ef; background: #242423; }
			body {
				background:
					radial-gradient(circle at 50% 0%, rgba(95, 189, 170, 0.1), transparent 42%),
					#242423;
			}
			main { border-color: #444440; background: #2c2c2b; }
			p { color: #aaa9a2; }
			.next-step { border-color: #444440; color: #e8e8e3; }
			.success .status { color: #73cfbb; background: rgba(62, 142, 126, 0.18); }
			.error .status { color: #f09a91; background: rgba(180, 35, 24, 0.18); }
		}
	</style>
</head>
<body>
	<main class="${tone}">
		<div class="brand"><span class="brand-mark" aria-hidden="true"></span>JAI</div>
		<div class="status">${statusLabel}</div>
		<h1>${title}</h1>
		<p>${escapeHtml(message)}</p>
		<p class="next-step">${nextStep}</p>
	</main>
</body>
</html>`,
	);
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/gu, (character) => {
		const entities: Record<string, string> = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#39;",
		};
		return entities[character]!;
	});
}
