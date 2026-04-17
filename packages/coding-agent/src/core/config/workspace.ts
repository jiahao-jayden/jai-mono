import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = ".jai";
const SETTINGS_FILE = "settings.json";
const BUILTIN_PROMPT_DIR = join(import.meta.dirname, "..", "prompt", "builtin");

export type WorkspaceConfig = {
	cwd: string;
	home?: string;
};

/**
 * 完全解析后的 prompt 内容。
 * 由 Workspace.loadPrompts() 产出，传入 buildSystemPrompt()。
 */
export type ResolvedPrompts = {
	static: string;
	soul: string;
	agents: string;
	tools: string;
};

/**
 * Workspace — 以 cwd 为中心的项目作用域。
 *
 * 三层目录（prompt 解析优先级）：
 * - 项目级：cwd/.jai/（最高）
 * - 全局级：~/.jai/（次之）
 * - 内置：src/core/prompt/（兜底）
 *
 * 不是安全沙箱——工具可以访问 cwd 之外的路径。
 */
export class Workspace {
	readonly cwd: string;
	readonly projectDir: string;
	readonly globalDir: string;

	private constructor(cwd: string, home: string) {
		this.cwd = cwd;
		this.projectDir = join(cwd, CONFIG_DIR);
		this.globalDir = join(home, CONFIG_DIR);
	}

	static async create(config: WorkspaceConfig): Promise<Workspace> {
		const ws = new Workspace(config.cwd, config.home ?? homedir());
		await Promise.all([mkdir(ws.globalDir, { recursive: true }), mkdir(ws.projectDir, { recursive: true })]);
		return ws;
	}

	// ── Settings ──────────────────────────────────────────

	get globalSettingsPath(): string {
		return join(this.globalDir, SETTINGS_FILE);
	}

	get projectSettingsPath(): string {
		return join(this.projectDir, SETTINGS_FILE);
	}

	// ── Prompts ───────────────────────────────────────────

	/**
	 * 三层解析：项目级 > 全局级 > 内置。
	 * 可覆盖的文件走三层，STATIC 始终内置。
	 */
	private async resolvePrompt(name: string): Promise<string> {
		const projectFile = Bun.file(join(this.projectDir, name));
		if (await projectFile.exists()) return projectFile.text();

		const globalFile = Bun.file(join(this.globalDir, name));
		if (await globalFile.exists()) return globalFile.text();

		return Bun.file(join(BUILTIN_PROMPT_DIR, name)).text();
	}

	/**
	 * 加载所有 prompt 文件，返回完全解析后的内容。
	 * STATIC 始终使用内置版本（不可覆盖）。
	 * SOUL / AGENTS / TOOLS 走三层优先级。
	 */
	async loadPrompts(): Promise<ResolvedPrompts> {
		const [staticPrompt, soul, agents, tools] = await Promise.all([
			Bun.file(join(BUILTIN_PROMPT_DIR, "STATIC.md")).text(),
			this.resolvePrompt("SOUL.md"),
			this.resolvePrompt("AGENTS.md"),
			this.resolvePrompt("TOOLS.md"),
		]);
		return { static: staticPrompt, soul, agents, tools };
	}

	// ── Sessions ──────────────────────────────────────────

	sessionPath(sessionId: string): string {
		return join(this.projectDir, "sessions", `${sessionId}.jsonl`);
	}
}
