import { type AgentTool, defineAgentTool } from "@jayden/jai-agent";
import z from "zod";

const DEFAULT_TIMEOUT = 30_000;
const MAX_TIMEOUT = 120_000;
const MAX_LINES = 500;
const HEAD_LINES = 200;
const TAIL_LINES = 100;
const SIGTERM_GRACE_MS = 2_000;

const BLOCKED_PATTERNS = [
	{ pattern: /rm\s+-rf\s+\/(?:\s|$)/, label: "rm -rf /" },
	{ pattern: /:\(\)\{\s*:|:&\s*\};:/, label: "fork bomb" },
	{ pattern: /dd\s+if=\/dev\/zero/, label: "dd if=/dev/zero" },
	{ pattern: /mkfs\./, label: "mkfs" },
	{ pattern: />\s*\/dev\/sd[a-z]/, label: "write to disk device" },
];

function truncateOutput(output: string): string {
	const lines = output.split("\n");
	if (lines.length <= MAX_LINES) return output;

	const head = lines.slice(0, HEAD_LINES);
	const tail = lines.slice(-TAIL_LINES);
	const omitted = lines.length - HEAD_LINES - TAIL_LINES;

	return [...head, "", `[... ${omitted} lines omitted ...]`, "", ...tail].join("\n");
}

export function bashTool(defaultCwd: string): AgentTool {
	return defineAgentTool({
		name: "Bash",
		label: "Run command",
		description: `Execute a shell command. Use this only when FileRead, FileWrite, FileEdit, Glob, and Grep cannot accomplish the task.
Commands that time out are killed automatically.
Dangerous commands (rm -rf /, fork bombs, etc.) are blocked.`,
		parameters: z.object({
			command: z.string().describe("Shell command to execute"),
			timeout: z.number().int().min(1).max(MAX_TIMEOUT).default(DEFAULT_TIMEOUT).describe("Timeout in milliseconds"),
			cwd: z.string().optional().describe("Working directory (defaults to workspace cwd)"),
		}),
		validate(params) {
			if (!params.command.trim()) {
				return "Command must not be empty.";
			}
			for (const { pattern, label } of BLOCKED_PATTERNS) {
				if (pattern.test(params.command)) {
					return `Error: Command blocked — matches dangerous pattern: ${label}\nIf you need to perform this operation, use a more specific and safe command.`;
				}
			}
		},
		async execute(params, signal) {
			const { command, timeout, cwd: overrideCwd } = params;
			const cwd = overrideCwd ?? defaultCwd;

			try {
				const proc = Bun.spawn(["sh", "-c", command], {
					cwd,
					stdout: "pipe",
					stderr: "pipe",
					env: { ...process.env },
				});

				let timedOut = false;
				const timer = setTimeout(async () => {
					timedOut = true;
					proc.kill("SIGTERM");
					await Bun.sleep(SIGTERM_GRACE_MS);
					try {
						proc.kill("SIGKILL");
					} catch {
						// already exited
					}
				}, timeout);

				if (signal) {
					signal.addEventListener(
						"abort",
						() => {
							clearTimeout(timer);
							proc.kill("SIGTERM");
						},
						{ once: true },
					);
				}

				const [stdout, stderr] = await Promise.all([
					new Response(proc.stdout).text(),
					new Response(proc.stderr).text(),
				]);
				const exitCode = await proc.exited;
				clearTimeout(timer);

				// Merge stdout and stderr
				let output = stdout;
				if (stderr) {
					output = output ? `${output}\n${stderr}` : stderr;
				}

				output = truncateOutput(output);

				if (timedOut) {
					output += `\n\n[Command timed out after ${timeout}ms. Partial output above.]`;
					return { content: [{ type: "text" as const, text: output }], isError: true };
				}

				if (exitCode !== 0) {
					output += `\n\n[Exit code: ${exitCode}]`;
					return { content: [{ type: "text" as const, text: output }], isError: true };
				}

				return { content: [{ type: "text" as const, text: output || "(no output)" }] };
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	});
}
