const REDACTED = "[REDACTED]";

const SECRET_NAMES =
	"access[-_]?token|api[-_]?key|api[-_]?token|auth|auth[-_]?token|authorization|client[-_]?secret|cookie|credential|credentials|id[-_]?token|passphrase|passwd|password|private[-_]?key|refresh[-_]?token|secret|secret[-_]?key|session[-_]?token|token";

const URL_CREDENTIALS_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:]*:[^/\s]+@/giu;
const KEY_VALUE_SECRET_PATTERN = new RegExp(`((?:^|[?&\\s;,])(?:${SECRET_NAMES})=)[^&#\\s,;]*`, "giu");
const JSON_SECRET_PATTERN = new RegExp(`("(?:${SECRET_NAMES})"\\s*:\\s*")[^"]*`, "giu");
const SCHEMED_CREDENTIAL_PATTERN = /\b(bearer|basic|digest|apikey|api[_-]?key)\s+[A-Za-z0-9._~+/=-]+/giu;
const API_KEY_HEADER_PATTERN = /\b((?:x-)?(?:goog-)?api[-_]?key\s*:\s*)[^\s,;]+/giu;
const COOKIE_HEADER_PATTERN = /\b((?:set[-_ ]?cookie|cookie)\s*:\s*)[^,\r\n]+/giu;
// ponytail: bare provider key shapes only (OpenAI/Anthropic `sk-…`, Google `AIza…`); add new vendors as they appear.
const BARE_API_KEY_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,})/gu;

/**
 * 抹掉文本里常见的凭证形态，不遍历对象键。输出会进入日志，也会作为失败详情跨进程到达客户端。
 */
export function redactSecrets(value: string): string {
	return value
		.replace(URL_CREDENTIALS_PATTERN, `$1${REDACTED}@`)
		.replace(JSON_SECRET_PATTERN, `$1${REDACTED}`)
		.replace(KEY_VALUE_SECRET_PATTERN, `$1${REDACTED}`)
		.replace(SCHEMED_CREDENTIAL_PATTERN, `$1 ${REDACTED}`)
		.replace(API_KEY_HEADER_PATTERN, `$1${REDACTED}`)
		.replace(COOKIE_HEADER_PATTERN, `$1${REDACTED}`)
		.replace(BARE_API_KEY_PATTERN, REDACTED);
}
