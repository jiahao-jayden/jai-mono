import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Result, type Result as ResultType } from "better-result";
import TurndownService from "turndown";
import { WebFetchFailed } from "./fetch-errors";

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 1_000_000;
const MAX_TEXT_LENGTH = 80_000;
const REQUEST_TIMEOUT_MS = 15_000;
const JINA_READER_URL = "https://r.jina.ai/";
const ALLOWED_MIME_TYPES = new Set([
	"application/json",
	"application/xml",
	"text/html",
	"text/markdown",
	"text/plain",
	"text/xml",
]);

export interface WebFetchResponse {
	readonly url: string;
	readonly title: string;
	readonly content: string;
	readonly mimeType: string;
	readonly redirects: readonly string[];
}

export interface WebFetchTransport {
	(input: string, init: RequestInit): Promise<Response>;
}

export interface WebFetchOptions {
	readonly transport?: WebFetchTransport;
	readonly jinaApiKey?: string;
	readonly lookup?: (hostname: string) => Promise<readonly string[]>;
	readonly timeoutMs?: number;
}

interface WebFetchRequest {
	readonly response: Response;
	readonly signal: AbortSignal;
	readonly timeoutSignal: AbortSignal;
}

export class WebFetchRuntime {
	readonly #transport: WebFetchTransport;
	readonly #jinaApiKey?: string;
	readonly #lookup: (hostname: string) => Promise<readonly string[]>;
	readonly #timeoutMs: number;
	readonly #cache = new Map<string, WebFetchResponse>();

	constructor(options: WebFetchOptions = {}) {
		this.#transport = options.transport ?? ((input, init) => fetch(input, init));
		this.#jinaApiKey = options.jinaApiKey?.trim() || undefined;
		this.#lookup = options.lookup ?? defaultLookup;
		this.#timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
	}

	remember(response: WebFetchResponse): void {
		this.#cache.set(response.url, response);
	}

	async fetch(
		input: string,
		refresh = false,
		signal?: AbortSignal,
	): Promise<ResultType<WebFetchResponse, WebFetchFailed>> {
		const parsed = parseRemoteUrl(input);
		if (parsed.isErr()) return parsed;
		if (!refresh) {
			const cached = this.#cache.get(parsed.value.toString());
			if (cached) return Result.ok(cached);
		}
		const initialSafe = await this.#assertSafeTarget(parsed.value, signal);
		if (initialSafe.isErr()) return initialSafe;
		const jina = await this.#fetchWithJina(parsed.value, signal);
		if (jina.isOk()) {
			this.#cache.set(parsed.value.toString(), jina.value);
			return jina;
		}
		if (jina.error.reason === "aborted") return jina;
		return this.#fetchDirect(parsed.value, signal);
	}

