import { homedir } from "node:os";
import { createSubagentExtension } from "@jai/extension/subagent";
import { createTodoExtension } from "@jai/extension/todo";
import type { TelemetryContext } from "@jai/telemetry";
import { Result, type Result as ResultType } from "better-result";
import {
	CodingAgentOperationDriver,
	createRuntimeConnectorAgentAssembly,
	createRuntimeWebSearchAgentAssembly,
	resolveOperationAuxiliaryModel,
} from "../agents";
import {
	resolveEffectiveReasoningLevel,
	resolveRuntimeModelCapabilities,
	resolveRuntimeModelCompatibilityProfile,
	resolveRuntimeModelMetadata,
} from "../model-catalog";
import { RuntimeOperationOpenFailed } from "../operations";
import type { AcpImplementationInfo } from "../protocol/acp-v2";
import { DesktopLocalRuntimeCapabilitySource, type RuntimeCapabilitySource } from "../runtime-capabilities";
import { RuntimeHostConfigurationInvalid } from "./configuration";
import { resolveJaiDataDirectory } from "./paths";
import { type JaiRuntimeServer, type JaiRuntimeServerOpenFailed, openJaiRuntimeServer } from "./server";

export interface OpenConfiguredRuntimeHostOptions {
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly dataDirectory?: string;
	/** Product-owned user capability root; defaults to the OS user's home directory. */
	readonly homeDirectory?: string;
	/** Alternate Host source used by non-local products and deterministic tests. */
	readonly capabilitySource?: RuntimeCapabilitySource;
	/** Embedder-provided telemetry context; otherwise local diagnostic settings come from the environment. */
	readonly telemetry?: TelemetryContext;
	readonly endpoint?: string;
	readonly info?: AcpImplementationInfo;
}

/**
 * Product daemon composition. This is the one place environment-derived
 * configuration becomes Coding Agent creation data; neither the SDK nor an
 * ACP client learns Jai's data-root convention.
 */
export async function openConfiguredRuntimeHost(
	options: OpenConfiguredRuntimeHostOptions = {},
): Promise<ResultType<JaiRuntimeServer, RuntimeHostConfigurationInvalid | JaiRuntimeServerOpenFailed>> {
	const environment = options.environment ?? process.env;
	const homeDirectory = options.homeDirectory ?? homedir();
	const dataDirectory = options.dataDirectory ?? resolveJaiDataDirectory(environment, homeDirectory);
	const opened = await openJaiRuntimeServer({
		dataDirectory,
		homeDirectory,
		createOperationDriver: ({ agentSettings, modelCatalog, workspaceTrust, telemetry }) => {
			const capabilitySource =
				options.capabilitySource ??
				new DesktopLocalRuntimeCapabilitySource({
					dataDirectory,
					workspaceTrust,
					homeDirectory: options.homeDirectory,
				});
			const bootstrapModel = environment.JAI_MODEL?.trim();
			if (bootstrapModel) {
				const bootstrapped = agentSettings.bootstrap({
					model: bootstrapModel,
					providers: {},
					extensions: {},
				});
				if (bootstrapped.isErr()) {
					return Result.err(
						new RuntimeHostConfigurationInvalid({
							message: bootstrapped.error.message,
						}),
					);
				}
			}

			return Result.ok(
				new CodingAgentOperationDriver({
					resolveOptions: async (input) => {
						const current = agentSettings.resolveOptions(input.runtimeConfiguration.model);
						if (current.isErr()) {
							return Result.err(
								new RuntimeOperationOpenFailed({
									message: `Runtime Host Agent configuration cannot open Operation "${input.operationId}"`,
									sessionId: input.sessionId,
									operationId: input.operationId,
									cause: current.error,
								}),
							);
						}
						const connector = createRuntimeConnectorAgentAssembly(agentSettings);
						if (connector.isErr()) {
							return Result.err(
								new RuntimeOperationOpenFailed({
									message: `Runtime Host Connector configuration cannot open Operation "${input.operationId}"`,
									sessionId: input.sessionId,
									operationId: input.operationId,
									cause: connector.error,
								}),
							);
						}
						const webSearch = createRuntimeWebSearchAgentAssembly(agentSettings);
						if (webSearch.isErr()) {
							return Result.err(
								new RuntimeOperationOpenFailed({
									message: `Runtime Host Web Search configuration cannot open Operation "${input.operationId}"`,
									sessionId: input.sessionId,
									operationId: input.operationId,
									cause: webSearch.error,
								}),
							);
						}
						const catalogSnapshot = modelCatalog.get();
						const operationCatalog = catalogSnapshot.isOk()
							? catalogSnapshot.value
							: { stale: false, refreshed: false };
						const compatibilityProfile = resolveRuntimeModelCompatibilityProfile(
							input.runtimeConfiguration.model,
							current.value.provider,
							operationCatalog,
							current.value.model,
						);
						if (compatibilityProfile.isErr()) {
							return Result.err(
								new RuntimeOperationOpenFailed({
									message: `Runtime Host compatibility profile cannot open Operation "${input.operationId}"`,
									sessionId: input.sessionId,
									operationId: input.operationId,
									cause: compatibilityProfile.error,
								}),
							);
						}
						const modelMetadata = resolveRuntimeModelMetadata(
							input.runtimeConfiguration.model,
							current.value.provider,
							operationCatalog,
						);
						const sdkProvider = current.value.model.slice(0, current.value.model.indexOf("/"));
						// No catalog entry means no capabilities, so neither control reaches the provider.
						const capabilities = resolveRuntimeModelCapabilities(
							modelMetadata,
							sdkProvider === "openai"
								? "openai-responses"
								: sdkProvider === "anthropic" || sdkProvider === "openai-compatible"
									? sdkProvider
									: undefined,
						);
						return Result.ok({
							model: current.value.model,
							compatibilityProfile: compatibilityProfile.value,
							modelMetadata,
							provider: current.value.provider || undefined,
							maxTurns: current.value.maxTurns || undefined,
							instructions: current.value.instructions || undefined,
							reasoningLevel: resolveEffectiveReasoningLevel(
								input.runtimeConfiguration.reasoningLevel,
								capabilities.reasoningLevels,
							),
							fastMode: input.runtimeConfiguration.fastMode && capabilities.supportsFastMode,
							auxiliaryModel: resolveOperationAuxiliaryModel(agentSettings, operationCatalog),
							extensions: [
								createTodoExtension(),
								createSubagentExtension(),
								...connector.value.extensions,
								...webSearch.value.extensions,
							],
							extensionRuntime: connector.value.extensionRuntime,
						});
					},
					capabilitySource,
					telemetry,
				}),
			);
		},
		telemetry: options.telemetry,
		telemetryEnvironment: environment,
		telemetryErrorOutput: process.stderr,
		info: options.info ?? {
			name: "jai",
			title: "Jai",
			version: environment.JAI_VERSION ?? "0.0.0",
		},
		endpoint: options.endpoint,
	});
	return opened;
}
