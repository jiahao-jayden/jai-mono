import { getErrorMessage } from "@jai/common";
import type { AgentTool } from "../core/types";
import type { Agent } from "../harness/agent";
import type { AgentHookMap } from "../harness/hooks";
import {
	type AgentExtensionFailure,
	extensionInitializationError,
	extensionInitializationReentrancyError,
	extensionPreflightError,
	hooksRegistrationClosedError,
} from "./errors";
import type { AgentExtension } from "./types";

type RegistryState = "new" | "initializing" | "initialized" | "failed";

/** Extension 实例是身份，不以 name 代替；WeakMap 不阻止未使用实例被回收。 */
const owners = new WeakMap<AgentExtension, AgentExtensionRegistry>();

export class AgentExtensionRegistry {
	private readonly extensions: readonly AgentExtension[];
	private readonly stagedHooks = new Map<AgentExtension, AgentHookMap[]>();
	private readonly preflightFailures: AgentExtensionFailure[] = [];
	private readonly preflightCauses: unknown[] = [];
	private state: RegistryState = "new";
	private currentExtension?: AgentExtension;
	private initialization?: Promise<void>;
	private failure?: unknown;
	readonly tools: AgentTool[];

	constructor(extensions: readonly AgentExtension[] | undefined, constructorTools: readonly AgentTool[]) {
		this.extensions = [...(extensions ?? [])];
		this.tools = this.preflight(constructorTools);
	}

	/** Agent 构造全部成功后才认领，避免后续构造错误留下幽灵 owner。 */
	claimOwnership(): void {
		if (this.preflightFailures.length > 0) return;
		for (const extension of this.extensions) owners.set(extension, this);
	}

	initialize(agent: Agent, commitHooks: (hooks: AgentHookMap) => void): Promise<void> {
		if (this.initialization) return this.initialization;
		if (this.failure) return Promise.reject(this.failure);

		this.initialization = this.runInitialization(agent, commitHooks);
		return this.initialization;
	}

	registerHooks(extension: AgentExtension, hooks: AgentHookMap): void {
		if (this.state !== "initializing" || this.currentExtension !== extension) {
			throw hooksRegistrationClosedError(extension.name);
		}
		const staged = this.stagedHooks.get(extension) ?? [];
		staged.push(cloneHookMap(hooks));
		this.stagedHooks.set(extension, staged);
	}

	private preflight(constructorTools: readonly AgentTool[]): AgentTool[] {
		const tools: Array<{ tool: AgentTool; source: string; extension?: string }> = constructorTools.map((tool) => ({
			tool,
			source: "constructor",
		}));
		const names = new Set<string>();
		const instances = new Set<AgentExtension>();

		for (const extension of this.extensions) {
			if (names.has(extension.name)) {
				this.preflightFailures.push({
					reason: "duplicate_extension_name",
					extension: extension.name,
					message: `Duplicate AgentExtension name "${extension.name}"`,
				});
			}
			names.add(extension.name);

			if (instances.has(extension) || owners.has(extension)) {
				this.preflightFailures.push({
					reason: "extension_already_owned",
					extension: extension.name,
					message: `AgentExtension "${extension.name}" is already attached to an Agent`,
				});
			}
			instances.add(extension);

			try {
				for (const tool of extension.tools ?? []) {
					tools.push({
						tool,
						source: `extension:${extension.name}`,
						extension: extension.name,
					});
				}
			} catch (error) {
				this.preflightFailures.push({
					reason: "read_tools_failed",
					extension: extension.name,
					message: getErrorMessage(error),
				});
				this.preflightCauses.push(error);
			}
		}

		const firstByName = new Map<string, { source: string; extension?: string }>();
		for (const item of tools) {
			const first = firstByName.get(item.tool.name);
			if (first) {
				this.preflightFailures.push({
					reason: "duplicate_tool_name",
					extension: item.extension,
					tool: item.tool.name,
					source: item.source,
					message: `Duplicate tool name "${item.tool.name}" from ${first.source} and ${item.source}`,
				});
			} else {
				firstByName.set(item.tool.name, item);
			}
		}

		// failed Agent 永远不能运行；给 CoreAgent 空集合只是避免它先抛另一套 duplicate error。
		if (this.preflightFailures.length > 0) return [];
		return tools.map(({ tool }) => tool);
	}

	private async runInitialization(agent: Agent, commitHooks: (hooks: AgentHookMap) => void): Promise<void> {
		if (this.preflightFailures.length > 0) {
			this.state = "failed";
			this.failure = extensionPreflightError(this.preflightFailures, this.preflightCauses);
			throw this.failure;
		}

		this.state = "initializing";
		const failures: AgentExtensionFailure[] = [];
		const causes: unknown[] = [];

		for (const extension of this.extensions) {
			this.currentExtension = extension;
			try {
				await extension.initialize(this.createInitializationAgent(agent, extension));
			} catch (error) {
				failures.push({
					reason: "initialize_failed",
					extension: extension.name,
					message: getErrorMessage(error),
				});
				causes.push(error);
			} finally {
				this.currentExtension = undefined;
			}
		}

		if (failures.length > 0) {
			this.state = "failed";
			this.failure = extensionInitializationError(failures, causes);
			this.stagedHooks.clear();
			throw this.failure;
		}

		for (const extension of this.extensions) {
			for (const hooks of this.stagedHooks.get(extension) ?? []) commitHooks(hooks);
		}
		this.stagedHooks.clear();
		this.state = "initialized";
	}

	/**
	 * 外部 initialize/invoke 必须能等待同一个 Promise；只有 Extension 自己经由初始化参数
	 * 递归调用运行入口才会死锁，因此限制放在这层临时 view，而不是 Agent 全局状态上。
	 */
	private createInitializationAgent(agent: Agent, extension: AgentExtension): Agent {
		return new Proxy(agent, {
			get: (target, property) => {
				const value = Reflect.get(target, property, target);
				if (
					typeof value === "function" &&
					(property === "initialize" || property === "invoke" || property === "stream")
				) {
					return (...args: unknown[]) => {
						if (this.state === "initializing" && this.currentExtension === extension) {
							throw extensionInitializationReentrancyError(extension.name);
						}
						return Reflect.apply(value, target, args);
					};
				}
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	}
}

function cloneHookMap(hooks: AgentHookMap): AgentHookMap {
	return {
		beforeModelCall: hooks.beforeModelCall ? [...hooks.beforeModelCall] : undefined,
		shouldCompact: hooks.shouldCompact ? [...hooks.shouldCompact] : undefined,
		aroundCompact: hooks.aroundCompact ? [...hooks.aroundCompact] : undefined,
		onModelError: hooks.onModelError ? [...hooks.onModelError] : undefined,
		aroundToolCall: hooks.aroundToolCall ? [...hooks.aroundToolCall] : undefined,
		onEvent: hooks.onEvent ? [...hooks.onEvent] : undefined,
	};
}