	async #fetchDirect(
		parsed: URL,
		signal?: AbortSignal,
	): Promise<ResultType<WebFetchResponse, WebFetchFailed>> {
		let current = parsed;
		const redirects: string[] = [];
		for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
			const safe = await this.#assertSafeTarget(current, signal);
			if (safe.isErr()) return safe;
			const request = await this.#request(current.toString(), signal);
			if (request.isErr()) return request;
			const response = request.value.response;
			if (isRedirect(response.status)) {
				if (redirectCount === MAX_REDIRECTS) {
					return Result.err(new WebFetchFailed({ reason: "redirect_limit", message: "Web Fetch redirect limit exceeded" }));
				}
				const location = response.headers.get("location");
				if (!location) return Result.err(new WebFetchFailed({ reason: "invalid_response", message: "Redirect response has no Location header" }));
				const next = parseRemoteUrl(new URL(location, current).toString());
				if (next.isErr()) return next;
				redirects.push(next.value.toString());
				current = next.value;
				continue;
			}
			if (!response.ok) {
				return Result.err(new WebFetchFailed({ reason: "upstream", message: `Web Fetch returned HTTP ${response.status}`, status: response.status }));
			}
			const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
			if (!ALLOWED_MIME_TYPES.has(mimeType)) {
				return Result.err(new WebFetchFailed({ reason: "unsupported_mime", message: `Web Fetch does not read MIME type "${mimeType || "unknown"}"` }));
			}
			const body = await readBody(response, request.value.signal, signal, request.value.timeoutSignal);
			if (body.isErr()) return body;
			const content = limitText(mimeType === "text/html" ? extractHtmlText(body.value) : normalizeText(body.value));
			const result: WebFetchResponse = {
				url: current.toString(),
				title: mimeType === "text/html" ? extractHtmlTitle(body.value) || current.hostname : current.hostname,
				content,
				mimeType,
				redirects,
			};
			this.#cache.set(parsed.toString(), result);
			this.#cache.set(current.toString(), result);
			return Result.ok(result);
		}
		return Result.err(new WebFetchFailed({ reason: "redirect_limit", message: "Web Fetch redirect limit exceeded" }));
	}

	async #fetchWithJina(
		url: URL,
		signal?: AbortSignal,
	): Promise<ResultType<WebFetchResponse, WebFetchFailed>> {
		const request = await this.#request(`${JINA_READER_URL}${url.toString()}`, signal, {
			accept: "text/markdown, text/plain",
			"x-return-format": "markdown",
			...(this.#jinaApiKey ? { authorization: `Bearer ${this.#jinaApiKey}` } : {}),
		});
		if (request.isErr()) return request;
		const response = request.value.response;
		if (!response.ok) {
			return Result.err(
				new WebFetchFailed({
					reason: "upstream",
					message: `Jina Reader returned HTTP ${response.status}`,
					status: response.status,
				}),
			);
		}
		const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
		if (mimeType !== "text/markdown" && mimeType !== "text/plain") {
			return Result.err(
				new WebFetchFailed({
					reason: "unsupported_mime",
					message: `Jina Reader returned unsupported MIME type "${mimeType || "unknown"}"`,
				}),
			);
		}
		const body = await readBody(response, request.value.signal, signal, request.value.timeoutSignal);
		if (body.isErr()) return body;
		const content = limitText(normalizeText(body.value));
		if (!content) {
			return Result.err(new WebFetchFailed({ reason: "invalid_response", message: "Jina Reader returned empty content" }));
		}
		return Result.ok({
			url: url.toString(),
			title: extractMarkdownTitle(content) || url.hostname,
			content,
			mimeType: "text/markdown",
			redirects: [],
		});
	}

	async #assertSafeTarget(url: URL, signal?: AbortSignal): Promise<ResultType<void, WebFetchFailed>> {
		if (signal?.aborted) return Result.err(new WebFetchFailed({ reason: "aborted", message: "Web Fetch was cancelled" }));
		if (url.port && url.port !== "80" && url.port !== "443") {
			return Result.err(new WebFetchFailed({ reason: "blocked_target", message: "Web Fetch only allows ports 80 and 443" }));
		}
		const hostname = url.hostname.replace(/\.$/, "").toLowerCase();
		if (isBlockedHostname(hostname)) {
			return Result.err(new WebFetchFailed({ reason: "blocked_target", message: "Web Fetch target is not a public host" }));
		}
		if (isPrivateAddress(hostname)) {
			return Result.err(new WebFetchFailed({ reason: "blocked_target", message: "Web Fetch target is a private address" }));
		}
		if (isIP(hostname)) return Result.ok(undefined);
		try {
			const addresses = await this.#lookup(hostname);
			if (signal?.aborted) return Result.err(new WebFetchFailed({ reason: "aborted", message: "Web Fetch was cancelled" }));
			if (!addresses.length || addresses.some(isPrivateAddress)) {
				return Result.err(new WebFetchFailed({ reason: "blocked_target", message: "Web Fetch target resolved to a non-public address" }));
			}
			return Result.ok(undefined);
		} catch (cause) {
			return Result.err(new WebFetchFailed({ reason: "dns_failed", message: "Web Fetch could not resolve the target host", cause }));
		}
	}

	async #request(
		url: string,
		signal?: AbortSignal,
		headers: Record<string, string> = {
			accept: "text/html, text/plain, text/markdown, application/json, application/xml, text/xml",
		},
	): Promise<ResultType<WebFetchRequest, WebFetchFailed>> {
		const timeout = AbortSignal.timeout(this.#timeoutMs);
		const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
		if (combined.aborted) {
			return Result.err(
				new WebFetchFailed({
					reason: signal?.aborted ? "aborted" : "timeout",
					message: signal?.aborted ? "Web Fetch was cancelled" : "Web Fetch timed out",
				}),
			);
		}
		try {
			const response = await this.#transport(url, {
				method: "GET",
				redirect: "manual",
				headers,
				signal: combined,
			});
			return Result.ok({ response, signal: combined, timeoutSignal: timeout });
		} catch (cause) {
			if (signal?.aborted) return Result.err(new WebFetchFailed({ reason: "aborted", message: "Web Fetch was cancelled", cause }));
			if (timeout.aborted) return Result.err(new WebFetchFailed({ reason: "timeout", message: "Web Fetch timed out", cause }));
			return Result.err(new WebFetchFailed({ reason: "network", message: "Web Fetch request failed", cause }));
		}
	}
}

