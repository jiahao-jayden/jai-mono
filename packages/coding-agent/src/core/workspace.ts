import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = ".jai";

export type WorkspaceConfig = {
	cwd: string;
	home?: string;
};

/**
 * Workspace — 以 cwd 为中心的项目作用域。
 *
 * 两层目录：
 * - 项目级：cwd/.jai/（优先）
 * - 全局级：~/.jai/（兜底）
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

	static create(config: WorkspaceConfig): Workspace {
		return new Workspace(config.cwd, config.home ?? homedir());
	}

	/**
	 * 按优先级发现 prompt 文件：项目级 > 全局级 > undefined。
	 * 返回文件内容字符串，找不到返回 undefined。
	 */
	async resolvePromptFile(name: string): Promise<string | undefined> {
		const projectFile = Bun.file(join(this.projectDir, name));
		if (await projectFile.exists()) return projectFile.text();

		const globalFile = Bun.file(join(this.globalDir, name));
		if (await globalFile.exists()) return globalFile.text();

		return undefined;
	}

	/** session 存储路径：cwd/.jai/sessions/<sessionId>.jsonl */
	sessionPath(sessionId: string): string {
		return join(this.projectDir, "sessions", `${sessionId}.jsonl`);
	}
}
