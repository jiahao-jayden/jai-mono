# superagent-ai/grok-cli 的工具注册与长任务机制

核验日期：2026-09-27。固定 `superagent-ai/grok-cli` commit `fb97af83f06dca873281d60168430f06c8de6324`（`grok-dev` 1.1.7），避免后续提交混入结论。这里的“官方”仅指该项目自己的仓库；[README](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/README.md#L9-L11) 明确声明它是社区项目，并非 xAI 官方产品。以下是固定源码和测试的静态核验；未安装依赖、连接 MCP server 或执行模型请求。

## 结论

1. **不需要模型先搜索 MCP 工具。** 在 `agent` 模式且模型支持 client tools 时，主机先逐个连接已启用的 MCP server，调用 `client.tools()` 枚举工具，再把整份 ToolSet 交给模型；此处的“发现”不是 `SearchTools` 式模型调用。[MCP 枚举](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/mcp/runtime.ts#L49-L65) [主请求装配](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L1932-L1946)
2. **已枚举工具以可调用 schema 和执行函数进入请求。** 流式路径把 ToolSet 传给 `streamText`；batch 路径在循环前转换 schema，此后每轮都携带同一 `tools` 数组，并把上一轮 tool call/result 加入 `messages`。流式路径逐步发送的 wire payload 属于 AI SDK 内部，未实测。[流式请求](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L1942-L1952) [batch 请求](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L1653-L1663) [结果入历史](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L1734-L1743)
3. **长任务由不同机制处理，没有统一期限。** 前台 turn 有步骤上限和取消信号；前台 shell 默认 30 秒；batch 对每个请求做默认 10 分钟的退避轮询；后台 delegation 是 detached 子进程。10 分钟检查不会中断正在挂起的网络请求。[turn 控制](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L1942-L1952) [shell 分支](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/grok/tools.ts#L105-L117) [轮询](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/grok/batch.ts#L224-L234) [后台进程](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/delegations.ts#L106-L116)
4. **取消只覆盖已接线的路径。** `abort()` 触发当前 turn 的 signal；MCP 初始化没有应用层 signal/timeout 参数，后台 shell 和 delegation 不随 turn 取消；异常退出的 delegation 可能停在 `running`。SDK 内部超时、远端撤销以及实际进程树回收未验证。[turn 取消](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L770-L777) [MCP 建连](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/mcp/runtime.ts#L49-L63) [后台读取](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/delegations.ts#L149-L159)
5. **对本项目的借鉴是“已启用工具进入模型工具集合”，反例是全量枚举与后台任务的收尾边界。** Grok CLI 不提供搜索后激活或 opaque ref 的实现；本项目若保留 `SearchTools/ExecuteTool`，需要自行定义 operation 内已发现工具的激活、失效和授权规则，不能把对方按名称直接执行的方式当作现成替代。[全量枚举](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/mcp/runtime.ts#L35-L47) [按名称执行](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L974-L983)

## MCP 工具怎样进入模型

**主张：MCP 枚举发生在模型请求前。** 加载器按配置顺序遍历 server；禁用项跳过，校验失败只记录错误。[`src/mcp/runtime.ts#L35-L47`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/mcp/runtime.ts#L35-L47)

```ts
export async function buildMcpToolSet(servers: McpServerConfig[]): Promise<McpToolBundle> {
  const tools: ToolSet = {};
  const errors: string[] = [];
  const clients: MCPClient[] = [];

  for (const server of servers) {
    if (!server.enabled) continue;

    const validation = validateMcpServerConfig(server);
    if (!validation.ok) {
      errors.push(`${server.label}: ${validation.error}`);
      continue;
    }
```

**主张：`client.tools()` 给出可调用工具对象；本地保留对象内容，只加 server 前缀并改描述。** 没有查询词、模型发起的搜索调用或另一次按需取 schema。[`src/mcp/runtime.ts#L49-L65`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/mcp/runtime.ts#L49-L65)

```ts
      const client = await createMCPClient({
        transport: toTransport(server),
        name: `grok-cli-${server.id}`,
        version: "1.0.0",
      });
      clients.push(client);

      const mcpTools = await client.tools();
      const prefix = mcpToolPrefix(server);

      for (const [name, tool] of Object.entries(mcpTools)) {
        const prefixedName = `${prefix}__${name}`;
        tools[prefixedName] = {
          ...tool,
          description: `[MCP ${server.label}] ${tool.description ?? name}`,
        };
```

**主张：主 agent 只在 `agent` 模式、模型允许 client tools 时合并 MCP；失败 server 会产生提示，其余已加载工具仍进入 `streamText`。** 因此 ask/plan 中工具缺席不代表模型尚未搜索。[`src/agent/agent.ts#L1932-L1946`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L1932-L1946)

```ts
          let tools: ToolSet = runtime.modelInfo?.supportsClientTools === false ? {} : baseTools;
          if (this.mode === "agent" && runtime.modelInfo?.supportsClientTools !== false) {
            const mcpBundle = await buildMcpToolSet(loadMcpServers());
            closeMcp = mcpBundle.close;
            tools = { ...baseTools, ...mcpBundle.tools };
            if (mcpBundle.errors.length > 0) {
              yield { type: "content", content: `MCP unavailable: ${mcpBundle.errors.join(" | ")}\n\n` };
            }
          }

          const result = streamText({
            model: runtime.model,
            system,
            messages: this.messages,
            tools,
```

**主张：流式模型调用接收完整 ToolSet、步骤上限和取消信号。** 仓库在这里没有 `prepareStep` 或动态增补工具的代码；具体每一步的 provider payload 不能仅凭此处源码断言。[`src/agent/agent.ts#L1942-L1952`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L1942-L1952)

```ts
          const result = streamText({
            model: runtime.model,
            system,
            messages: this.messages,
            tools,
            stopWhen: stepCountIs(this.maxToolRounds),
            maxRetries: 0,
            abortSignal: signal,
            temperature: 0.7,
            ...(runtime.modelInfo?.supportsMaxOutputTokens === false ? {} : { maxOutputTokens: this.maxTokens }),
            ...(runtime.providerOptions ? { providerOptions: runtime.providerOptions } : {}),
```

**主张：batch 把工具集合先转换成 function schema，然后每轮请求都传同一 `batchTools`。** 这明确证明后续请求收到的是协议 `tools` 字段，而非只在聊天历史里看到工具说明。[`src/agent/agent.ts#L1653-L1663`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L1653-L1663)

```ts
                batch_request: {
                  chat_get_completion: buildBatchChatCompletionRequest({
                    modelId: runtime.modelId,
                    system,
                    messages: [...this.messages, ...turnMessages],
                    temperature: 0.7,
                    maxOutputTokens: runtime.modelInfo?.supportsMaxOutputTokens === false ? undefined : this.maxTokens,
                    reasoningEffort: runtime.providerOptions?.xai.reasoningEffort,
                    tools: batchTools,
                  }),
                },
```

**主张：工具结果追加到 `turnMessages`；下一轮由上段 `messages` 拼接再次送给模型。** 工具 schema 与执行结果走两条独立路径。[`src/agent/agent.ts#L1734-L1743`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L1734-L1743)

```ts
          const toolMessage = buildToolBatchMessage(toolParts);
          if (toolMessage) {
            turnMessages.push(toolMessage);
          }
          notifyObserver(observer?.onStepFinish, {
            stepNumber,
            timestamp: Date.now(),
            finishReason,
            usage,
          });
```

**主张：batch 按工具名在先前的 ToolSet 中执行，缺失时直接返回 unavailable。** 它没有遇到缺失工具后自动搜索或补注册的路径。[`src/agent/agent.ts#L974-L983`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L974-L983)

```ts
    const tool = tools[toolCall.function.name];
    if (!tool || tool.type === "provider" || typeof tool.execute !== "function") {
      return {
        input: parseToolArgumentsOrRaw(toolCall.function.arguments),
        result: {
          success: false,
          output: `Tool "${toolCall.function.name}" is unavailable in batch mode.`,
        },
      };
    }
```

## 两轮调用 trace

静态假设：用户在 `agent` 模式要求读取 PR 42，已启用 `github` MCP server，且 SDK 的 `client.tools()` 返回 `get_pull_request`。这不是实际运行记录。

| 步骤 | 工具集合 / 消息状态 | 已摘录的定位 |
|---|---|---|
| 1 | 主机连接 server 并枚举工具，注册 `mcp_github__get_pull_request`；模型尚未请求。 | [MCP 枚举](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/mcp/runtime.ts#L49-L65) |
| 2 | 合并 base + MCP ToolSet；流式请求直接传 `tools`。沿 batch 路径继续看显式轮次。 | [主请求](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L1932-L1946) |
| 3 | 首轮请求已有该工具的 function schema。假设模型返回调用 ID `c1`。 | [batch 请求](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L1653-L1663) |
| 4 | 主机按工具名执行，将 `c1` 的结果追加到 `turnMessages`。 | [执行绑定](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L974-L983) [结果追加](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L1734-L1743) |
| 5 | 下一轮继续带相同 `batchTools`，`messages` 又包含上轮调用与结果；无需重做模型级工具搜索。 | [batch 请求](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L1653-L1663) |

## 长任务、轮询与取消

**主张：前台 turn 的 `abort()` 只触发当前 controller；cleanup 处理 Bash 与 LSP。** `stepCountIs` 是步骤上限，不是墙钟期限，取消也不回滚已完成的外部副作用。[`src/agent/agent.ts#L770-L777`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/agent.ts#L770-L777)

```ts
  abort(): void {
    this.abortController?.abort();
    this.emitSubagentStatus(null);
  }

  async cleanup(): Promise<void> {
    await Promise.allSettled([this.bash.cleanup(), shutdownWorkspaceLspManager(this.bash.getCwd())]);
  }
```

**主张：前台 bash 使用调用方 timeout（默认 30,000 ms）；后台 bash 直接走 `startBackground`，没有传入 timeout 或 turn signal。** [`src/grok/tools.ts#L105-L117`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/grok/tools.ts#L105-L117)

```ts
      execute: async ({ command, timeout, background }, { abortSignal }) => {
        const toolInput = { command, timeout, background };
        const preResult = await executePreToolHooks("bash", toolInput, cwd(), options.sessionId, abortSignal);
        if (preResult.blocked) {
          const reason = preResult.blockingErrors.map((e) => e.stderr).join("; ") || "Blocked by hook";
          return { success: false, output: `[Hook blocked] ${reason}` };
        }

        if (background) {
          return bash.startBackground(command);
        }

        const result = await bash.execute(command, timeout, abortSignal);
```

**主张：前台 bash 的默认 timeout 是 30 秒；收到取消时先 SIGTERM，1 秒后尝试 SIGKILL。** 信号发送给直接 child，跨平台进程树效果未实测。[`src/tools/bash.ts#L53-L57`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/tools/bash.ts#L53-L57) [`src/tools/bash.ts#L142-L157`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/tools/bash.ts#L142-L157)

```ts
        const onAbort = () => {
          aborted = true;
          try {
            child.kill("SIGTERM");
          } catch {
            finish({ success: false, error: "[Cancelled]" });
            return;
          }

          forceKillTimer = setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {
              /* already exited */
            }
          }, 1_000);
```

**主张：batch 的默认值为 2 秒起步、30 秒最大间隔、每请求 10 分钟。** [`src/grok/batch.ts#L3-L8`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/grok/batch.ts#L3-L8)

```ts
const DEFAULT_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_INITIAL_POLL_MS = 2_000;
const DEFAULT_MAX_POLL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_BATCH_PAGE_SIZE = 100;
const DEFAULT_RATE_LIMIT_RETRIES = 5;
```

**主张：轮询只有在 `getBatchStatus` 返回后才检查 10 分钟期限，再以 1.5 倍退避等待。** 因此它是循环检查期限，不是独立截止器。[`src/grok/batch.ts#L224-L234`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/grok/batch.ts#L224-L234)

```ts
    await getBatchStatus(options);

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(
        `Timed out waiting for batch request "${options.batchRequestId}" in batch "${options.batchId}" after ${Math.round(timeoutMs / 1000)}s.`,
      );
    }

    await sleep(delayMs, options.signal);
    delayMs = Math.min(Math.round(delayMs * 1.5), maxPollMs);
  }
```

**主张：网络 fetch 只收到调用方传入的 signal，没有从 `timeoutMs` 派生单次请求的截止信号。** 静态推断：挂起的 fetch 可以让上述期限检查迟迟无法运行。[`src/grok/batch.ts#L310-L324`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/grok/batch.ts#L310-L324)

```ts
  while (true) {
    throwIfAborted(options.signal);

    const response = await fetch(url, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });

    if (response.ok) {
```

**主张：后台 delegation 写入 `running` 记录后启动 detached、unref 的子进程。** 父 turn 取消没有传给这个子进程；这是后台继续运行的机制，也是清理与恢复边界。[`src/agent/delegations.ts#L106-L116`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/delegations.ts#L106-L116)

```ts
      {
        cwd,
        detached: true,
        stdio: "ignore",
        env: { ...process.env, GROK_BACKGROUND_CHILD: "1" },
      },
    );
    child.unref();

    record.pid = child.pid;
    await writeRecord(jobPath, record);
```

**主张：`delegation_read` 遇到 `running` 只返回 still running，没有在此检查 pid 或年龄。** 静态推断：子进程意外死亡且未写终态时，记录可能长期残留。[`src/agent/delegations.ts#L149-L159`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/delegations.ts#L149-L159)

```ts
  async read(id: string): Promise<string> {
    const record = await this.getById(id);
    if (!record) {
      return `Delegation "${id}" not found. Use \`delegation_list()\` to see available results.`;
    }

    if (record.status === "running") {
      return `Delegation "${id}" is still running. Continue working and wait for the completion notice.`;
    }

    try {
```

## 失败模式与证据边界

| 场景 | 固定 SHA 下可见的行为 | 判断边界 |
|---|---|---|
| MCP 连接/枚举失败 | 对单台 server 收集错误，继续其他 server，最后关闭已登记客户端。 | [源码与摘录](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/mcp/runtime.ts#L67-L79)；SDK 内部 timeout 未查。 |
| MCP 枚举卡住 | `createMCPClient` 与 `client.tools()` 在串行循环中 await。 | [源码与摘录](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/mcp/runtime.ts#L49-L65)；“会卡住”是 SDK 不返回时的条件推断。 |
| batch 超时 | `getBatchStatus` 返回后才检查期限；fetch 收到外部 signal。 | [轮询](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/grok/batch.ts#L224-L234) [fetch](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/grok/batch.ts#L310-L324)；远端 batch 撤销未证实。 |
| delegation 意外死亡 | `read()` 仅看记录状态；未见运行态超时/存活修复。 | [读取](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/agent/delegations.ts#L149-L159)；未做故障注入。 |
| 工具名碰撞 | MCP 前缀归一化后直接赋值到 `tools[prefixedName]`。 | [注册](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/mcp/runtime.ts#L55-L65)；碰撞覆盖是源码推断，未实测。 |

**主张：MCP 失败是按 server 收集，`close()` 并行关闭已成功创建的 client；关闭异常被忽略。** 应用层没有在这条路径设置独立 close deadline。[`src/mcp/runtime.ts#L67-L79`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/mcp/runtime.ts#L67-L79)

```ts
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${server.label}: ${message}`);
    }
  }

  return {
    tools,
    errors,
    async close() {
      await Promise.all(clients.map((client) => client.close().catch(() => {})));
    },
  };
```

**主张：batch 测试覆盖暂时不可见结果最终可见，但将轮询间隔设为 0。** 测试源码不能证明真实计时、网络取消或后台进程回收。[`src/grok/batch.test.ts#L101-L112`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/grok/batch.test.ts#L101-L112)

```ts
    const result = await pollBatchRequestResult({
      apiKey: "test-key",
      batchId: "batch-1",
      batchRequestId: "req-3",
      initialPollMs: 0,
      maxPollMs: 0,
      timeoutMs: 1000,
    });

    expect(result.batch_result?.response?.chat_get_completion?.choices[0]?.message.content).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
```

**主张：README 的 MCP 配置提示与指定 SHA 的实际加载器不一致。** 文档说 `.grok/settings.json` 的 `mcpServers`，加载器实际读用户设置的 `mcp.servers`；因此文档本身不能替代代码验证。[`README.md#L182-L188`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/README.md#L182-L188) [`src/utils/settings.ts#L647-L653`](https://github.com/superagent-ai/grok-cli/blob/fb97af83f06dca873281d60168430f06c8de6324/src/utils/settings.ts#L647-L653)

```ts
export function loadMcpServers(): McpServerConfig[] {
  return loadUserSettings().mcp?.servers ?? [];
}

export function saveMcpServers(servers: McpServerConfig[]): void {
  saveUserSettings({ mcp: { servers } });
}
```

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | `superagent-ai/grok-cli` README、CHANGELOG、MCP runtime、agent loop、batch、shell、delegation 及相关测试，均固定在 `fb97af83f06dca873281d60168430f06c8de6324`；未运行程序或测试。 |
| 作者或维护者本人的说法 | 仓库 PR [#259](https://github.com/superagent-ai/grok-cli/pull/259) 的作者说明 stdio stderr 污染 TUI；其修复见固定 SHA 的 `src/mcp/runtime.ts`，此说明只用于解释动机，不支撑发现算法结论。 |
| 同类方案 | 未查：用户严格限定只查指定仓库；本项目 `SearchTools/ExecuteTool` 只作授权的本地设计对照，不冒充第二个外部方案。 |
| issue / PR / 社区实践 | 查阅指定仓库 PR #259（已合并）和 #334（核验时未合并）；后者提示 README 配置漂移，现状以固定 SHA 的 README 与加载器核实。未据 PR 状态推断未审代码已生效。 |
| 历史演变 | 固定 SHA 的 CHANGELOG 将 MCP stderr 修复记于 1.1.5-rc5；`package.json` 为 1.1.7，但 CHANGELOG 顶部未跟齐，因此未把它当完整发布史。 |

## 对本项目的影响

本项目现有 `SearchTools/ExecuteTool` 契约明确要求精确 `toolRef`；测试断言 catalog 更新后旧 ref 失效、scope 过滤仍有效。对方按名称调用已枚举工具的实现没有提供相同的 operation 能力与失效语义。见本地 [`tool-catalog.ts`](/Users/jayden/code/jai-mono/packages/coding-agent/src/runtime/tool-catalog.ts:14) 和 [`tool-catalog.test.ts`](/Users/jayden/code/jai-mono/packages/coding-agent/test/tool-catalog.test.ts:47)。

可借鉴的机制是：一旦决定激活工具，把它的真实调用 schema 放进后续模型请求的工具集合，而不只把名称/说明留在搜索结果文字里。若采用按需激活，这需要本项目自己确定 operation 级 snapshot、授权检查、catalog 更新后的失效与下一轮生效点；这是设计建议，并非 Grok CLI 已实现的搜索后加载协议。不能直接照搬它每次构建 turn 时全量枚举所有 MCP server：源码显示串行 await，应用层没有显式的枚举取消/期限，名字归一化后还存在覆盖风险。

长任务方面，保留前台取消与步骤/时间预算的区别。batch 的退避和按请求期限可借鉴为等待器的一部分，但需要把期限传到每次网络调用；后台任务若要持久可靠，还需终态恢复、存活检查和明确取消通道。Grok CLI 的静态源码没有证明这些边界已闭合，不应把 `running` 或本地 abort 当作远端停止的确认。