async function defaultLookup(hostname: string): Promise<readonly string[]> {
	return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

async function readBody(
	response: Response,
	requestSignal: AbortSignal,
	callerSignal?: AbortSignal,
	timeoutSignal?: AbortSignal,
): Promise<ResultType<string, WebFetchFailed>> {
	if (response.headers.get("content-length")) {
		const length = Number(response.headers.get("content-length"));
		if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
			return Result.err(new WebFetchFailed({ reason: "body_too_large", message: "Web Fetch response is too large" }));
		}
	}
	if (!response.body) return Result.ok("");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			if (requestSignal.aborted) return Result.err(fetchAbortFailure(callerSignal, timeoutSignal));
			const chunk = await readChunk(reader, requestSignal);
			if (chunk.done) break;
			const value = chunk.value;
			if (!value) return Result.err(new WebFetchFailed({ reason: "invalid_response", message: "Web Fetch returned an unreadable body" }));
			total += value.byteLength;
			if (total > MAX_BODY_BYTES) return Result.err(new WebFetchFailed({ reason: "body_too_large", message: "Web Fetch response is too large" }));
			chunks.push(value);
		}
		const bytes = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return Result.ok(new TextDecoder().decode(bytes));
	} catch (cause) {
		if (callerSignal?.aborted) return Result.err(new WebFetchFailed({ reason: "aborted", message: "Web Fetch was cancelled", cause }));
		if (timeoutSignal?.aborted) return Result.err(new WebFetchFailed({ reason: "timeout", message: "Web Fetch timed out", cause }));
		return Result.err(new WebFetchFailed({ reason: "network", message: "Web Fetch response could not be read", cause }));
	} finally {
		await reader.cancel().catch(() => {});
	}
}

function readChunk(
	reader: { read: () => Promise<{ readonly done: boolean; readonly value?: Uint8Array }> },
	signal: AbortSignal,
): Promise<{ readonly done: boolean; readonly value?: Uint8Array }> {
	if (signal.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			cleanup();
			reject(new DOMException("aborted", "AbortError"));
		};
		const cleanup = () => signal.removeEventListener("abort", onAbort);
		signal.addEventListener("abort", onAbort, { once: true });
		reader.read().then(
			(value) => {
				cleanup();
				resolve(value);
			},
			(error) => {
				cleanup();
				reject(error);
			},
		);
	});
}

function fetchAbortFailure(callerSignal?: AbortSignal, timeoutSignal?: AbortSignal): WebFetchFailed {
	if (callerSignal?.aborted) return new WebFetchFailed({ reason: "aborted", message: "Web Fetch was cancelled" });
	if (timeoutSignal?.aborted) return new WebFetchFailed({ reason: "timeout", message: "Web Fetch timed out" });
	return new WebFetchFailed({ reason: "aborted", message: "Web Fetch was cancelled" });
}

