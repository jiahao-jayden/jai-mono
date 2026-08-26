import {
  connectDesktopConfigurationClient,
  type DesktopConfigurationClient,
} from "@jai/server/desktop-configuration-client";
import type {
  RuntimeAgentSettingsInput,
  RuntimeAgentSettingsSnapshot,
  RuntimeModelCatalog,
} from "@jai/server";
import type {
  DesktopProviderApiKeyRevealResult,
  DesktopProviderConfigInput,
  DesktopProviderConfigSnapshot,
  DesktopProviderFetchModelsResult,
} from "../../shared/desktop-rpc";
import {
  findDesktopConnectorOAuthApplication,
  projectRuntimeConnectorConfig,
  toRuntimeConnector,
  validateConnectorConfigInput,
} from "./connector";
import {
  projectRuntimeProviderConfig,
  providerConfigError,
  validateProviderProfiles,
} from "./provider";

/**
 * Desktop's configuration adapter. Runtime-affecting settings, Provider facts
 * and credentials all live in the Runtime Host; this module only projects and
 * submits safe DTOs over its private control channel.
 */
export class DesktopConfigService {
  #catalog?: RuntimeModelCatalog;

  constructor(private readonly client: DesktopConfigurationClient) {}

  static async open(
    options: {
      readonly homeDir?: string;
      readonly environment?: Readonly<Record<string, string | undefined>>;
    } = {},
  ): Promise<DesktopConfigService> {
    const connected = await connectDesktopConfigurationClient({
      environment: options.environment,
    });
    if (connected.isErr()) throw connected.error;
    const service = new DesktopConfigService(connected.value);
    await service.#loadModelCatalog();
    return service;
  }

  async get(): Promise<DesktopProviderConfigSnapshot> {
    const [remote] = await Promise.all([
      this.#remoteSnapshot(),
      this.#loadModelCatalog(),
    ]);
    return this.#project(remote);
  }

  async save(
    input: DesktopProviderConfigInput,
  ): Promise<DesktopProviderConfigSnapshot> {
    await this.#loadModelCatalog();
    validateInput(input, this.#catalog);
    const remote = await this.#remoteSnapshot();
    const savedRemote = await this.client.save(toRuntimeInput(input, remote));
    if (savedRemote.isErr()) throw savedRemote.error;
    return this.#project(savedRemote.value);
  }

  async fetchModels(
    profileId: string,
  ): Promise<DesktopProviderFetchModelsResult> {
    const fetched = await this.client.fetchModels(profileId);
    if (fetched.isErr()) throw fetched.error;
    return {
      profileId: fetched.value.profileId,
      modelCount: fetched.value.modelCount,
      fetchedAt: fetched.value.fetchedAt,
      snapshot: this.#project(fetched.value.snapshot),
    };
  }

  async refreshModelCatalog(): Promise<boolean> {
    const refreshed = await this.client.refreshModelCatalog();
    if (refreshed.isErr()) throw refreshed.error;
    this.#catalog = refreshed.value.catalog;
    return refreshed.value.refreshed;
  }

  async revealApiKey(
    profileId: string,
  ): Promise<DesktopProviderApiKeyRevealResult> {
    const revealed = await this.client.revealApiKey(profileId);
    if (revealed.isErr()) throw revealed.error;
    return revealed.value;
  }

  async startConnectorOAuth(connectorId: string) {
    const application = findDesktopConnectorOAuthApplication(connectorId);
    if (!application) throw invalidInput("Unknown OAuth Connector application");
    const started = await this.client.startConnectorOAuth(application.id);
    if (started.isErr()) throw started.error;
    return started.value;
  }

  async completeConnectorOAuth(callbackUrl: string) {
    const completed = await this.client.completeConnectorOAuth(callbackUrl);
    if (completed.isErr()) throw completed.error;
    return completed.value.connectorId;
  }

  async disconnectConnectorOAuth(
    connectorId: string,
  ): Promise<DesktopProviderConfigSnapshot> {
    const application = findDesktopConnectorOAuthApplication(connectorId);
    if (!application) throw invalidInput("Unknown OAuth Connector application");
    const saved = await this.client.disconnectConnectorOAuth(application.id);
    if (saved.isErr()) throw saved.error;
    return this.#project(saved.value);
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async #remoteSnapshot(): Promise<RuntimeAgentSettingsSnapshot> {
    const snapshot = await this.client.get();
    if (snapshot.isErr()) throw snapshot.error;
    return snapshot.value;
  }

  async #loadModelCatalog(): Promise<void> {
    const catalog = await this.client.getModelCatalog();
    if (catalog.isOk()) this.#catalog = catalog.value.catalog;
  }

