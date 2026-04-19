/**
 * 内置危险检测 —— 只有命中这里的规则才会弹窗，其余全部放行。
 *
 * 设计原则：
 *   - 0 配置默认覆盖绝大多数风险；用户可通过 `dangerousPaths: string[]` 追加敏感路径
 *   - 路径检查统一在解析为 absolute path 后比对；不依赖正则猜路径形态
 *   - 所有 check 是纯函数：(toolName, args, ctx) → PermissionRequest | null
 */

import { homedir } from "node:os";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import type { PermissionRequest } from "./types.js";

export type DangerCheckCtx = {
	cwd: string;
	/** 用户自定义敏感路径 glob（简单前缀匹配，支持 ~ 展开）。 */
	extraDangerousPaths?: string[];
};

export type DangerCheck = (toolName: string, args: unknown, ctx: DangerCheckCtx) => PermissionRequest | null;

// ---------- helpers ----------

function expandHome(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
	return p;
}

/** 把任意路径变成 normalize 过的绝对路径。 */
export function toAbs(target: string, cwd: string): string {
	const expanded = expandHome(target);
	return normalize(isAbsolute(expanded) ? expanded : resolve(cwd, expanded));
}

/** target 是否在 base 之内（含同路径）。 */
export function isInside(target: string, base: string): boolean {
	const rel = relative(base, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// ---------- 内置敏感目录/文件列表 ----------

const HOME_SENSITIVE_PATHS = [
	".ssh",
	".aws",
	".gcp",
	".config/gcloud",
	".kube",
	".docker/config.json",
	".npmrc",
	".pypirc",
	".bashrc",
	".bash_profile",
	".zshrc",
	".zprofile",
	".profile",
	".gitconfig",
	".netrc",
	// jai 自身的密钥/会话存储 —— 防止 prompt injection 让 LLM 读取 api_key 或对话历史。
	".jai/settings.json",
	".jai/projects",
];

/** cwd 内即使是项目文件也敏感。 */
const CWD_SENSITIVE_BASENAMES = [".git", ".env"];

/**
 * cwd 内精确路径敏感（前缀匹配）。
 * `.jai/SOUL.md` 等 prompt 文件不在此列表（允许 LLM 读自己的 prompt），
 * 但 `.jai/settings.json` 和 `.jai/projects/` 必须拦。
 */
const CWD_SENSITIVE_RELATIVE_PATHS = [".jai/settings.json", ".jai/projects"];

function matchesHomeSensitive(abs: string): string | null {
	const home = homedir();
	for (const p of HOME_SENSITIVE_PATHS) {
		const full = resolve(home, p);
		if (abs === full || abs.startsWith(full + sep)) return p;
	}
	return null;
}

/** cwd 内 basename 类敏感（`.git`、`.env*`）—— 仅写检查，不拦读。 */
function matchesCwdSensitiveBasename(abs: string, cwd: string): string | null {
	if (!isInside(abs, cwd)) return null;
	const rel = relative(cwd, abs);
	const segments = rel.split(sep);
	for (const base of CWD_SENSITIVE_BASENAMES) {
		// .git/ 任意子路径 / .env / .env.local / .env.* 等
		if (segments[0] === base) return base;
		if (base === ".env" && segments[0]?.startsWith(".env")) return segments[0];
	}
	return null;
}

/** cwd 内精确路径敏感（`.jai/settings.json`、`.jai/projects`）—— 读写都拦。 */
function matchesCwdSensitiveExact(abs: string, cwd: string): string | null {
	if (!isInside(abs, cwd)) return null;
	for (const sensitive of CWD_SENSITIVE_RELATIVE_PATHS) {
		const full = resolve(cwd, sensitive);
		if (abs === full || abs.startsWith(full + sep)) return sensitive;
	}
	return null;
}

/** 写检查用的合并视图。 */
function matchesCwdSensitive(abs: string, cwd: string): string | null {
	return matchesCwdSensitiveBasename(abs, cwd) ?? matchesCwdSensitiveExact(abs, cwd);
}

function matchesUserExtra(abs: string, extras: string[] | undefined, cwd: string): string | null {
	if (!extras?.length) return null;
	for (const raw of extras) {
		const expanded = toAbs(raw, cwd);
		if (abs === expanded || abs.startsWith(expanded + sep)) return raw;
	}
	return null;
}

// ---------- 文件写检查 ----------

function isWriteTool(toolName: string): boolean {
	return toolName === "FileWrite" || toolName === "FileEdit";
}

const checkFileWrite: DangerCheck = (toolName, args, ctx) => {
	if (!isWriteTool(toolName)) return null;
	const path = (args as { path?: unknown })?.path;
	if (typeof path !== "string" || !path) return null;

	const abs = toAbs(path, ctx.cwd);

	const home = matchesHomeSensitive(abs);
	if (home) {
		return {
			category: "sensitive_path",
			reason: `写入用户敏感文件：~/${home}`,
			muteKey: `write:${abs}`,
			metadata: { path: abs, op: toolName, kind: "home_sensitive" },
		};
	}

	const cwdSens = matchesCwdSensitive(abs, ctx.cwd);
	if (cwdSens) {
		return {
			category: "sensitive_path",
			reason: `写入项目敏感路径：${cwdSens}`,
			muteKey: `write:${abs}`,
			metadata: { path: abs, op: toolName, kind: "cwd_sensitive" },
		};
	}

	const extra = matchesUserExtra(abs, ctx.extraDangerousPaths, ctx.cwd);
	if (extra) {
		return {
			category: "user_dangerous_path",
			reason: `写入自定义敏感路径：${extra}`,
			muteKey: `write:${abs}`,
			metadata: { path: abs, op: toolName, matchedRule: extra },
		};
	}

	return null;
};

// ---------- 文件读检查 ----------

const checkFileRead: DangerCheck = (toolName, args, ctx) => {
	if (toolName !== "FileRead") return null;
	const path = (args as { path?: unknown })?.path;
	if (typeof path !== "string" || !path) return null;

	// 拦 "读敏感凭证"——~/.ssh/、~/.aws/credentials、~/.jai/settings.json 等。
	// 普通的 cwd 外读取（项目隔壁、/tmp、用户其它项目）一律放行。
	const abs = toAbs(path, ctx.cwd);
	const home = matchesHomeSensitive(abs);
	if (home) {
		return {
			category: "sensitive_read",
			reason: `读取用户敏感文件：~/${home}`,
			muteKey: `read:${abs}`,
			metadata: { path: abs, kind: "home_sensitive" },
		};
	}
	// 注意：read 不拦 cwd 内 `.env` / `.git`（项目内读这些是日常需求），
	// 只拦精确路径名单（`.jai/settings.json` 等含 api_key/会话历史的文件）。
	const cwdSens = matchesCwdSensitiveExact(abs, ctx.cwd);
	if (cwdSens) {
		return {
			category: "sensitive_read",
			reason: `读取项目敏感文件：${cwdSens}`,
			muteKey: `read:${abs}`,
			metadata: { path: abs, kind: "cwd_sensitive" },
		};
	}
	return null;
};

// ---------- Bash 危险命令 ----------

const DANGEROUS_BASH = [
	{ pattern: /\bsudo\b/, label: "sudo 提权" },
	// rm 删除是不可逆的，无论参数都先问一次；同会话内可 allow_session 静音
	{ pattern: /\brm\b/, label: "rm 删除文件" },
	{ pattern: /\b(curl|wget)\b[^|;&]*\|\s*(sh|bash|zsh)\b/, label: "管道执行远端脚本（curl|sh）" },
	{ pattern: /\bchmod\s+-?[0-7]*7[0-7]{2}\b/, label: "chmod 777 类宽权限" },
	{ pattern: /\bcrontab\s+(-e|-r)\b/, label: "修改 crontab" },
	{ pattern: />\s*\/dev\/(sd|nvme|disk)/, label: "直接写裸盘设备" },
	{ pattern: /\bmkfs(\.\w+)?\b/, label: "mkfs 格式化" },
	{ pattern: /\bdd\b[^|;&]*\bof=\/dev\//, label: "dd 写设备" },
	// 防 prompt injection 通过 Bash 绕过 FileRead/FileWrite 拦截直接读写 jai 密钥/会话文件。
	// `.jai/SOUL.md` 等 prompt 文件不在此列表（允许通过 Bash 操作）。
	{ pattern: /\.jai\/(settings\.json|projects)\b/, label: "访问 jai 密钥/会话文件" },
];

const checkBash: DangerCheck = (toolName, args, _ctx) => {
	if (toolName !== "Bash") return null;
	const command = (args as { command?: unknown })?.command;
	if (typeof command !== "string" || !command) return null;

	for (const { pattern, label } of DANGEROUS_BASH) {
		if (pattern.test(command)) {
			return {
				category: "dangerous_bash",
				reason: `危险命令（${label}）：${command}`,
				muteKey: `bash:${command}`,
				metadata: { command, matchedRule: label },
			};
		}
	}
	return null;
};

// ---------- 注册表 ----------

export const DEFAULT_DANGER_CHECKS: DangerCheck[] = [checkFileWrite, checkFileRead, checkBash];

/**
 * 串行跑所有 check，命中第一条就返回；无命中返回 null。
 */
export function detectDanger(
	toolName: string,
	args: unknown,
	ctx: DangerCheckCtx,
	checks: DangerCheck[] = DEFAULT_DANGER_CHECKS,
): PermissionRequest | null {
	for (const check of checks) {
		const req = check(toolName, args, ctx);
		if (req) return req;
	}
	return null;
}