function parseRemoteUrl(value: string): ResultType<URL, WebFetchFailed> {
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return Result.err(new WebFetchFailed({ reason: "invalid_url", message: "Web Fetch only allows HTTP(S) URLs" }));
		}
		if (url.username || url.password || !url.hostname) {
			return Result.err(new WebFetchFailed({ reason: "invalid_url", message: "Web Fetch URL contains unsupported credentials or host data" }));
		}
		return Result.ok(url);
	} catch (cause) {
		return Result.err(new WebFetchFailed({ reason: "invalid_url", message: "Web Fetch URL is invalid", cause }));
	}
}

function isRedirect(status: number): boolean {
	return status >= 300 && status < 400;
}

function isBlockedHostname(hostname: string): boolean {
	return hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".test") || hostname.endsWith(".invalid");
}

function isPrivateAddress(value: string): boolean {
	const normalized = value.replace(/^\[|\]$/g, "").toLowerCase();
	if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
	if (isIP(normalized) === 6) return isPrivateIpv6(normalized);
	return false;
}

function isPrivateIpv4(value: string): boolean {
	const parts = value.split(".").map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
	const [first, second] = parts;
	return first === 0 || first === 10 || first === 127 || (first === 100 && second! >= 64 && second! <= 127) || (first === 169 && second === 254) || (first === 172 && second! >= 16 && second! <= 31) || (first === 192 && second === 0) || (first === 192 && second === 168) || (first === 198 && (second === 18 || second === 19)) || first >= 224;
}

function isPrivateIpv6(value: string): boolean {
	const groups = ipv6Groups(value);
	if (!groups) return true;
	const first = groups[0]!;
	if (groups.every((group) => group === 0) || groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;
	if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return true;
	if (first === 0x2001 && groups[1] === 0x0db8) return true;
	if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
		return isPrivateIpv4(`${groups[6]! >>> 8}.${groups[6]! & 255}.${groups[7]! >>> 8}.${groups[7]! & 255}`);
	}
	return false;
}

function ipv6Groups(value: string): number[] | undefined {
	const sections = value.split("::");
	if (sections.length > 2) return undefined;
	const head = sections[0] ? sections[0].split(":").filter(Boolean).map((part) => Number.parseInt(part, 16)) : [];
	const tail = sections[1] ? sections[1].split(":").filter(Boolean).map((part) => Number.parseInt(part, 16)) : [];
	if ([...head, ...tail].some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return undefined;
	if (sections.length === 1 && head.length !== 8) return undefined;
	if (sections.length === 2 && head.length + tail.length >= 8) return undefined;
	return sections.length === 2 ? [...head, ...Array.from({ length: 8 - head.length - tail.length }, () => 0), ...tail] : head;
}

function extractHtmlTitle(value: string): string {
	const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(value);
	return match ? decodeEntities(stripHtml(match[1]!)).trim() : "";
}

function extractHtmlText(value: string): string {
	return normalizeText(turndown.turndown(value.replace(/<(head|script|style|noscript|template|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")));
}

const turndown = new TurndownService({
	bulletListMarker: "-",
	codeBlockStyle: "fenced",
	headingStyle: "atx",
});

function extractMarkdownTitle(value: string): string {
	const match = /^#\s+(.+)$/m.exec(value);
	return match?.[1]?.trim() ?? "";
}

function stripHtml(value: string): string {
	return value.replace(/<!--([\s\S]*?)-->/g, " ").replace(/<[^>]+>/g, " ");
}

function decodeEntities(value: string): string {
	return value
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)));
}

function normalizeText(value: string): string {
	return value.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function limitText(value: string): string {
	return value.length <= MAX_TEXT_LENGTH ? value : `${value.slice(0, MAX_TEXT_LENGTH)}\n\n[Content truncated]`;
}
