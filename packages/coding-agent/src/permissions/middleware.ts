import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import type {
	AgentToolResult,
	ExecutionPolicyScope,
	PathCapability,
	PathCapabilityManager,
	ResolvePathOptions,
	ShellExecutionPolicy,
	ToolMiddleware,
} from "@jai/agent";
import type { Result as ResultType } from "better-result";
import type { JsonObject } from "../core/json";
import type { PermissionApprovalDecision, PermissionRequestSummary, PermissionRisk } from "./approval";
import { bashPermissionScanArgument, scanBashCommand } from "./bash-parser";
import { mergePermissionConfigs } from "./definition";
import {
	permissionAbortedError,
	permissionApprovalUnavailableError,
	permissionDeniedError,
	permissionGrantSaveFailedError,
} from "./errors";
import { createExtensionPermissionRequest, createPermissionRequest, evaluatePermission } from "./evaluate";
import { bashAlwaysPattern } from "./rules";
import type { PermissionTelemetryEvent, PermissionTelemetryObserver } from "./telemetry";
import type { CodingExtensionToolCall, CodingToolPermission } from "./tool-permission";
import {
	type CanonicalToolName,
	canonicalToolNames,
	type PermissionConfig,
	type PermissionDecision,
	type PermissionEffect,
	type PermissionRequest,
	type PermissionSettings,
} from "./types";

export interface PermissionApprovalRequest {
	readonly requestId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly args: Readonly<Record<string, unknown>>;
	readonly reason: string;
	readonly canAlwaysAllow: boolean;
	/**
	 * Safe, host-renderable description of what is being asked for. Built here
	 * because this is where the decision and the arguments are both in hand.
	 */
	readonly summary: PermissionRequestSummary;
	readonly suggestedRule?: string;
	readonly suggestedRules?: readonly string[];
	readonly rememberScope?: "session" | "project-local";
}

export interface PermissionMiddlewareOptions {
	readonly workspaceRoot: string | (() => string);
	readonly settings: PermissionSettings | (() => PermissionSettings | Promise<PermissionSettings>);
	readonly extensionToolPermissions?: ReadonlyMap<string, ExtensionToolPermissionResolver>;
	/**
	 * Permission resolvers owned by the runtime itself rather than by an Extension. Kept separate from
	 * `extensionToolPermissions` because that map is rebuilt (cleared and refilled) during Extension
	 * activation, which would otherwise drop entries the runtime registered before activation ran.
	 */
	readonly coreToolPermissions?: ReadonlyMap<string, ExtensionToolPermissionResolver>;
	/** Extension tools which explicitly own their authorization transaction. */
	readonly extensionAuthorizedToolNames?: ReadonlySet<string>;
	readonly requestApproval?: (
		request: PermissionApprovalRequest,
		signal?: AbortSignal,
	) => PermissionApprovalDecision | Promise<PermissionApprovalDecision>;
	readonly persistProjectLocalAllowRules?: (rules: readonly string[]) => void | Promise<void>;
	readonly pathCapabilities?: PathCapabilityManager;
	readonly sessionAllowRules?: SessionAllowRules;
	/** Canonical workspace binding for the shared Session grant table. */
	readonly sessionGrantWorkspaceRoot?: string;
	/** Serializes approvals for a live Session. Without one, each call prompts immediately. */
	readonly approvalQueue?: PermissionApprovalQueue;
	/** Compiles and binds a fresh per-call Shell policy after application-level approval. */
	readonly executionPolicy?: {
		readonly scope: ExecutionPolicyScope;
		readonly compile: () =>
			| ResultType<ShellExecutionPolicy, unknown>
			| Promise<ResultType<ShellExecutionPolicy, unknown>>;
	};
	/** Optional side-channel that observes permission facts without influencing them. */
	readonly telemetryObserver?: PermissionTelemetryObserver;
}

export type SessionAllowRules = Record<string, PermissionEffect | Record<string, PermissionEffect>>;

