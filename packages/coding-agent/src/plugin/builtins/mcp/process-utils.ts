import treeKill from "tree-kill";

/**
 * 杀掉 pid 及其所有子孙进程。
 *
 * stdio MCP server 经常 spawn 子进程（npx → node、uvx → python 等），
 * `transport.close()` 只会断 stdin/stdout，子进程会变成 orphan。
 *
 * 内部用 `tree-kill`（35M weekly downloads，0 deps，10+ 年）：
 *   - Linux： `ps -o pid --ppid <pid>`
 *   - Darwin：`pgrep -P <pid>`
 *   - Win32： `taskkill /pid <pid> /T /F`
 */
export function killProcessTree(pid: number, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
	return new Promise((resolve, reject) => {
		treeKill(pid, signal, (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}
