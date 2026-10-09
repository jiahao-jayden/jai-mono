// Stand-in for `@jai/agent/node/environment` on Workers. The real entry re-exports
// SandboxedNodeExecutionEnvironment, whose module top level calls createRequire(import.meta.url)
// (undefined on workerd) and pulls @anthropic-ai/sandbox-runtime (node-forge, net, tls, child_process).
// This is the seam a Workers-capable build has to cut: inject the execution environment instead of
// importing the sandboxed one unconditionally from src/runtime/create-coding-agent.ts.
export {
	createSafeShellEnvironment,
	NodeExecutionEnvironment as SandboxedNodeExecutionEnvironment,
} from "../../../agent/src/harness/node/environment";