export interface PermissionApprovalQueue {
	enqueue<T>(run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>;
	cancel(error: unknown): void;
}

/** Runs each approval immediately; a caller without a FIFO has nothing to serialize against. */
const unqueuedApprovals: PermissionApprovalQueue = {
	enqueue: (run, signal) =>
		signal?.aborted
			? Promise.reject(permissionAbortedError("permission"))
			: run(signal ?? new AbortController().signal),
	cancel: () => {},
};

/** A small in-memory FIFO. It owns no durable facts and is scoped to one live Operation. */
export function createPermissionApprovalQueue(): PermissionApprovalQueue {
	type Entry = {
		readonly run: (signal: AbortSignal) => Promise<unknown>;
		readonly controller: AbortController;
		readonly signal?: AbortSignal;
		readonly resolve: (value: unknown) => void;
		readonly reject: (reason: unknown) => void;
		onAbort?: () => void;
		started: boolean;
		settled: boolean;
	};
	const entries: Entry[] = [];
	let running = false;
	let active: Entry | undefined;
	let cancellation: unknown;

	const pump = (): void => {
		if (running) return;
		const entry = entries.shift();
		if (!entry) return;
		if (entry.settled || entry.signal?.aborted || cancellation !== undefined) {
			if (!entry.settled) {
				entry.settled = true;
				entry.reject(cancellation ?? permissionAbortedError("permission"));
			}
			pump();
			return;
		}
		running = true;
		active = entry;
		entry.started = true;
		void Promise.resolve()
			.then(() => entry.run(entry.controller.signal))
			.then(
				(value) => settle(entry, undefined, value),
				(error) => settle(entry, error),
			);
	};

	const settle = (entry: Entry, error: unknown, value?: unknown): void => {
		if (entry.onAbort) entry.signal?.removeEventListener("abort", entry.onAbort);
		if (!entry.settled) {
			entry.settled = true;
			if (error === undefined) entry.resolve(value);
			else entry.reject(error);
		}
		if (active === entry) {
			active = undefined;
			running = false;
			pump();
		}
	};

	return {
		enqueue<T>(run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
			return new Promise<T>((resolve, reject) => {
				const entry: Entry = {
					run,
					controller: new AbortController(),
					signal,
					resolve: (value) => resolve(value as T),
					reject,
					started: false,
					settled: false,
				};
				entry.onAbort = () => {
					if (entry.settled) return;
					entry.controller.abort();
					settle(entry, permissionAbortedError("permission"));
				};
				if (signal?.aborted) {
					entry.onAbort();
					return;
				}
				signal?.addEventListener("abort", entry.onAbort, { once: true });
				entries.push(entry);
				pump();
			});
		},
		cancel(error: unknown): void {
			cancellation = error;
			if (active) {
				active.controller.abort();
				settle(active, error);
			}
			for (const entry of entries.splice(0)) {
				if (entry.onAbort) entry.signal?.removeEventListener("abort", entry.onAbort);
				if (!entry.settled) {
					entry.settled = true;
					entry.reject(error);
				}
			}
			if (!running) pump();
		},
	};
}

export function createPermissionMiddleware(options: PermissionMiddlewareOptions): ToolMiddleware {
	const sessionAllowRules = options.sessionAllowRules ?? {};
	const approvalQueue = options.approvalQueue ?? unqueuedApprovals;
	return async (context, next) => {
		const workspaceRoot = currentWorkspaceRoot(options.workspaceRoot);
		if (options.extensionAuthorizedToolNames?.has(context.tool.name)) {
			return evaluateExtensionAuthorizationBoundary(
				context.tool.name,
				workspaceRoot,
				() => currentSettings(options.settings),
				context.toolCall.id,
				options.telemetryObserver,
				next,
			);
		}
		const extensionPermission =
			options.coreToolPermissions?.get(context.tool.name) ??
			options.extensionToolPermissions?.get(context.tool.name);
		if (extensionPermission) {
			return evaluateExtensionPermission(
				context.tool.name,
				context.args,
				extensionPermission,
				() => currentSettings(options.settings),
				workspaceRoot,
				options.requestApproval,
				approvalQueue,
				context.toolCall.id,
				context.signal,
				options.telemetryObserver,
				next,
			);
		}
		const toolName = canonicalToolName(context.tool.name);
		let settled = false;
		const settleOnce = (outcome: Parameters<typeof settlePermission>[2]): void => {
			if (settled) return;
			settled = true;
			settlePermission(options.telemetryObserver, context.toolCall.id, outcome);
		};
		const settings = await currentSettings(options.settings);
		const effective = withSessionRules(settings, sessionAllowRules, options.sessionGrantWorkspaceRoot, workspaceRoot);
		const permissionArgs = await argsForPermission(toolName, context.args);
		const call = createPermissionRequest(toolName, permissionArgs, workspaceRoot);
		const initial = evaluatePermission(call, effective);
		observePermissionDecision(options.telemetryObserver, context.toolCall.id, toolName, initial, "initial");
		if (initial.behavior === "deny") {
			settleOnce("denied");
			throw permissionDeniedError(toolName, initial.reason);
		}
		const capability = await createPathCapability(
			options.pathCapabilities,
			toolName,
			permissionArgs,
			workspaceRoot,
			context.signal,
		);
		const canonicalDecision = capability
			? evaluatePermission(canonicalCall(call, capability.canonicalPath), effective)
			: initial;
		if (capability) {
			observePermissionDecision(
				options.telemetryObserver,
				context.toolCall.id,
				toolName,
				canonicalDecision,
				"canonical",
			);
		}
		if (canonicalDecision.behavior === "deny") {
			settleOnce("denied");
			throw permissionDeniedError(toolName, canonicalDecision.reason);
		}
		if (initial.behavior === "allow" && canonicalDecision.behavior === "allow") {
			settleOnce("allowed");
			return executeApproved(options, toolName, capability, next);
		}
		const requestApproval = options.requestApproval;
		if (!requestApproval) {
			settleOnce("denied");
			throw permissionApprovalUnavailableError(toolName);
		}
		if (context.signal?.aborted) {
			settleOnce("cancelled");
			throw permissionAbortedError(toolName);
		}

		const suggested = suggestedRules(toolName, context.args, workspaceRoot, initial);
		const decided = canonicalDecision.behavior === "ask" ? canonicalDecision : initial;
		const request: PermissionApprovalRequest = {
			requestId: randomUUID(),
			toolCallId: context.toolCall.id,
			toolName,
			args: structuredClone(context.args),
			reason: initial.behavior === "ask" ? initial.reason : canonicalDecision.reason,
			canAlwaysAllow: Boolean(suggested),
			summary: approvalSummary(toolName, permissionArgs, decided),
			suggestedRule: suggested ? formatSuggestedRule(toolName, suggested.rules[0]!) : undefined,
			suggestedRules: suggested ? suggested.rules.map((rule) => formatSuggestedRule(toolName, rule)) : undefined,
			rememberScope: suggested?.scope,
		};
		/**
		 * Re-evaluates against the configuration current at this instant. An approval
		 * is only valid for the context it was granted in, so this both rejects a
		 * changed context and reports when approval became unnecessary meanwhile.
		 */
		const recheckOrDeny = async (): Promise<boolean> => {
			const root = currentWorkspaceRoot(options.workspaceRoot);
			const current = withSessionRules(
				await currentSettings(options.settings),
				sessionAllowRules,
				options.sessionGrantWorkspaceRoot,
				root,
			);
			const rechecked = createPermissionRequest(toolName, permissionArgs, root);
			const decision = evaluatePermission(rechecked, current);
			observePermissionDecision(options.telemetryObserver, context.toolCall.id, toolName, decision, "recheck");
			const canonical = capability
				? evaluatePermission(canonicalCall(rechecked, capability.canonicalPath), current)
				: decision;
			if (capability) {
				observePermissionDecision(
					options.telemetryObserver,
					context.toolCall.id,
					toolName,
					canonical,
					"canonical_recheck",
				);
			}
			if (root !== workspaceRoot || decision.behavior === "deny" || canonical.behavior === "deny") {
				settleOnce("recheck_denied");
				throw permissionDeniedError(toolName, "Permission context changed while awaiting approval");
			}
			return decision.behavior === "allow" && canonical.behavior === "allow";
		};
		const persistGrant = async (grant: NonNullable<ReturnType<typeof suggestedRules>>): Promise<void> => {
			if (grant.scope !== "session") {
				try {
					await options.persistProjectLocalAllowRules?.(grant.rules);
				} catch (error) {
					throw permissionGrantSaveFailedError(toolName, error);
				}
				return;
			}
			rememberSessionAllows(sessionAllowRules, toolName, grant.rules);
			if (!capability) return;
			const canonicalSuggested = suggestedRules(
				toolName,
				argsWithPath(toolName, context.args, capability.canonicalPath),
				workspaceRoot,
				canonicalDecision,
			);
			if (canonicalSuggested) rememberSessionAllows(sessionAllowRules, toolName, canonicalSuggested.rules);
		};

		let approval: PermissionApprovalDecision | undefined;
		try {
			approval = await approvalQueue.enqueue(async (queueSignal) => {
				if (await recheckOrDeny()) return undefined;
				observePermission(options.telemetryObserver, {
					type: "approval_requested",
					approvalId: request.requestId,
					toolCallId: context.toolCall.id,
					toolName,
				});
				let decision: PermissionApprovalDecision;
				try {
					decision = await requestApproval(request, queueSignal);
				} catch (error) {
					observePermission(options.telemetryObserver, {
						type: context.signal?.aborted ? "approval_cancelled" : "approval_failed",
						approvalId: request.requestId,
					});
					throw error;
				}
				observePermission(options.telemetryObserver, {
					type: "approval_decided",
					approvalId: request.requestId,
					decision,
				});
				if (decision === "deny" || (decision === "alwaysAllow" && !suggested)) return decision;
				if (queueSignal.aborted || context.signal?.aborted) throw permissionAbortedError(toolName);
				await recheckOrDeny();
				if (decision === "alwaysAllow" && suggested) await persistGrant(suggested);
				return decision;
			}, context.signal);
		} catch (error) {
			settleOnce(context.signal?.aborted ? "cancelled" : "failed");
			throw error;
		}
		if (context.signal?.aborted) {
			settleOnce("cancelled");
			throw permissionAbortedError(toolName);
		}
		if (approval === "deny") {
			settleOnce("denied");
			throw permissionDeniedError(toolName, "User denied the permission request");
		}
		if (approval === "alwaysAllow" && !suggested) {
			settleOnce("denied");
			throw permissionDeniedError(toolName, "Always allow is unavailable for this permission request");
		}
		settleOnce("allowed");
		return executeApproved(options, toolName, capability, next);
	};
}

async function executeApproved(
	options: PermissionMiddlewareOptions,
	toolName: CanonicalToolName,
	capability: PathCapability | undefined,
	next: () => Promise<AgentToolResult>,
): Promise<AgentToolResult> {
	const invoke = () =>
		capability && options.pathCapabilities ? options.pathCapabilities.withPathCapability(capability, next) : next();
	if (toolName !== "Bash" || !options.executionPolicy) return invoke();
	const compiled = await options.executionPolicy.compile();
	if (compiled.isErr()) throw compiled.error;
	return options.executionPolicy.scope.withExecutionPolicy(compiled.value, invoke);
}

export type ExtensionToolPermissionResolver = (
	call: CodingExtensionToolCall<JsonObject>,
) => CodingToolPermission | Promise<CodingToolPermission>;

/**
 * Extension-owned authorization may keep a prepare → approval → execute transaction
 * (Connector does this for expiring, single-use tokens). It still cannot bypass an
 * explicit stable tool deny set by the user. The owner remains responsible for its
 * own default, grant and mode semantics, which avoids a second approval prompt.
 */
async function evaluateExtensionAuthorizationBoundary(
	toolName: string,
	workspaceRoot: string,
	readSettings: () => Promise<PermissionSettings>,
	toolCallId: string,
	telemetryObserver: PermissionTelemetryObserver | undefined,
	next: () => Promise<AgentToolResult>,
): Promise<AgentToolResult> {
	const decision = evaluatePermission(createExtensionPermissionRequest(toolName, workspaceRoot), await readSettings());
	if (decision.behavior === "deny" && decision.source === "rule") {
		settlePermission(telemetryObserver, toolCallId, "denied");
		throw permissionDeniedError(toolName, decision.reason);
	}
	return next();
}

async function evaluateExtensionPermission(
	toolName: string,
	args: Record<string, unknown>,
	resolvePermission: ExtensionToolPermissionResolver,
	readSettings: () => Promise<PermissionSettings>,
	workspaceRoot: string,
	requestApproval: PermissionMiddlewareOptions["requestApproval"],
	approvalQueue: PermissionApprovalQueue | undefined,
	toolCallId: string,
	signal: AbortSignal | undefined,
	telemetryObserver: PermissionTelemetryObserver | undefined,
	next: () => Promise<AgentToolResult>,
): Promise<AgentToolResult> {
	const permission = await resolvePermission({
		toolCallId,
		args: structuredClone(args) as JsonObject,
		signal,
	});
	if (
		(permission.sideEffect !== "read" &&
			permission.sideEffect !== "write" &&
			permission.sideEffect !== "destructive") ||
		(permission.dataSensitivity !== undefined &&
			permission.dataSensitivity !== "normal" &&
			permission.dataSensitivity !== "sensitive" &&
			permission.dataSensitivity !== "secret") ||
		!permission.reason.trim()
	) {
		throw permissionDeniedError(toolName, "Extension supplied an invalid permission description");
	}
	const permissionRequest = createExtensionPermissionRequest(
		toolName,
		workspaceRoot,
		permission.sideEffect === "destructive" ? "destructive" : undefined,
	);
	const evaluated = evaluatePermission(permissionRequest, await readSettings());
	// A catalog declaration is still subject to every explicit tool.invoke rule and
	// mode restriction. In the absence of one, a local read-only tool which does
	// not expose sensitive data keeps the same built-in treatment as Read. Remote
	// tools must explicitly declare their sensitivity, so they do not get this
	// trusted-local default.
	const initial =
		evaluated.behavior === "ask" &&
		evaluated.source === "built-in" &&
		permission.sideEffect === "read" &&
		permission.dataSensitivity !== "sensitive" &&
		permission.dataSensitivity !== "secret"
			? { ...evaluated, behavior: "allow" as const }
			: evaluated;
	observeExtensionDecision(telemetryObserver, toolCallId, toolName, initial.behavior, permission.sideEffect);
	if (initial.behavior === "deny") {
		settlePermission(telemetryObserver, toolCallId, "denied");
		throw permissionDeniedError(toolName, initial.reason);
	}
	if (initial.behavior === "allow") {
		settlePermission(telemetryObserver, toolCallId, "allowed");
		return next();
	}
	if (!requestApproval) {
		settlePermission(telemetryObserver, toolCallId, "denied");
		throw permissionDeniedError(toolName, "No approval handler is configured for this Extension tool");
	}
	if (signal?.aborted) {
		settlePermission(telemetryObserver, toolCallId, "cancelled");
		throw permissionAbortedError(toolName);
	}
	const requestId = randomUUID();
	const approvalRequest: PermissionApprovalRequest = {
		requestId,
		toolCallId,
		toolName,
		args: structuredClone(args),
		reason: permission.reason,
		canAlwaysAllow: false,
		summary: {
			title: `${toolName} requests permission`,
			description: permission.reason,
			risk: permission.sideEffect === "destructive" ? "high" : "medium",
		},
	};
	observePermission(telemetryObserver, { type: "approval_requested", approvalId: requestId, toolCallId, toolName });
	let approval: PermissionApprovalDecision;
	try {
		approval = await (approvalQueue
			? approvalQueue.enqueue(() => Promise.resolve(requestApproval(approvalRequest, signal)), signal)
			: requestApproval(approvalRequest, signal));
		observePermission(telemetryObserver, { type: "approval_decided", approvalId: requestId, decision: approval });
	} catch (error) {
		observePermission(telemetryObserver, {
			type: signal?.aborted ? "approval_cancelled" : "approval_failed",
			approvalId: requestId,
		});
		settlePermission(telemetryObserver, toolCallId, signal?.aborted ? "cancelled" : "failed");
		throw error;
	}
	if (signal?.aborted) {
		settlePermission(telemetryObserver, toolCallId, "cancelled");
		throw permissionAbortedError(toolName);
	}
	if (approval !== "allowOnce") {
		settlePermission(telemetryObserver, toolCallId, "denied");
		throw permissionDeniedError(toolName, "User denied the permission request");
	}
	const rechecked = evaluatePermission(permissionRequest, await readSettings());
	if (rechecked.behavior === "deny") {
		settlePermission(telemetryObserver, toolCallId, "recheck_denied");
		throw permissionDeniedError(toolName, "Permission context changed while awaiting approval");
	}
	settlePermission(telemetryObserver, toolCallId, "allowed");
	return next();
}

function observePermissionDecision(
	observer: PermissionTelemetryObserver | undefined,
	toolCallId: string,
	toolName: CanonicalToolName,
	decision: PermissionDecision,
	phase: "initial" | "canonical" | "recheck" | "canonical_recheck",
): void {
	observePermission(observer, {
		type: "permission_decided",
		toolCallId,
		toolName,
		decision: decision.behavior,
		phase,
		risk: telemetryRisk(decision.risk, decision.source, toolName),
		source: decision.source === "session-grant" || decision.source === "project-grant" ? "rule" : decision.source,
	});
}

function observeExtensionDecision(
	observer: PermissionTelemetryObserver | undefined,
	toolCallId: string,
	toolName: string,
	decision: "allow" | "ask" | "deny",
	sideEffect: CodingToolPermission["sideEffect"],
): void {
	observePermission(observer, {
		type: "permission_decided",
		toolCallId,
		toolName,
		decision,
		phase: "initial",
		risk: sideEffect === "destructive" ? "high" : sideEffect === "write" ? "medium" : "low",
		source: "extension",
	});
}

function settlePermission(
	observer: PermissionTelemetryObserver | undefined,
	toolCallId: string,
	outcome: "allowed" | "denied" | "recheck_denied" | "cancelled" | "failed",
): void {
	observePermission(observer, { type: "permission_settled", toolCallId, outcome });
}

function observePermission(observer: PermissionTelemetryObserver | undefined, event: PermissionTelemetryEvent): void {
	try {
		observer?.observePermissionEvent(event);
	} catch {
		return;
	}
}

function telemetryRisk(
	risk: PermissionDecision["risk"],
	source: PermissionDecision["source"],
	toolName: CanonicalToolName,
): "low" | "medium" | "high" {
	if (risk === "destructive" || risk === "opaque" || source === "danger-layer") return "high";
	if (risk === "normal") return "medium";
	return source === "built-in" && toolName === "Read" ? "low" : "medium";
}

async function argsForPermission(
	toolName: CanonicalToolName,
	args: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
	if (toolName !== "Bash") return args;
	const scan = await scanBashCommand(stringArg(args, "command"));
	return {
		...args,
		[bashPermissionScanArgument]: scan.isOk() ? scan.value : { patterns: [], destructive: false, opaque: true },
	};
}

function canonicalCall(call: PermissionRequest, canonicalPath: string): PermissionRequest {
	return {
		...call,
		targets: call.targets.map((target) =>
			target.resource.kind === "path" ? { ...target, resource: { kind: "path", path: canonicalPath } } : target,
		),
	};
}

function argsWithPath(
	toolName: CanonicalToolName,
	args: Readonly<Record<string, unknown>>,
	path: string,
): Readonly<Record<string, unknown>> {
	return toolPath(toolName, args) === undefined ? args : { ...args, path };
}

async function createPathCapability(
	manager: PathCapabilityManager | undefined,
	toolName: CanonicalToolName,
	args: Readonly<Record<string, unknown>>,
	workspaceRoot: string,
	signal?: AbortSignal,
): Promise<PathCapability | undefined> {
	if (!manager) return undefined;
	const path = toolPath(toolName, args);
	if (path === undefined) return undefined;
	const options = pathResolveOptions(toolName, workspaceRoot, signal);
	return manager.createPathCapability(path, options);
}

function toolPath(toolName: CanonicalToolName, args: Readonly<Record<string, unknown>>): string | undefined {
	if (toolName === "Read" || toolName === "Write" || toolName === "Edit") return stringArg(args, "path");
	return undefined;
}

function pathResolveOptions(
	toolName: CanonicalToolName,
	workspaceRoot: string,
	signal?: AbortSignal,
): ResolvePathOptions {
	return {
		base: workspaceRoot,
		boundary: workspaceRoot,
		mustExist: toolName !== "Write",
		expectedKind: toolName === "Read" || toolName === "Edit" ? ("file" as const) : undefined,
		signal,
	};
}

function canonicalToolName(value: string): CanonicalToolName {
	if ((canonicalToolNames as readonly string[]).includes(value)) return value as CanonicalToolName;
	throw permissionDeniedError(value, "Tool has no registered permission policy");
}

/**
 * Projects the decision and the call into the approval summary a host renders.
 * The risk comes from the evaluator's own classification — the Danger Layer
 * marks destructive and opaque operations — rather than from the tool name.
 */
function approvalSummary(
	toolName: CanonicalToolName,
	args: Readonly<Record<string, unknown>>,
	decision: PermissionDecision,
): PermissionRequestSummary {
	const path = stringArgument(args, "path");
	const command = toolName === "Bash" ? stringArgument(args, "command") : undefined;
	return {
		title: `${toolName} requests permission`,
		command: command || undefined,
		path: path || undefined,
		risk: riskOf(decision),
	};
}

function riskOf(decision: PermissionDecision): PermissionRisk {
	switch (decision.risk) {
		case "destructive":
		case "opaque":
			return "high";
		case "normal":
			return "medium";
		default:
			return decision.source === "danger-layer" ? "high" : "medium";
	}
}

function stringArgument(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" && value ? value : undefined;
}

function currentWorkspaceRoot(value: string | (() => string)): string {
	return resolve(typeof value === "function" ? value() : value);
}

async function currentSettings(
	value: PermissionSettings | (() => PermissionSettings | Promise<PermissionSettings>),
): Promise<PermissionSettings> {
	return typeof value === "function" ? value() : value;
}

function withSessionRules(
	settings: PermissionSettings,
	sessionRules: PermissionConfig,
	grantWorkspaceRoot: string | undefined,
	workspaceRoot: string,
): PermissionSettings {
	if (grantWorkspaceRoot !== undefined && resolve(grantWorkspaceRoot) !== resolve(workspaceRoot)) return settings;
	return Object.keys(sessionRules).length === 0
		? settings
		: {
				...settings,
				sessionGrants: mergePermissionConfigs([{ value: settings.sessionGrants ?? {} }, { value: sessionRules }]),
			};
}

function rememberSessionAllows(
	sessionAllow: SessionAllowRules,
	toolName: CanonicalToolName,
	patterns: readonly string[],
): void {
	const permission = toolName === "Read" ? "file.read" : toolName === "Bash" ? "process.exec" : "file.write";
	const current = sessionAllow[permission];
	const next: Record<string, PermissionEffect> =
		current === undefined ? {} : typeof current === "string" ? { "*": current } : { ...current };
	for (const pattern of patterns) next[pattern] = "allow";
	sessionAllow[permission] = next;
}

function formatSuggestedRule(toolName: CanonicalToolName, rule: string): string {
	if (toolName === "Bash") return rule;
	return `${toolName === "Read" ? "Read" : "Edit"}(${rule})`;
}

function suggestedRules(
	toolName: CanonicalToolName,
	args: Readonly<Record<string, unknown>>,
	workspaceRoot: string,
	decision: { readonly source: string; readonly alwaysPatterns?: readonly string[] },
): { readonly rules: readonly string[]; readonly scope: "session" | "project-local" } | undefined {
	if (decision.source === "danger-layer") return undefined;
	if (toolName === "Bash") {
		const command = stringArg(args, "command");
		const patterns = decision.alwaysPatterns ?? (command ? [bashAlwaysPattern(command)].filter(Boolean) : []);
		const rules = unique(patterns.map((pattern) => `process.exec:${pattern}`));
		return rules.length > 0 ? { rules, scope: "project-local" } : undefined;
	}
	if (toolName === "Write" || toolName === "Edit") {
		const path = absolutePath(args, workspaceRoot);
		return path ? { rules: [rootPath(path)], scope: "session" } : undefined;
	}
	if (toolName === "Read") {
		const path = absolutePath(args, workspaceRoot);
		return path ? { rules: [rootPath(path)], scope: "session" } : undefined;
	}
	return undefined;
}

function absolutePath(
	args: Readonly<Record<string, unknown>>,
	workspaceRoot: string,
	defaultCurrent = false,
): string | undefined {
	const input = stringArg(args, "path") || (defaultCurrent ? "." : "");
	if (!input) return undefined;
	const path = isAbsolute(input) ? resolve(input) : resolve(workspaceRoot, input);
	return escapePattern(path);
}

function rootPath(path: string): string {
	return `//${path.replace(/^\/+/, "")}`;
}

function escapePattern(path: string): string {
	return path.replaceAll("\\", "/").replace(/([*?[\]])/g, "[$1]");
}

function stringArg(args: Readonly<Record<string, unknown>>, key: string): string {
	const value = args[key];
	return typeof value === "string" ? value : "";
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}
