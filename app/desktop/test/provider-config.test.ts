import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DesktopConfigurationClient,
  DesktopConfigurationClientError,
} from "@jai/server/desktop-configuration-client";
import type {
  RuntimeAgentSettingsInput,
  RuntimeAgentSettingsModelFetchResult,
  RuntimeAgentSettingsSnapshot,
  WorkspaceTrustSnapshot,
} from "@jai/server";
import { Result } from "better-result";
import { DesktopConfigService } from "../electron/config";

describe("DesktopConfigService", () => {
  test("persists Provider credentials only through the Runtime Host", async () => {
    const homeDir = await mkdtemp(
      join(tmpdir(), "jai-remote-provider-config-"),
    );
    const host = new FakeDesktopConfigurationClient();
    const service = new DesktopConfigService(host);
    try {
      const saved = await service.save({
        revision: null,
        profiles: [
          {
            id: "gateway",
            name: "Gateway",
            adapter: "openai-compatible",
            baseURL: "https://gateway.example.com/v1",
            authentication: "api-key",
            apiKey: "gateway-secret-1234",
            models: [
              {
                id: "gpt-test",
                name: "GPT Test",
                remoteModelId: "gpt-test",
                source: "unverified",
                verified: false,
                enabled: true,
              },
            ],
          },
        ],
      });

      expect(host.lastSaved?.providers[0]?.apiKey).toBe("gateway-secret-1234");
      expect(saved.profiles).toMatchObject([
        {
          id: "gateway",
          credentialConfigured: true,
          credentialMask: "•••• 1234",
        },
      ]);
      expect(JSON.stringify(saved)).not.toContain("gateway-secret");
      await expect(
        readFile(join(homeDir, ".jai", "settings.json"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await service.close();
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  test("keeps the Agent turn limit in the Runtime Host rather than duplicating it in Desktop settings", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "jai-remote-turn-limit-"));
    const host = new FakeDesktopConfigurationClient();
    const service = new DesktopConfigService(host);
    try {
      const saved = await service.save({
        revision: null,
        profiles: [],
        maxIterations: 12,
      });
      expect(host.lastSaved?.maxTurns).toBe(12);
      expect(saved.maxIterations).toBe(12);
      await expect(
        readFile(join(homeDir, ".jai", "settings.json"), "utf8"),
      ).rejects.toThrow();

      const reopened = new DesktopConfigService(host);
      try {
        expect((await reopened.get()).maxIterations).toBe(12);
      } finally {
        await reopened.close();
      }
    } finally {
      await service.close();
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  test("writes language and reasoning effort to the Runtime Host, not a Desktop settings file", async () => {
    const homeDir = await mkdtemp(
      join(tmpdir(), "jai-remote-runtime-preferences-"),
    );
    const host = new FakeDesktopConfigurationClient();
    const service = new DesktopConfigService(host);
    try {
      const saved = await service.save({
        revision: null,
        profiles: [],
        language: "zh-CN",
        reasoningEffort: "medium",
      });
      expect(host.lastSaved).toMatchObject({
        language: "zh-CN",
        reasoningEffort: "medium",
      });
      expect(saved).toMatchObject({
        language: "zh-CN",
        reasoningEffort: "medium",
      });
      await expect(
        readFile(join(homeDir, ".jai", "settings.json"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await service.close();
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  test("uses the Host-owned model inventory rather than a Desktop SQLite cache", async () => {
    const homeDir = await mkdtemp(
      join(tmpdir(), "jai-remote-provider-models-"),
    );
    const host = new FakeDesktopConfigurationClient({
      revision: "r1",
      model: "gateway/gpt-test",
      profiles: [
        {
          id: "gateway",
          name: "Gateway",
          adapter: "openai-compatible",
          baseURL: "https://gateway.example.com/v1",
          authentication: "api-key",
          credentialConfigured: true,
          credentialMask: "•••• 1234",
          enabled: true,
          models: [{ id: "gpt-test", enabled: true }],
        },
      ],
    });
    const service = new DesktopConfigService(host);
    try {
      const fetched = await service.fetchModels("gateway");
      expect(host.fetches).toEqual(["gateway"]);
      expect(fetched).toMatchObject({
        profileId: "gateway",
        modelCount: 2,
        fetchedAt: 123,
      });
      expect(
        fetched.snapshot.profiles[0]?.models.map(
          (model) => model.remoteModelId,
        ),
      ).toEqual(["gpt-next", "gpt-test"]);
    } finally {
      await service.close();
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  test("reads and refreshes Models.dev metadata only through the Runtime Host", async () => {
    const host = new FakeDesktopConfigurationClient();
    const service = new DesktopConfigService(host);
    try {
      await service.get();
      expect(host.modelCatalogReads).toEqual(["get"]);
      expect(await service.refreshModelCatalog()).toBe(true);
      expect(host.modelCatalogReads).toEqual(["get", "refresh"]);
    } finally {
      await service.close();
    }
  });

  test("reveal is an explicit Host request, not a local file read", async () => {
    const host = new FakeDesktopConfigurationClient();
    const service = new DesktopConfigService(host);
    try {
      expect(await service.revealApiKey("gateway")).toEqual({
        profileId: "gateway",
        apiKey: "host-secret",
      });
    } finally {
      await service.close();
    }
  });

  test("sends Connector secrets only to the Runtime Host and returns a safe projection", async () => {
    const homeDir = await mkdtemp(
      join(tmpdir(), "jai-remote-connector-config-"),
    );
    const host = new FakeDesktopConfigurationClient();
    const service = new DesktopConfigService(host);
    try {
      const saved = await service.save({
        revision: null,
        profiles: [],
        connector: {
          policy: { default: "allow", actions: {} },
          connectors: [
            {
              id: "context7",
              enabled: true,
              credentials: { apiKey: "ctx-secret-1234" },
            },
          ],
        },
      });

      expect(
        host.lastSaved?.connector?.connectors?.context7?.credentials?.apiKey,
      ).toBe("ctx-secret-1234");
      expect(
        saved.connector.connectors.find(
          (connector) => connector.id === "context7",
        )?.credentials,
      ).toMatchObject([{ key: "apiKey", configured: true, mask: "•••• 1234" }]);
      expect(JSON.stringify(saved)).not.toContain("ctx-secret");
      await expect(
        readFile(join(homeDir, ".jai", "settings.json"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await service.close();
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  test("forwards Connector OAuth authorization and callback to the Runtime Host without token handling", async () => {
    const host = new FakeDesktopConfigurationClient();
    const service = new DesktopConfigService(host);
    try {
      const started = await service.startConnectorOAuth("github");
      expect(host.oauthStarts).toEqual(["github"]);
      expect(started.authorizationUrl).toContain("/v1/oauth/github/authorize?");

      const connectorId = await service.completeConnectorOAuth(
        "http://127.0.0.1:43821/v1/oauth/callback?provider=github&state=host-state&code=one-time-code",
      );
      expect(connectorId).toBe("github");
      expect(host.oauthCallbacks).toEqual([
        "http://127.0.0.1:43821/v1/oauth/callback?provider=github&state=host-state&code=one-time-code",
      ]);
      const connected = await service.get();
      expect(
        connected.connector.connectors.find(
          (connector) => connector.id === "github",
        )?.oauth,
      ).toMatchObject({
        connected: true,
        scopes: ["repo", "workflow"],
      });
      expect(JSON.stringify(connected)).not.toContain("accessToken");
      expect(JSON.stringify(connected)).not.toContain("refreshToken");

      const disconnected = await service.disconnectConnectorOAuth("github");
      expect(host.oauthDisconnects).toEqual(["github"]);
      expect(
        disconnected.connector.connectors.find(
          (connector) => connector.id === "github",
        )?.oauth,
      ).toEqual({
        connected: false,
        scopes: [],
      });
    } finally {
      await service.close();
    }
  });
});

class FakeDesktopConfigurationClient implements DesktopConfigurationClient {
  readonly fetches: string[] = [];
  readonly oauthStarts: string[] = [];
  readonly oauthCallbacks: string[] = [];
  readonly oauthDisconnects: string[] = [];
  readonly modelCatalogReads: string[] = [];
  lastSaved?: RuntimeAgentSettingsInput;
  #snapshot: RuntimeAgentSettingsSnapshot;

  constructor(snapshot: Partial<RuntimeAgentSettingsSnapshot> = {}) {
    this.#snapshot = {
      revision: snapshot.revision ?? null,
      model: snapshot.model ?? "",
      ...(snapshot.maxTurns === undefined
        ? {}
        : { maxTurns: snapshot.maxTurns }),
      ...(snapshot.language === undefined
        ? {}
        : { language: snapshot.language }),
      ...(snapshot.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: snapshot.reasoningEffort }),
      profiles: snapshot.profiles ?? [],
      connector: snapshot.connector ?? {
        policy: { default: "ask", actions: {} },
        connectors: [],
      },
    };
  }

  async get() {
    return Result.ok(this.#snapshot);
  }

  async save(input: RuntimeAgentSettingsInput) {
    this.lastSaved = input;
    this.#snapshot = {
      revision: "r2",
      model: input.model,
      ...(input.maxTurns === undefined ? {} : { maxTurns: input.maxTurns }),
      ...(input.language === undefined ? {} : { language: input.language }),
      ...(input.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: input.reasoningEffort }),
      profiles: input.providers.map((profile) => ({
        id: profile.id,
        name: profile.name,
        adapter: profile.adapter,
        ...(profile.baseURL === undefined ? {} : { baseURL: profile.baseURL }),
        authentication: profile.authentication,
        credentialConfigured: Boolean(profile.apiKey),
        ...(profile.apiKey
          ? { credentialMask: `•••• ${profile.apiKey.slice(-4)}` }
          : {}),
        enabled: profile.enabled,
        models: profile.models,
      })),
      connector:
        input.connector === undefined
          ? this.#snapshot.connector
          : projectConnector(input.connector, this.#snapshot.connector),
    };
    return Result.ok(this.#snapshot);
  }

  async fetchModels(profileId: string) {
    this.fetches.push(profileId);
    const profile = this.#snapshot.profiles.find(
      (candidate) => candidate.id === profileId,
    );
    if (!profile) return Result.err({} as DesktopConfigurationClientError);
    this.#snapshot = {
      ...this.#snapshot,
      profiles: this.#snapshot.profiles.map((candidate) =>
        candidate.id === profileId
          ? {
              ...candidate,
              modelsFetchedAt: 123,
              models: [
                { id: "gpt-test", enabled: true },
                { id: "gpt-next", enabled: false },
              ],
            }
          : candidate,
      ),
    };
    return Result.ok({
      profileId,
      modelCount: 2,
      fetchedAt: 123,
      snapshot: this.#snapshot,
    } satisfies RuntimeAgentSettingsModelFetchResult);
  }

  async revealApiKey(profileId: string) {
    return Result.ok({ profileId, apiKey: "host-secret" });
  }

  async startConnectorOAuth(connectorId: string) {
    this.oauthStarts.push(connectorId);
    return Result.ok({
      connectorId,
      expiresAt: 1_800_000_000_000,
      authorizationUrl:
        "https://oauth.jai.dev/v1/oauth/github/authorize?state=host-state&code_challenge=host-challenge&code_challenge_method=S256",
    });
  }

  async completeConnectorOAuth(callbackUrl: string) {
    this.oauthCallbacks.push(callbackUrl);
    const connectorId = "github";
    const current = this.#snapshot.connector;
    const existing = current.connectors.find(
      (connector) => connector.id === connectorId,
    );
    this.#snapshot = {
      ...this.#snapshot,
      connector: {
        ...current,
        connectors: [
          ...current.connectors.filter(
            (connector) => connector.id !== connectorId,
          ),
          {
            id: connectorId,
            enabled: existing?.enabled ?? true,
            credentials: existing?.credentials ?? [],
            oauth: {
              connected: true,
              scopes: ["repo", "workflow"],
            },
          },
        ],
      },
    };
    return Result.ok({ connectorId, snapshot: this.#snapshot });
  }

  async disconnectConnectorOAuth(connectorId: string) {
    this.oauthDisconnects.push(connectorId);
    const current = this.#snapshot.connector;
    const existing = current.connectors.find(
      (connector) => connector.id === connectorId,
    );
    this.#snapshot = {
      ...this.#snapshot,
      connector: {
        ...current,
        connectors: [
          ...current.connectors.filter(
            (connector) => connector.id !== connectorId,
          ),
          {
            id: connectorId,
            enabled: existing?.enabled ?? true,
            credentials: existing?.credentials ?? [],
            oauth: { connected: false, scopes: [] },
          },
        ],
      },
    };
    return Result.ok(this.#snapshot);
  }

  async getModelCatalog() {
    this.modelCatalogReads.push("get");
    return Result.ok({
      catalog: {
        providers: {
          openai: {
            id: "openai",
            name: "OpenAI",
            models: { "gpt-test": { id: "gpt-test", name: "GPT Test" } },
          },
        },
      },
      fetchedAt: 1,
      stale: false,
      refreshed: false,
    });
  }

  async refreshModelCatalog() {
    this.modelCatalogReads.push("refresh");
    return Result.ok({
      catalog: {
        providers: {
          openai: {
            id: "openai",
            name: "OpenAI",
            models: { "gpt-test": { id: "gpt-test", name: "GPT Test" } },
          },
        },
      },
      fetchedAt: 2,
      stale: false,
      refreshed: true,
    });
  }

  async getWorkspaceTrust(workspacePath: string) {
    return Result.ok({
      workspacePath,
      trusted: false,
    } satisfies WorkspaceTrustSnapshot);
  }

  async setWorkspaceTrust(workspacePath: string, trusted: boolean) {
    return Result.ok({
      workspacePath,
      trusted,
    } satisfies WorkspaceTrustSnapshot);
  }

  async close(): Promise<void> {}
}

function projectConnector(
  input: NonNullable<RuntimeAgentSettingsInput["connector"]>,
  previous: RuntimeAgentSettingsSnapshot["connector"],
): RuntimeAgentSettingsSnapshot["connector"] {
  const existing = new Map(
    previous.connectors.map((connector) => [connector.id, connector]),
  );
  return {
    policy: {
      default: input.policy?.default ?? "ask",
      actions: { ...(input.policy?.actions ?? {}) },
    },
    connectors: Object.entries(input.connectors ?? {}).map(
      ([id, connector]) => ({
        id,
        enabled: connector.enabled !== false,
        credentials: Object.entries(connector.credentials ?? {}).map(
          ([key, value]) => ({
            key,
            configured: Boolean(value),
            ...(value ? { mask: `•••• ${value.slice(-4)}` } : {}),
          }),
        ),
        ...(existing.get(id)?.oauth === undefined
          ? {}
          : { oauth: existing.get(id)!.oauth }),
      }),
    ),
  };
}
