import { describe, expect, test } from "bun:test";
import { zeroUsage } from "@jai/ai";
import { recoverOperation } from "@jai/agent";
import { Result } from "better-result";
import {
  type RuntimeOperation,
  type RuntimeOperationDriver,
  RuntimeOperationExecutionFailed,
  RuntimeOperationOpenFailed,
  type RuntimeOperationOpenInput,
} from "../../src/operations";
import {
  InMemoryProductSessionPersistence,
  RuntimeSessionConfigurationInvalid,
  type RuntimeSessionConfigurationPolicy,
} from "../../src/sessions";
import { createRuntimeHost } from "../../src/runtime";

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `id-${index}`;
}

describe("RuntimeHost", () => {
  test("durably accepts a prompt before it returns to the caller", async () => {
    const persistence = new InMemoryProductSessionPersistence();
    const host = createRuntimeHost({
      persistence,
      createId: ids("session-1", "operation-1"),
    });
    const opened = await host.openSession({ kind: "new" });
    if (opened.isErr()) throw opened.error;

    const admission = await opened.value.prompt({ text: "write a test" });
    if (admission.isErr()) throw admission.error;
    expect(admission.value).toEqual({
      operationId: "operation-1",
      inputEntryId: "operation-1:input",
    });

    const durable = await persistence.load("session-1");
    if (durable.isErr()) throw durable.error;
    expect(durable.value.snapshot.entries).toMatchObject([
      {
        type: "message",
        id: "operation-1:input",
        message: { role: "user", content: "write a test" },
      },
    ]);
    expect(durable.value.operationRecords).toMatchObject([
      {
        type: "operation_accepted",
        operationId: "operation-1",
        inputEntryId: "operation-1:input",
      },
    ]);

    const recovery = recoverOperation(durable.value.operationRecords, {
      sessionEntryIds: new Set(
        durable.value.snapshot.entries.map((entry) => entry.id),
      ),
      terminalOutcomeByAssistantEntryId: new Map(),
    });
    if (recovery.isErr()) throw recovery.error;
    expect(recovery.value).toEqual({
      status: "ready",
      operationId: "operation-1",
    });
  });

  test("resumes an existing durable Session without creating another one", async () => {
    const persistence = new InMemoryProductSessionPersistence();
    const firstHost = createRuntimeHost({
      persistence,
      createId: ids("session-1", "operation-1"),
    });
    const created = await firstHost.openSession({ kind: "new" });
    if (created.isErr()) throw created.error;
    await created.value.prompt({ text: "first" });

    const secondHost = createRuntimeHost({
      persistence,
      createId: ids("unused"),
    });
    const resumed = await secondHost.openSession({
      kind: "resume",
      id: "session-1",
    });
    if (resumed.isErr()) throw resumed.error;
    expect(resumed.value.id).toBe("session-1");

    const sessions = await secondHost.listSessions();
    if (sessions.isErr()) throw sessions.error;
    expect(sessions.value.map((session) => session.id)).toEqual(["session-1"]);
  });

  test("runs a connection-scoped Session without writing it to the durable catalog", async () => {
    const durablePersistence = new InMemoryProductSessionPersistence();
    const driver = new ControlledOperationDriver();
    const host = createRuntimeHost({
      persistence: durablePersistence,
      createEphemeralPersistence: () => new InMemoryProductSessionPersistence(),
      operationDriver: driver,
      createId: ids("ephemeral-1", "operation-1"),
    });
    const opened = await host.openSession({
      kind: "new",
      cwd: "/workspace",
      ephemeral: true,
    });
    if (opened.isErr()) throw opened.error;

    const admitted = await opened.value.prompt({ text: "do not retain this" });
    if (admitted.isErr()) throw admitted.error;
    await driver.opened;
    const running = await opened.value.snapshot();
    if (running.isErr()) throw running.error;
    expect(running.value.state).toBe("running");

    const durable = await durablePersistence.load("ephemeral-1");
    expect(durable.isErr()).toBe(true);
    const listed = await host.listSessions();
    if (listed.isErr()) throw listed.error;
    expect(listed.value).toEqual([]);

    await opened.value.close();
    await driver.closed;
    expect(driver.abortCalls).toBe(1);

    const resumed = await host.openSession({
      kind: "resume",
      id: "ephemeral-1",
      cwd: "/workspace",
    });
    expect(resumed.isErr()).toBe(true);
    if (resumed.isOk())
      throw new Error(
        "Expected a closed ephemeral Session to be unavailable for resume",
      );
    expect(resumed.error._tag).toBe("runtime_host.session_not_found");
  });

  test("returns a typed failure when asked to resume a missing Session", async () => {
    const host = createRuntimeHost({
      persistence: new InMemoryProductSessionPersistence(),
    });
    const resumed = await host.openSession({ kind: "resume", id: "missing" });

    expect(resumed.isErr()).toBe(true);
    if (resumed.isOk()) throw new Error("Expected a missing Session result");
    expect(resumed.error._tag).toBe("runtime_host.session_not_found");
  });

  test("serializes concurrent prompt admissions on one Session", async () => {
    const persistence = new InMemoryProductSessionPersistence();
    const host = createRuntimeHost({
      persistence,
      createId: ids("session-1", "operation-1", "operation-2"),
    });
    const opened = await host.openSession({ kind: "new", cwd: "/workspace" });
    if (opened.isErr()) throw opened.error;

    const [first, second] = await Promise.all([
      opened.value.prompt({ text: "first" }),
      opened.value.prompt({ text: "second" }),
    ]);

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    const loaded = await persistence.load("session-1");
    if (loaded.isErr()) throw loaded.error;
    expect(loaded.value.snapshot.entries.map((entry) => entry.id)).toEqual([
      "operation-1:input",
      "operation-2:input",
    ]);
    expect(
      loaded.value.snapshot.entries.map((entry) => entry.parentId),
    ).toEqual([null, "operation-1:input"]);
  });

  test("rejects an unconfigured runtime before admitting a prompt", async () => {
    const persistence = new InMemoryProductSessionPersistence();
    const driver: RuntimeOperationDriver = {
      async preflight(input) {
        return Result.err(
          new RuntimeOperationOpenFailed({
            message: "Runtime configuration is incomplete",
            sessionId: input.sessionId,
            operationId: input.operationId,
          }),
        );
      },
      async openOperation(input) {
        return Result.err(
          new RuntimeOperationOpenFailed({
            message: "Preflight should reject before an Operation is opened",
            sessionId: input.sessionId,
            operationId: input.operationId,
          }),
        );
      },
    };
    const host = createRuntimeHost({
      persistence,
      operationDriver: driver,
      createId: ids("session-1", "operation-1"),
    });
    const opened = await host.openSession({ kind: "new" });
    if (opened.isErr()) throw opened.error;

    const rejected = await opened.value.prompt({
      text: "run without a configured Provider",
    });
    expect(rejected.isErr()).toBe(true);
    if (rejected.isOk())
      throw new Error("Expected configuration preflight to reject the prompt");
    expect(rejected.error._tag).toBe("runtime_host.prompt_rejected");

    const durable = await persistence.load("session-1");
    if (durable.isErr()) throw durable.error;
    expect(durable.value.snapshot.entries).toEqual([]);
    expect(durable.value.operationRecords).toEqual([]);
  });

  test("cancellation becomes a durable aborted terminal outcome", async () => {
    const persistence = new InMemoryProductSessionPersistence();
    const host = createRuntimeHost({
      persistence,
      createId: ids("session-1", "operation-1"),
      now: () => new Date("2026-08-25T12:00:00.000Z"),
    });
    const opened = await host.openSession({ kind: "new" });
    if (opened.isErr()) throw opened.error;
    const prompted = await opened.value.prompt({ text: "cancel me" });
    if (prompted.isErr()) throw prompted.error;

    const cancelled = await opened.value.cancel();
    if (cancelled.isErr()) throw cancelled.error;
    expect(cancelled.value).toEqual({
      cancelled: true,
      operationId: "operation-1",
    });

    const recovery = await opened.value.recovery();
    if (recovery.isErr()) throw recovery.error;
    expect(recovery.value).toEqual([
      {
        status: "terminal",
        operationId: "operation-1",
        outcome: "aborted",
        finalization: "durable",
      },
    ]);
  });

  test("finalizes a durable final assistant result during recovery without reopening a driver", async () => {
    const persistence = new InMemoryProductSessionPersistence();
    const firstHost = createRuntimeHost({
      persistence,
      createId: ids("session-1", "operation-1"),
    });
    const created = await firstHost.openSession({
      kind: "new",
      cwd: "/workspace",
    });
    if (created.isErr()) throw created.error;
    const admitted = await created.value.prompt({
      text: "finish before the crash",
    });
    if (admitted.isErr()) throw admitted.error;

    const attempted = await persistence.appendOperation({
      sessionId: "session-1",
      record: {
        type: "model_attempted",
        operationId: "operation-1",
        attemptId: "attempt-1",
        assistantEntryId: "assistant-1",
        modelSnapshotId: "test:model",
        timestamp: "2026-08-26T00:00:01.000Z",
      },
    });
    if (attempted.isErr()) throw attempted.error;
    const beforeAssistant = await persistence.load("session-1");
    if (beforeAssistant.isErr()) throw beforeAssistant.error;
    const appendedAssistant = await persistence.appendEntry({
      sessionId: "session-1",
      expectedRevision: beforeAssistant.value.revision,
      entry: {
        type: "message",
        id: "assistant-1",
        parentId: "operation-1:input",
        timestamp: "2026-08-26T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          provider: "test",
          model: "test-model",
          usage: zeroUsage(),
          stopReason: "stop",
          timestamp: 0,
        },
      },
    });
    if (appendedAssistant.isErr()) throw appendedAssistant.error;

    let openedDrivers = 0;
    const driver: RuntimeOperationDriver = {
      async openOperation(input) {
        openedDrivers += 1;
        return Result.err(
          new RuntimeOperationOpenFailed({
            message: "A terminal recovery must not reopen its driver",
            sessionId: input.sessionId,
            operationId: input.operationId,
          }),
        );
      },
    };
    const recoveredHost = createRuntimeHost({
      persistence,
      operationDriver: driver,
      now: () => new Date("2026-08-26T00:01:00.000Z"),
    });
    const resumed = await recoveredHost.openSession({
      kind: "resume",
      id: "session-1",
      cwd: "/workspace",
    });
    if (resumed.isErr()) throw resumed.error;
    expect(openedDrivers).toBe(0);
    const snapshot = await resumed.value.snapshot();
    if (snapshot.isErr()) throw snapshot.error;
    expect(snapshot.value).toMatchObject({
      state: "idle",
      stopReason: "end_turn",
    });
    await resumed.value.close();

    const durable = await persistence.load("session-1");
    if (durable.isErr()) throw durable.error;
    expect(
      durable.value.operationRecords.filter(
        (record) => record.type === "operation_finished",
      ),
    ).toMatchObject([{ operationId: "operation-1", outcome: "completed" }]);

    const reopened = await recoveredHost.openSession({
      kind: "resume",
      id: "session-1",
      cwd: "/workspace",
    });
    if (reopened.isErr()) throw reopened.error;
    await reopened.value.close();
    const afterSecondResume = await persistence.load("session-1");
    if (afterSecondResume.isErr()) throw afterSecondResume.error;
    expect(
      afterSecondResume.value.operationRecords.filter(
        (record) => record.type === "operation_finished",
      ),
    ).toHaveLength(1);
  });

  test("allows only one ephemeral Session Controller at a time", async () => {
    const host = createRuntimeHost({
      persistence: new InMemoryProductSessionPersistence(),
      createId: ids("session-1"),
    });
    const first = await host.openSession({
      kind: "new",
      controllerId: "connection-1",
    });
    if (first.isErr()) throw first.error;

    const blocked = await host.openSession({
      kind: "resume",
      id: "session-1",
      controllerId: "connection-2",
    });
    expect(blocked.isErr()).toBe(true);
    if (blocked.isOk())
      throw new Error("Expected the Session Controller lease to be held");
    expect(blocked.error._tag).toBe("runtime_host.session_controller_held");

    await first.value.close();
    const resumed = await host.openSession({
      kind: "resume",
      id: "session-1",
      controllerId: "connection-2",
    });
    expect(resumed.isOk()).toBe(true);
  });

  test("reattaches a reconnecting Controller to its one live Operation driver", async () => {
    const driver = new ControlledOperationDriver();
    const persistence = new InMemoryProductSessionPersistence();
    const host = createRuntimeHost({
      persistence,
      operationDriver: driver,
      createId: ids("session-1", "operation-1"),
    });
    const first = await host.openSession({
      kind: "new",
      cwd: "/workspace",
      controllerId: "connection-1",
    });
    if (first.isErr()) throw first.error;
    const admitted = await first.value.prompt({
      text: "keep running through reconnect",
    });
    if (admitted.isErr()) throw admitted.error;
    await driver.opened;

    await first.value.close();
    const reattached = await host.openSession({
      kind: "resume",
      id: "session-1",
      cwd: "/workspace",
      controllerId: "connection-2",
    });
    if (reattached.isErr()) throw reattached.error;
    expect(reattached.value).toBe(first.value);
    const running = await reattached.value.snapshot();
    if (running.isErr()) throw running.error;
    expect(running.value.state).toBe("running");
    expect(driver.openCalls).toBe(1);

    const cancelled = await reattached.value.cancel();
    if (cancelled.isErr()) throw cancelled.error;
    expect(cancelled.value).toEqual({
      cancelled: true,
      operationId: "operation-1",
    });
    await driver.closed;

    const durable = await persistence.load("session-1");
    if (durable.isErr()) throw durable.error;
    expect(
      durable.value.operationRecords.filter(
        (record) => record.type === "operation_finished",
      ),
    ).toHaveLength(1);

    await reattached.value.close();
    const reopened = await host.openSession({
      kind: "resume",
      id: "session-1",
      cwd: "/workspace",
      controllerId: "connection-3",
    });
    if (reopened.isErr()) throw reopened.error;
    expect(reopened.value).not.toBe(first.value);
    await reopened.value.close();
  });

  test("starts an admitted operation in the Server then durably finishes it", async () => {
    const driver = new ControlledOperationDriver();
    const persistence = new InMemoryProductSessionPersistence();
    const host = createRuntimeHost({
      persistence,
      operationDriver: driver,
      createId: ids("session-1", "operation-1", "attempt-1", "assistant-1"),
    });
    const opened = await host.openSession({ kind: "new", cwd: "/workspace" });
    if (opened.isErr()) throw opened.error;

    const admission = await opened.value.prompt({ text: "run this" });
    if (admission.isErr()) throw admission.error;
    const input = await driver.opened;
    expect(input).toMatchObject({
      sessionId: "session-1",
      cwd: "/workspace",
      operationId: "operation-1",
    });

    driver.finish("completed");
    await driver.closed;
    const durable = await persistence.load("session-1");
    if (durable.isErr()) throw durable.error;
    expect(durable.value.operationRecords.at(-1)).toMatchObject({
      type: "operation_finished",
      operationId: "operation-1",
      outcome: "completed",
    });
  });

  test("turns a second active prompt into a durable steer input for the current operation", async () => {
    const driver = new ControlledOperationDriver();
    const persistence = new InMemoryProductSessionPersistence();
    const host = createRuntimeHost({
      persistence,
      operationDriver: driver,
      createId: ids("session-1", "operation-1", "input-1", "entry-steer-1"),
    });
    const opened = await host.openSession({ kind: "new", cwd: "/workspace" });
    if (opened.isErr()) throw opened.error;
    const first = await opened.value.prompt({ text: "start" });
    if (first.isErr()) throw first.error;
    await driver.opened;
    await Promise.resolve();

    const steering = await opened.value.prompt({ text: "change direction" });
    if (steering.isErr()) throw steering.error;
    expect(steering.value).toEqual({
      operationId: "operation-1",
      inputEntryId: "entry-steer-1",
    });
    expect(driver.queuedInputs).toEqual([
      {
        inputId: "input-1",
        delivery: "steer",
        entryId: "entry-steer-1",
        text: "change direction",
      },
    ]);

    const durable = await persistence.load("session-1");
    if (durable.isErr()) throw durable.error;
    expect(durable.value.snapshot.entries.map((entry) => entry.id)).toEqual([
      "operation-1:input",
    ]);
    expect(durable.value.operationRecords.at(-1)).toMatchObject({
      type: "input_queued",
      operationId: "operation-1",
      inputEntryId: "entry-steer-1",
    });
  });

  test("never writes a terminal outcome while a durable steer input lacks its Session entry", async () => {
    const driver = new ControlledOperationDriver();
    const persistence = new InMemoryProductSessionPersistence();
    const host = createRuntimeHost({
      persistence,
      operationDriver: driver,
      createId: ids("session-1", "operation-1", "input-1", "entry-steer-1"),
    });
    const opened = await host.openSession({ kind: "new", cwd: "/workspace" });
    if (opened.isErr()) throw opened.error;

    const first = await opened.value.prompt({ text: "start" });
    if (first.isErr()) throw first.error;
    await driver.opened;
    const steering = await opened.value.prompt({ text: "change direction" });
    if (steering.isErr()) throw steering.error;

    driver.finish("completed");
    await driver.closed;

    const durable = await persistence.load("session-1");
    if (durable.isErr()) throw durable.error;
    expect(
      durable.value.operationRecords.filter(
        (record) => record.type === "operation_finished",
      ),
    ).toEqual([]);
    const recovery = recoverOperation(durable.value.operationRecords, {
      sessionEntryIds: new Set(
        durable.value.snapshot.entries.map((entry) => entry.id),
      ),
      terminalOutcomeByAssistantEntryId: new Map(),
    });
    if (recovery.isErr()) throw recovery.error;
    expect(recovery.value).toEqual({
      status: "ready",
      operationId: "operation-1",
      pendingInputs: [
        {
          inputId: "input-1",
          delivery: "steer",
          inputEntryId: "entry-steer-1",
          text: "change direction",
        },
      ],
    });

    const snapshot = await opened.value.snapshot();
    if (snapshot.isErr()) throw snapshot.error;
    expect(snapshot.value.state).toBe("requires_action");

    const next = await opened.value.prompt({
      text: "do not append another T1",
    });
    expect(next).toMatchObject({
      status: "error",
      error: { _tag: "runtime_host.session_busy" },
    });
    const afterRejectedPrompt = await persistence.load("session-1");
    if (afterRejectedPrompt.isErr()) throw afterRejectedPrompt.error;
    expect(afterRejectedPrompt.value.operationRecords).toHaveLength(
      durable.value.operationRecords.length,
    );
  });

  test("freezes the durable Session configuration at prompt admission while later changes apply only to later work", async () => {
    const driver = new ControlledOperationDriver();
    const persistence = new InMemoryProductSessionPersistence();
    const host = createRuntimeHost({
      persistence,
      operationDriver: driver,
      configurationPolicy: configuredSessionPolicy(),
      createId: ids("session-1", "operation-1"),
    });
    const opened = await host.openSession({ kind: "new", cwd: "/workspace" });
    if (opened.isErr()) throw opened.error;

    const admitted = await opened.value.prompt({
      text: "use the initial model",
    });
    if (admitted.isErr()) throw admitted.error;
    const changed = await opened.value.setConfiguration({
      configId: "model",
      value: "profile/model-b",
    });
    if (changed.isErr()) throw changed.error;
    const runtimeInput = await driver.opened;
    expect(runtimeInput.runtimeConfiguration).toEqual({
      model: "profile/model-a",
      mode: "manual",
    });

    const durable = await persistence.load("session-1");
    if (durable.isErr()) throw durable.error;
    expect(durable.value.runtimeConfiguration).toEqual({
      model: "profile/model-b",
      mode: "manual",
    });
    expect(durable.value.operationRuntimeConfigurations).toEqual([
      {
        operationId: "operation-1",
        configuration: { model: "profile/model-a", mode: "manual" },
      },
    ]);

    driver.finish("completed");
    await driver.closed;
  });

  test("publishes a configuration projection only after its configuration fact is durable", async () => {
    const persistence = new InMemoryProductSessionPersistence();
    const host = createRuntimeHost({
      persistence,
      configurationPolicy: configuredSessionPolicy(),
      createId: ids("session-1"),
    });
    const opened = await host.openSession({ kind: "new" });
    if (opened.isErr()) throw opened.error;
    const events: unknown[] = [];
    const unsubscribe = opened.value.subscribe((event) => events.push(event));
    try {
      const changed = await opened.value.setConfiguration({
        configId: "mode",
        value: "plan",
      });
      if (changed.isErr()) throw changed.error;
      expect(changed.value.configuration).toEqual({
        model: "profile/model-a",
        mode: "plan",
      });
      expect(events).toEqual([
        {
          type: "configuration_changed",
          configuration: {
            configuration: { model: "profile/model-a", mode: "plan" },
            models: [
              { value: "profile/model-a", name: "Model A" },
              { value: "profile/model-b", name: "Model B" },
            ],
          },
        },
      ]);
    } finally {
      unsubscribe();
    }
  });

  test("waits for the live driver to stop before recording a durable abort", async () => {
    const driver = new ControlledOperationDriver();
    const persistence = new InMemoryProductSessionPersistence();
    const host = createRuntimeHost({
      persistence,
      operationDriver: driver,
      createId: ids("session-1", "operation-1"),
    });
    const opened = await host.openSession({ kind: "new" });
    if (opened.isErr()) throw opened.error;
    const admission = await opened.value.prompt({
      text: "cancel live operation",
    });
    if (admission.isErr()) throw admission.error;
    await driver.opened;

    const cancelled = await opened.value.cancel();
    if (cancelled.isErr()) throw cancelled.error;
    expect(cancelled.value).toEqual({
      cancelled: true,
      operationId: "operation-1",
    });
    expect(driver.abortCalls).toBe(1);
    const durable = await persistence.load("session-1");
    if (durable.isErr()) throw durable.error;
    expect(durable.value.operationRecords.at(-1)).toMatchObject({
      type: "operation_finished",
      operationId: "operation-1",
      outcome: "aborted",
    });
  });

  test("projects a pending approval as requires_action, then resumes after one approved decision", async () => {
    const driver = new ControlledOperationDriver();
    const host = createRuntimeHost({
      persistence: new InMemoryProductSessionPersistence(),
      operationDriver: driver,
      createId: ids("session-1", "operation-1"),
    });
    const opened = await host.openSession({ kind: "new", cwd: "/workspace" });
    if (opened.isErr()) throw opened.error;
    const events: unknown[] = [];
    const unsubscribe = opened.value.subscribe((event) => events.push(event));
    try {
      const prompted = await opened.value.prompt({ text: "ask first" });
      if (prompted.isErr()) throw prompted.error;
      const input = await driver.opened;
      const decision = input.requestApproval({
        requestId: "approval-1",
        sessionId: "session-1",
        operationId: "operation-1",
        toolCallId: "tool-1",
        toolName: "Bash",
        title: "Bash requests permission",
        canAlwaysAllow: true,
      });

      const waiting = await opened.value.snapshot();
      if (waiting.isErr()) throw waiting.error;
      expect(waiting.value.state).toBe("requires_action");
      expect(events.slice(-2)).toMatchObject([
        {
          type: "approval_requested",
          request: { requestId: "approval-1", toolName: "Bash" },
        },
        {
          type: "state_changed",
          state: "requires_action",
          operationId: "operation-1",
        },
      ]);

      const resolved = await opened.value.respondToApproval({
        requestId: "approval-1",
        decision: "allowOnce",
      });
      if (resolved.isErr()) throw resolved.error;
      expect(await decision).toBe("allowOnce");
      const running = await opened.value.snapshot();
      if (running.isErr()) throw running.error;
      expect(running.value.state).toBe("running");
    } finally {
      unsubscribe();
      driver.finish("completed");
      await driver.closed;
    }
  });
});

