import { describe, expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { SqliteRuntimeAgentSettings } from "../../src/config";

describe("Runtime Agent Settings", () => {
  test("persists Provider profiles as Server facts while projecting credentials safely", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const settings = new SqliteRuntimeAgentSettings(database);
      const bootstrapped = settings.bootstrap({
        model: "openai/bootstrap",
        providers: {},
        extensions: {},
      });
      if (bootstrapped.isErr()) throw bootstrapped.error;
      const first = settings.snapshot();
      if (first.isErr()) throw first.error;

      const saved = settings.write({
        revision: first.value.revision,
        model: "gateway/gpt-test",
        maxTurns: 12,
        language: "zh-CN",
        reasoningEffort: "high",
        providers: [
          {
            id: "gateway",
            name: "Gateway",
            adapter: "openai-compatible",
            baseURL: "https://gateway.example.com/v1",
            authentication: "api-key",
            apiKey: "gateway-secret-1234",
            enabled: true,
            models: [{ id: "gpt-test", enabled: true }],
          },
        ],
      });
      if (saved.isErr()) throw saved.error;

      expect(saved.value).toMatchObject({
        model: "gateway/gpt-test",
        maxTurns: 12,
        language: "zh-CN",
        reasoningEffort: "high",
        profiles: [
          {
            id: "gateway",
            credentialConfigured: true,
            credentialMask: "•••• 1234",
          },
        ],
      });
      expect(JSON.stringify(saved.value)).not.toContain("gateway-secret");

      const resolved = settings.resolveOptions();
      if (resolved.isErr()) throw resolved.error;
      expect(resolved.value).toEqual({
        model: "openai-compatible/gpt-test",
        provider: {
          apiKey: "gateway-secret-1234",
          baseUrl: "https://gateway.example.com/v1",
          authentication: "bearer",
        },
        maxTurns: 12,
        instructions: "Respond in zh-CN.",
        providerOptions: { "openai-compatible": { reasoning_effort: "high" } },
      });
    } finally {
      database.close();
    }
  });

  test("preserves a stored credential when the connection changes and detects stale writes", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const settings = new SqliteRuntimeAgentSettings(database);
      const initialized = settings.write({
        revision: null,
        model: "gateway/gpt-test",
        providers: [
          {
            id: "gateway",
            name: "Gateway",
            adapter: "openai-compatible",
            authentication: "api-key",
            apiKey: "gateway-secret-1234",
            enabled: true,
            models: [{ id: "gpt-test", enabled: true }],
          },
        ],
      });
      if (initialized.isErr()) throw initialized.error;
      const preserved = settings.write({
        revision: initialized.value.revision,
        model: "gateway/gpt-test",
        maxTurns: 8,
        providers: initialized.value.profiles.map(
          ({
            credentialConfigured: _configured,
            credentialMask: _mask,
            ...profile
          }) => profile,
        ),
      });
      if (preserved.isErr()) throw preserved.error;
      expect(preserved.value.profiles[0]?.credentialConfigured).toBe(true);

      const stale = settings.write({
        revision: initialized.value.revision,
        model: "gateway/gpt-test",
        providers: [],
      });
      expect(stale.isErr()).toBe(true);
      if (stale.isOk()) throw new Error("Expected a settings write conflict");
      expect(stale.error._tag).toBe(
        "runtime_config.agent_settings_write_conflict",
      );

      const changedConnection = settings.write({
        revision: preserved.value.revision,
        model: "gateway/gpt-test",
        providers: preserved.value.profiles.map(
          ({
            credentialConfigured: _configured,
            credentialMask: _mask,
            ...profile
          }) => ({
            ...profile,
            baseURL: "https://changed.example.com/v1",
          }),
        ),
      });
      if (changedConnection.isErr()) throw changedConnection.error;
      expect(changedConnection.value.profiles[0]).toMatchObject({
        credentialConfigured: true,
        credentialMask: "•••• 1234",
      });
      const resolved = settings.resolveOptions();
      if (resolved.isErr()) throw resolved.error;
      expect(resolved.value.provider).toEqual({
        apiKey: "gateway-secret-1234",
        baseUrl: "https://changed.example.com/v1",
        authentication: "bearer",
      });
    } finally {
      database.close();
    }
  });

  test("rejects a configured reasoning effort when the selected model has no supported request option", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const settings = new SqliteRuntimeAgentSettings(database);
      const saved = settings.write({
        revision: null,
        model: "anthropic/claude-test",
        reasoningEffort: "low",
        providers: [],
      });
      expect(saved).toMatchObject({
        status: "error",
        error: { _tag: "runtime_config.agent_settings_invalid" },
      });
    } finally {
      database.close();
    }
  });

  test("stores Connector credentials but projects only configured and masked fields", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const settings = new SqliteRuntimeAgentSettings(database);
      const saved = settings.write({
        revision: null,
        model: "",
        providers: [],
        connector: {
          policy: {
            default: "ask",
            actions: { "context7.search_libraries": "allow" },
          },
          connectors: {
            context7: {
              enabled: true,
              credentials: { apiKey: "ctx-secret-1234" },
            },
          },
        },
      });
      if (saved.isErr()) throw saved.error;
      expect(saved.value.connector).toEqual({
        policy: {
          default: "ask",
          actions: { "context7.search_libraries": "allow" },
        },
        connectors: [
          {
            id: "context7",
            enabled: true,
            credentials: [
              { key: "apiKey", configured: true, mask: "•••• 1234" },
            ],
          },
        ],
      });
      expect(JSON.stringify(saved.value)).not.toContain("ctx-secret");
    } finally {
      database.close();
    }
  });

  test("retains non-OAuth credentials while saving and disconnecting OAuth without projecting tokens", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const settings = new SqliteRuntimeAgentSettings(database);
      const initialized = settings.write({
        revision: null,
        model: "",
        providers: [],
        connector: {
          policy: { default: "ask", actions: {} },
          connectors: {
            context7: {
              enabled: true,
              credentials: { apiKey: "ctx-secret-1234" },
            },
            github: { enabled: true },
          },
        },
      });
      if (initialized.isErr()) throw initialized.error;

      const connected = settings.saveConnectorOAuth({
        connectorId: "github",
        accessToken: "github-access-token",
        tokenType: "Bearer",
        refreshToken: "github-refresh-token",
        expiresAt: 1_800_000_000_000,
        scopes: ["repo", "workflow"],
      });
      if (connected.isErr()) throw connected.error;
      expect(connected.value.connector.connectors).toContainEqual({
        id: "github",
        enabled: true,
        credentials: [],
        oauth: {
          connected: true,
          scopes: ["repo", "workflow"],
          expiresAt: 1_800_000_000_000,
        },
      });
      expect(JSON.stringify(connected.value)).not.toContain(
        "github-access-token",
      );
      expect(JSON.stringify(connected.value)).not.toContain(
        "github-refresh-token",
      );

      const stored = settings.readConnectorSettings();
      if (stored.isErr()) throw stored.error;
      expect(stored.value.connectors?.github?.credentials).toMatchObject({
        accessToken: "github-access-token",
        refreshToken: "github-refresh-token",
      });

      const disconnected = settings.disconnectConnectorOAuth("github");
      if (disconnected.isErr()) throw disconnected.error;
      const afterDisconnect = settings.readConnectorSettings();
      if (afterDisconnect.isErr()) throw afterDisconnect.error;
      expect(
        afterDisconnect.value.connectors?.github?.credentials,
      ).toBeUndefined();
      expect(
        afterDisconnect.value.connectors?.context7?.credentials?.apiKey,
      ).toBe("ctx-secret-1234");
    } finally {
      database.close();
    }
  });

  test("reveals saved Connector secrets without exposing OAuth credentials", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const settings = new SqliteRuntimeAgentSettings(database);
      const saved = settings.write({
        revision: null,
        model: "",
        providers: [],
        connector: {
          policy: { default: "ask", actions: {} },
          connectors: {
            context7: { credentials: { apiKey: "ctx-secret-1234" } },
            github: { credentials: { accessToken: "oauth-secret" } },
          },
        },
      });
      if (saved.isErr()) throw saved.error;

      expect(settings.revealConnectorCredential("context7", "apiKey")).toMatchObject({
        status: "ok",
        value: { connectorId: "context7", credentialKey: "apiKey", value: "ctx-secret-1234" },
      });
      expect(settings.revealConnectorCredential("github", "accessToken")).toMatchObject({
        status: "error",
        error: { _tag: "runtime_config.agent_settings_invalid" },
      });
    } finally {
      database.close();
    }
  });

  test("stores Web Search order and credentials in the Runtime Host projection", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const settings = new SqliteRuntimeAgentSettings(database);
      const saved = settings.write({
        revision: null,
        model: "",
        providers: [],
        webSearch: {
          providers: [
            { id: "exa", enabled: true, order: 2, apiKey: "exa-secret-1234" },
            { id: "parallel", enabled: true, order: 1, apiKey: "parallel-secret-5678" },
            { id: "anysearch", enabled: false },
          ],
        },
      });
      if (saved.isErr()) throw saved.error;

      expect(saved.value.webSearch).toEqual({
        providers: [
          { id: "exa", enabled: true, order: 2, credentialConfigured: true, credentialMask: "•••• 1234" },
          { id: "parallel", enabled: true, order: 1, credentialConfigured: true, credentialMask: "•••• 5678" },
          { id: "anysearch", enabled: false, credentialConfigured: false },
        ],
        fetch: { jina: { credentialConfigured: false } },
      });
      expect(JSON.stringify(saved.value)).not.toContain("exa-secret");
      expect(JSON.stringify(saved.value)).not.toContain("parallel-secret");

      const raw = settings.readWebSearchSettings();
      if (raw.isErr()) throw raw.error;
      expect(raw.value.providers.exa.apiKey).toBe("exa-secret-1234");
      expect(raw.value.providers.parallel.apiKey).toBe("parallel-secret-5678");
    } finally {
      database.close();
    }
  });

  test("preserves and clears Web Search keys through write-only input", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const settings = new SqliteRuntimeAgentSettings(database);
      const initialized = settings.write({
        revision: null,
        model: "",
        providers: [],
        webSearch: {
          providers: [{ id: "exa", enabled: false, apiKey: "exa-secret-1234" }],
        },
      });
      if (initialized.isErr()) throw initialized.error;

      const preserved = settings.write({
        revision: initialized.value.revision,
        model: "",
        providers: [],
        webSearch: { providers: [{ id: "exa", enabled: true }] },
      });
      if (preserved.isErr()) throw preserved.error;
      expect(preserved.value.webSearch.providers[0]).toMatchObject({
        id: "exa",
        enabled: true,
        credentialConfigured: true,
      });

      const cleared = settings.write({
        revision: preserved.value.revision,
        model: "",
        providers: [],
        webSearch: { providers: [{ id: "exa", enabled: false, clearApiKey: true }] },
      });
      if (cleared.isErr()) throw cleared.error;
      expect(cleared.value.webSearch.providers[0]).toEqual({
        id: "exa",
        enabled: false,
        credentialConfigured: false,
      });
      const raw = settings.readWebSearchSettings();
      if (raw.isErr()) throw raw.error;
      expect(raw.value.providers.exa.apiKey).toBeUndefined();
    } finally {
      database.close();
    }
  });

  test("stores an optional Jina Reader key without requiring it", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const settings = new SqliteRuntimeAgentSettings(database);
      const withoutKey = settings.write({
        revision: null,
        model: "",
        providers: [],
        webSearch: { providers: [], fetch: { jina: {} } },
      });
      if (withoutKey.isErr()) throw withoutKey.error;
      expect(withoutKey.value.webSearch.fetch).toEqual({ jina: { credentialConfigured: false } });

      const withKey = settings.write({
        revision: withoutKey.value.revision,
        model: "",
        providers: [],
        webSearch: { providers: [], fetch: { jina: { apiKey: "jina-secret-1234" } } },
      });
      if (withKey.isErr()) throw withKey.error;
      expect(withKey.value.webSearch.fetch).toEqual({ jina: { credentialConfigured: true, credentialMask: "•••• 1234" } });
      expect(JSON.stringify(withKey.value)).not.toContain("jina-secret-1234");

      const raw = settings.readWebSearchSettings();
      if (raw.isErr()) throw raw.error;
      expect(raw.value.fetch?.jina.apiKey).toBe("jina-secret-1234");
    } finally {
      database.close();
    }
  });

  test("reveals saved Web Search credentials without exposing them in snapshots", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const settings = new SqliteRuntimeAgentSettings(database);
      const saved = settings.write({
        revision: null,
        model: "",
        providers: [],
        webSearch: {
          providers: [{ id: "exa", enabled: false, apiKey: "exa-secret-1234" }],
          fetch: { jina: { apiKey: "jina-secret-5678" } },
        },
      });
      if (saved.isErr()) throw saved.error;

      const exa = settings.revealWebSearchApiKey("exa");
      if (exa.isErr()) throw exa.error;
      expect(exa.value).toEqual({ credentialId: "exa", apiKey: "exa-secret-1234" });

      const jina = settings.revealWebSearchApiKey("jina");
      if (jina.isErr()) throw jina.error;
      expect(jina.value).toEqual({ credentialId: "jina", apiKey: "jina-secret-5678" });
    } finally {
      database.close();
    }
  });

  test("rejects enabled Web Search without a key, unknown fields, and stale revisions", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const settings = new SqliteRuntimeAgentSettings(database);
      const missingKey = settings.write({
        revision: null,
        model: "",
        providers: [],
        webSearch: { providers: [{ id: "exa", enabled: true }] },
      });
      expect(missingKey).toMatchObject({ status: "error", error: { _tag: "runtime_config.agent_settings_invalid" } });

      const invalidInput = settings.write({
        revision: null,
        model: "",
        providers: [],
        webSearch: { providers: [{ id: "exa", enabled: false, unexpected: true } as never] },
      });
      expect(invalidInput).toMatchObject({ status: "error", error: { _tag: "runtime_config.agent_settings_invalid" } });

      const initialized = settings.write({ revision: null, model: "", providers: [] });
      if (initialized.isErr()) throw initialized.error;
      const stale = settings.write({ revision: "stale", model: "", providers: [] });
      expect(stale).toMatchObject({ status: "error", error: { _tag: "runtime_config.agent_settings_write_conflict" } });
    } finally {
      database.close();
    }
  });
});
