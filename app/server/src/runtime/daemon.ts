import { join } from "node:path";
import { Result, type Result as ResultType } from "better-result";
import {
  createCodingAgentOperationDriver,
  createRuntimeAgentPluginsExtension,
  createRuntimeConnectorAgentAssembly,
} from "../agents";
import { RuntimeOperationOpenFailed } from "../operations";
import type { AcpImplementationInfo } from "../protocol/acp-v2";
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
            const trust = await workspaceTrust.get(input.cwd);
            if (
              trust.isErr() &&
              trust.error._tag !== "workspace_trust.invalid"
            ) {
              return Result.err(
                new RuntimeOperationOpenFailed({
                  message: `Runtime Host could not resolve Workspace trust for Operation "${input.operationId}"`,
                  sessionId: input.sessionId,
                  operationId: input.operationId,
                  cause: trust.error,
                }),
              );
            }
            const agentPlugins = await createRuntimeAgentPluginsExtension({
              dataDirectory: join(
                dataDirectory,
                "agent-plugins",
                input.sessionId,
              ),
              ...(options.homeDirectory === undefined
                ? {}
                : { homeDirectory: options.homeDirectory }),
              ...(trust.isOk() && trust.value.trusted
                ? { trustedWorkspacePath: trust.value.workspacePath }
                : {}),
            });
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
              extensions: [...connector.value.extensions, agentPlugins],
              extensionRuntime: connector.value.extensionRuntime,
              agentDataRoot: join(dataDirectory, "agent"),
            });
          },
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