function configuredSessionPolicy(): RuntimeSessionConfigurationPolicy {
  const models = [
    { value: "profile/model-a", name: "Model A" },
    { value: "profile/model-b", name: "Model B" },
  ] as const;
  return {
    async initialConfiguration() {
      return Result.ok({ model: "profile/model-a", mode: "manual" });
    },
    async listModels() {
      return Result.ok(models);
    },
    async validateModel(model) {
      return models.some((candidate) => candidate.value === model)
        ? Result.ok(undefined)
        : Result.err(
            new RuntimeSessionConfigurationInvalid({
              message: `Unknown model ${model}`,
            }),
          );
    },
  };
}

class ControlledOperationDriver implements RuntimeOperationDriver {
  readonly opened: Promise<RuntimeOperationOpenInput>;
  readonly closed: Promise<void>;
  abortCalls = 0;
  openCalls = 0;
  queuedInputs: Array<{
    readonly inputId: string;
    readonly delivery: "steer" | "follow_up";
    readonly entryId: string;
    readonly text: string;
  }> = [];
  #resolveOpened!: (input: RuntimeOperationOpenInput) => void;
  #resolveClosed!: () => void;
  #resolveOutcome!: (outcome: "completed" | "failed" | "aborted") => void;
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
    this.#resolveOpened(input);
    return Result.ok<RuntimeOperation, never>({
      abort: async () => {
        this.abortCalls += 1;
        this.finish("aborted");
        return Result.ok<void, RuntimeOperationExecutionFailed>(undefined);
      },
      enqueueInput: async (queued) => {
        this.queuedInputs.push(queued);
        return Result.ok<void, RuntimeOperationExecutionFailed>(undefined);
      },
      awaitOutcome: async () => Result.ok(await this.#outcome),
      close: async () => {
        this.#resolveClosed();
      },
    });
  }

  finish(outcome: "completed" | "failed" | "aborted"): void {
    this.#resolveOutcome(outcome);
  }
}
