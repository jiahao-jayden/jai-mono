import { Result, type Result as ResultType } from "better-result";
import {
	createCodingAgentOperationDriver,
	createRuntimeConnectorAgentAssembly,
} from "../agents";
import { RuntimeOperationOpenFailed } from "../operations";
import type { AcpImplementationInfo } from "../protocol/acp-v2";
import {
	createDesktopLocalRuntimeCapabilitySource,
	type RuntimeCapabilitySource,
} from "../runtime-capabilities";
import {
  openJaiRuntimeServer,
  type JaiRuntimeServer,
  JaiRuntimeServerOpenFailed,
} from "./server";
import { resolveJaiDataDirectory } from "./paths";
import { RuntimeHostConfigurationInvalid } from "./configuration";

export interface OpenConfiguredRuntimeHostOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly dataDirectory?: string;
	/** Product-owned user capability root; defaults to the OS user's home directory. */
	readonly homeDirectory?: string;
	/** Alternate Host source used by non-local products and deterministic tests. */
	readonly capabilitySource?: RuntimeCapabilitySource;
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
): Promise<
  ResultType<
    JaiRuntimeServer,
    RuntimeHostConfigurationInvalid | JaiRuntimeServerOpenFailed
  >
> {
  const environment = options.environment ?? process.env;
  const dataDirectory =
    options.dataDirectory ?? resolveJaiDataDirectory(environment);
	const opened = await openJaiRuntimeServer({
		dataDirectory,
		createOperationDriver: ({ agentSettings, workspaceTrust }) => {
			const capabilitySource =
				options.capabilitySource ??
				createDesktopLocalRuntimeCapabilitySource({
					dataDirectory,
					workspaceTrust,
					...(options.homeDirectory === undefined
						? {}
						: { homeDirectory: options.homeDirectory }),
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
        createCodingAgentOperationDriver({
          resolveOptions: async (input) => {
            const current = agentSettings.resolveOptions(
              input.runtimeConfiguration.model,
            );
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
            const connector =
              createRuntimeConnectorAgentAssembly(agentSettings);
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
				return Result.ok({
              model: current.value.model,
              ...(current.value.provider
                ? { provider: current.value.provider }
                : {}),
              ...(current.value.maxTurns
                ? { maxTurns: current.value.maxTurns }
                : {}),
              ...(current.value.instructions
                ? { instructions: current.value.instructions }
                : {}),
              ...(current.value.providerOptions
                ? { providerOptions: current.value.providerOptions }
                : {}),
					extensions: connector.value.extensions,
					extensionRuntime: connector.value.extensionRuntime,
				});
			},
			capabilitySource,
		}),
      );
    },
    info: options.info ?? {
      name: "jai",
      title: "Jai",
      version: environment.JAI_VERSION ?? "0.0.0",
    },
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
  });
  return opened;
}
