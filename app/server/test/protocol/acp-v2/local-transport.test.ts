import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "better-result";
import {
  type RuntimeOperation,
  type RuntimeOperationDriver,
  RuntimeOperationExecutionFailed,
  type RuntimeOperationOpenInput,
} from "../../../src/operations";
import { openLocalAcpV2Server } from "../../../src/protocol/acp-v2";
import { RuntimeHost } from "../../../src/runtime";
import { InMemoryProductSessionPersistence } from "../../../src/sessions";

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `id-${index}`;
}

describe("ACP v2 local transport", () => {
  test("serves JSONL RPC and pushes durable Agent updates after the prompt response", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jai-acp-"));
    const endpoint = join(directory, "runtime.sock");
    const driver = new SocketProjectionDriver();
    const host = new RuntimeHost({
      persistence: new InMemoryProductSessionPersistence(),
      operationDriver: driver,
      createId: ids("session-1", "operation-1"),
    });
    const opened = await openLocalAcpV2Server({
      endpoint,
      host,
      info: { name: "jai", version: "0.0.0" },
    });
    if (opened.isErr()) throw opened.error;
    const client = await connectJsonl(endpoint);
    try {
      client.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 2,
          capabilities: {},
          info: { name: "test", version: "1.0.0" },
        },
      });
      expect(await client.next()).toMatchObject({
        id: 1,
        result: { protocolVersion: 2 },
      });
      client.send({
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: { cwd: "/workspace" },
      });
      expect(await client.next()).toEqual({
        jsonrpc: "2.0",
        id: 2,
        result: { sessionId: "session-1" },
      });
      client.send({
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: {
          sessionId: "session-1",
          prompt: [{ type: "text", text: "say done" }],
        },
      });
      expect(await client.next()).toEqual({
        jsonrpc: "2.0",
        id: 3,
        result: {},
      });
      expect(await client.next()).toMatchObject({
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "user_message",
            messageId: "operation-1:input",
          },
        },
      });
      expect(await client.next()).toMatchObject({
        method: "session/update",
        params: { update: { sessionUpdate: "state_update", state: "running" } },
      });
      await driver.opened;

      await driver.appendAssistant("done");
      expect(await client.next()).toMatchObject({
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "agent_message",
            messageId: "assistant-1",
            content: [{ type: "text", text: "done" }],
          },
        },
      });
      driver.finish("completed");
      await driver.closed;
      expect(await client.next()).toMatchObject({
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "state_update",
            state: "idle",
            stopReason: "end_turn",
          },
        },
      });
    } finally {
      client.close();
      await opened.value.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("discards a Host-managed ephemeral Session when its ACP connection closes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jai-acp-ephemeral-"));
    const endpoint = join(directory, "runtime.sock");
    const durablePersistence = new InMemoryProductSessionPersistence();
    const driver = new SocketProjectionDriver();
    const host = new RuntimeHost({
      persistence: durablePersistence,
      createEphemeralPersistence: () => new InMemoryProductSessionPersistence(),
      operationDriver: driver,
      createId: ids("ephemeral-1", "operation-1"),
    });
    const opened = await openLocalAcpV2Server({
      endpoint,
      host,
      info: { name: "jai", version: "0.0.0" },
    });
    if (opened.isErr()) throw opened.error;
    const client = await connectJsonl(endpoint);
    try {
      client.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 2,
          capabilities: {},
          info: { name: "test", version: "1.0.0" },
        },
      });
      await client.next();
      client.send({
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: { cwd: "/workspace", ephemeral: true },
      });
      expect(await client.next()).toEqual({
        jsonrpc: "2.0",
        id: 2,
        result: { sessionId: "ephemeral-1" },
      });
      client.send({
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: {
          sessionId: "ephemeral-1",
          prompt: [{ type: "text", text: "one-shot" }],
        },
      });
      await driver.opened;

      client.close();
      await driver.closed;

      const durable = await durablePersistence.load("ephemeral-1");
      expect(durable.isErr()).toBe(true);
      const listed = await host.listSessions();
      if (listed.isErr()) throw listed.error;
      expect(listed.value).toEqual([]);
      const resumed = await host.openSession({
        kind: "resume",
        id: "ephemeral-1",
        cwd: "/workspace",
      });
      expect(resumed.isErr()).toBe(true);
    } finally {
      client.close();
      await opened.value.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("reconnects a durable ACP Session without opening a second live driver", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jai-acp-reconnect-"));
    const endpoint = join(directory, "runtime.sock");
    const persistence = new InMemoryProductSessionPersistence();
    const driver = new SocketProjectionDriver();
    const opened = await openLocalAcpV2Server({
      endpoint,
      host: new RuntimeHost({
        persistence,
        operationDriver: driver,
        createId: ids("session-1", "operation-1"),
      }),
      info: { name: "jai", version: "0.0.0" },
    });
    if (opened.isErr()) throw opened.error;
    const first = await connectJsonl(endpoint);
    let second: JsonlClient | undefined;
    try {
      first.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 2,
          capabilities: {},
          info: { name: "test", version: "1.0.0" },
        },
      });
      await first.next();
      first.send({
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: { cwd: "/workspace" },
      });
      await first.next();
      first.send({
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: {
          sessionId: "session-1",
          prompt: [{ type: "text", text: "survive a reconnect" }],
        },
      });
      await driver.opened;

      first.close();
      await first.closed();
      await Promise.resolve();
      await Promise.resolve();

      second = await connectJsonl(endpoint);
      second.send({
        jsonrpc: "2.0",
        id: 4,
        method: "initialize",
        params: {
          protocolVersion: 2,
          capabilities: {},
          info: { name: "test", version: "1.0.0" },
        },
      });
      await second.next();
      second.send({
        jsonrpc: "2.0",
        id: 5,
        method: "session/resume",
        params: { sessionId: "session-1", cwd: "/workspace" },
      });
      expect(await second.next()).toEqual({
        jsonrpc: "2.0",
        id: 5,
        result: {},
      });
      expect(driver.openCalls).toBe(1);

      second.send({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: { sessionId: "session-1" },
      });
      await driver.closed;
      expect(driver.abortCalls).toBe(1);
      const durable = await persistence.load("session-1");
      if (durable.isErr()) throw durable.error;
      expect(
        durable.value.operationRecords.filter(
          (record) => record.type === "operation_finished",
        ),
      ).toHaveLength(1);
    } finally {
      first.close();
      second?.close();
      await opened.value.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("correlates a Server-initiated permission request with the Client response on the same local connection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jai-acp-reverse-"));
    const endpoint = join(directory, "runtime.sock");
    const driver = new SocketProjectionDriver();
    const host = new RuntimeHost({
      persistence: new InMemoryProductSessionPersistence(),
      operationDriver: driver,
      createId: ids("session-1", "operation-1"),
    });
    const opened = await openLocalAcpV2Server({
      endpoint,
      host,
      info: { name: "jai", version: "0.0.0" },
    });
    if (opened.isErr()) throw opened.error;
    const client = await connectJsonl(endpoint);
    try {
      client.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 2,
          capabilities: {},
          info: { name: "test", version: "1.0.0" },
        },
      });
      await client.next();
      client.send({
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: { cwd: "/workspace" },
      });
      await client.next();
      client.send({
        jsonrpc: "2.0",
        id: 3,
        method: "session/prompt",
        params: {
          sessionId: "session-1",
          prompt: [{ type: "text", text: "needs approval" }],
        },
      });
      await client.next();
      await client.next();
      await client.next();
      await driver.opened;

      const approval = driver.requestApproval();
      const request = (await client.next()) as {
        readonly jsonrpc: string;
        readonly id: number;
        readonly method: string;
        readonly params: {
          readonly options: readonly { readonly optionId: string }[];
        };
      };
      expect(request).toMatchObject({
        jsonrpc: "2.0",
        method: "session/request_permission",
        params: { sessionId: "session-1", subject: { type: "tool_call" } },
      });
      expect(request.params.options.map((option) => option.optionId)).toEqual([
        "allow-once",
        "allow-always",
        "reject",
      ]);
      client.send({
        jsonrpc: "2.0",
        id: request.id,
        result: { outcome: { outcome: "selected", optionId: "allow-once" } },
      });
      expect(await approval).toBe("allowOnce");
    } finally {
      driver.finish("completed");
      await driver.closed;
      client.close();
      await opened.value.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

class SocketProjectionDriver implements RuntimeOperationDriver {
  readonly opened: Promise<RuntimeOperationOpenInput>;
  readonly closed: Promise<void>;
  #input?: RuntimeOperationOpenInput;
  #resolveOpened!: (input: RuntimeOperationOpenInput) => void;
  #resolveClosed!: () => void;
  #resolveOutcome!: (outcome: "completed" | "failed" | "aborted") => void;
  abortCalls = 0;
  openCalls = 0;
  #outcome = new Promise<"completed" | "failed" | "aborted">((resolve) => {
    this.#resolveOutcome = resolve;
  });

  constructor() {
    this.opened = new Promise((resolve) => {
      this.#resolveOpened = resolve;
    });
    this.closed = new Promise((resolve) => {
      this.#resolveClosed = resolve;
    });
  }

  async openOperation(input: RuntimeOperationOpenInput) {
    this.openCalls += 1;
    this.#input = input;
    this.#resolveOpened(input);
    return Result.ok<RuntimeOperation, never>({
      abort: async () => {
        this.abortCalls += 1;
        this.finish("aborted");
        return Result.ok<void, RuntimeOperationExecutionFailed>(undefined);
      },
      awaitOutcome: async () => Result.ok(await this.#outcome),
      close: async () => {
        this.#resolveClosed();
      },
    });
  }

  async appendAssistant(text: string): Promise<void> {
    const input = this.#input;
    if (!input) throw new Error("Operation was not opened");
    const stored = await input.sessionStore.load(input.sessionId);
    if (!stored) throw new Error("Session was not available");
    await input.sessionStore.append(
      input.sessionId,
      {
        type: "message",
        id: "assistant-1",
        parentId: stored.snapshot.leafId,
        timestamp: "2026-08-25T12:00:00.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
          provider: "test",
          model: "test-model",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "stop",
          timestamp: Date.now(),
        },
      },
      stored.revision,
    );
  }

  requestApproval(): Promise<"deny" | "allowOnce" | "alwaysAllow"> {
    const input = this.#input;
    if (!input) throw new Error("Operation was not opened");
    return Promise.resolve(
      input.requestApproval({
        requestId: "approval-1",
        sessionId: input.sessionId,
        operationId: input.operationId,
        toolCallId: "tool-1",
        toolName: "Bash",
        title: "Run command",
        canAlwaysAllow: true,
      }),
    );
  }

  finish(outcome: "completed" | "failed" | "aborted"): void {
    this.#resolveOutcome(outcome);
  }
}

interface JsonlClient {
  send(message: unknown): void;
  next(): Promise<unknown>;
  closed(): Promise<void>;
  close(): void;
}

async function connectJsonl(endpoint: string): Promise<JsonlClient> {
  const socket = createConnection(endpoint);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.setEncoding("utf8");
  const closed = new Promise<void>((resolve) => socket.once("close", resolve));
  let buffered = "";
  const messages: unknown[] = [];
  const waiters: ((message: unknown) => void)[] = [];
  socket.on("data", (chunk: string) => {
    buffered += chunk;
    while (true) {
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line) as unknown;
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else messages.push(message);
    }
  });
  return {
    send(message) {
      socket.write(`${JSON.stringify(message)}\n`);
    },
    next() {
      const message = messages.shift();
      return message === undefined
        ? new Promise((resolve) => waiters.push(resolve))
        : Promise.resolve(message);
    },
    closed() {
      return closed;
    },
    close() {
      socket.destroy();
    },
  };
}