  #project(
    remote: RuntimeAgentSettingsSnapshot,
  ): DesktopProviderConfigSnapshot {
    return {
      ...projectRuntimeProviderConfig(remote, this.#catalog),
      ...(remote.language === undefined ? {} : { language: remote.language }),
      ...(remote.maxTurns === undefined
        ? {}
        : { maxIterations: remote.maxTurns }),
      ...(remote.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: remote.reasoningEffort }),
      connector: projectRuntimeConnectorConfig(remote.connector),
    };
  }
}

function toRuntimeInput(
  input: DesktopProviderConfigInput,
  current: RuntimeAgentSettingsSnapshot,
): RuntimeAgentSettingsInput {
  return {
    revision: input.revision,
    model: selectDefaultModel(input, current.model),
    ...(input.maxIterations === undefined
      ? {}
      : { maxTurns: input.maxIterations }),
    ...(input.language === undefined ? {} : { language: input.language }),
    ...(input.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: input.reasoningEffort }),
    ...(input.connector === undefined
      ? {}
      : { connector: toRuntimeConnector(input.connector) }),
    providers: input.profiles.map((profile) => ({
      id: profile.id,
      ...(profile.previousId === undefined
        ? {}
        : { previousId: profile.previousId }),
      name: profile.name,
      adapter: profile.adapter,
      ...(profile.baseURL.trim() ? { baseURL: profile.baseURL } : {}),
      authentication: profile.authentication,
      ...(profile.apiKey === undefined ? {} : { apiKey: profile.apiKey }),
      ...(profile.clearApiKey === undefined
        ? {}
        : { clearApiKey: profile.clearApiKey }),
      enabled: true,
      models: profile.models.map((model) => ({
        id: model.id,
        ...(model.remoteModelId === model.id
          ? {}
          : { remoteModelId: model.remoteModelId }),
        enabled: model.enabled,
      })),
    })),
  };
}

function selectDefaultModel(
  input: DesktopProviderConfigInput,
  current: string,
): string {
  if (current) return current;
  for (const profile of input.profiles) {
    const model = profile.models.find((candidate) => candidate.enabled);
    if (model) return `${profile.id}/${model.remoteModelId}`;
  }
  return "";
}

function validateInput(
  input: DesktopProviderConfigInput,
  catalog: Parameters<typeof validateProviderProfiles>[1],
): void {
  if (
    !isRecord(input) ||
    (input.revision !== null && typeof input.revision !== "string") ||
    !isRuntimePresentationInput(input) ||
    !validateConnectorConfigInput(input.connector)
  ) {
    throw invalidInput("Invalid Provider configuration");
  }
  validateProviderProfiles(input.profiles, catalog);
}

function isRuntimePresentationInput(
  input: Pick<
    DesktopProviderConfigInput,
    "language" | "maxIterations" | "reasoningEffort"
  >,
): boolean {
  return !(
    (input.language !== undefined &&
      (typeof input.language !== "string" ||
        !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(input.language))) ||
    (input.maxIterations !== undefined &&
      (!Number.isInteger(input.maxIterations) || input.maxIterations < 1)) ||
    (input.reasoningEffort !== undefined &&
      input.reasoningEffort !== "low" &&
      input.reasoningEffort !== "medium" &&
      input.reasoningEffort !== "high")
  );
}

function invalidInput(message: string) {
  return providerConfigError("invalid_input", { message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
