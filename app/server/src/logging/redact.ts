const REDACTED = "[REDACTED]";

const URL_CREDENTIALS_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:]*:[^/\s]+@/giu;
const QUERY_SECRET_PARAM_PATTERN =
	/([?&](?:access[-_]?token|api[-_]?key|api[-_]?token|auth|auth[-_]?token|authorization|client[-_]?secret|cookie|credential|credentials|id[-_]?token|passphrase|passwd|password|private[-_]?key|refresh[-_]?token|secret|secret[-_]?key|session[-_]?token|token)=)[^&#\s]*/giu;
const SCHEMED_CREDENTIAL_PATTERN = /\b(bearer|basic|digest|apikey|api[_-]?key)\s+[A-Za-z0-9._~+/=-]+/giu;
const COOKIE_HEADER_PATTERN = /\b((?:set[-_ ]?cookie|cookie)\s*:\s*)[^,\r\n]+/giu;

/** 只抹掉日志文本里常见的凭证形态，不遍历对象键。 */
export function redactSecrets(value: string): string {
	return value
		.replace(URL_CREDENTIALS_PATTERN, `$1${REDACTED}@`)
		.replace(QUERY_SECRET_PARAM_PATTERN, `$1${REDACTED}`)
		.replace(SCHEMED_CREDENTIAL_PATTERN, `$1 ${REDACTED}`)
		.replace(COOKIE_HEADER_PATTERN, `$1${REDACTED}`);
}
