# Google Gemini CLI：Agent UI 事件、时间线与持久化证据

核验日期：2026-09-10。源码固定在 Google 官方仓库提交 [`ed2ac40df67a319bf348bd7e3d10494696b31b38`](https://github.com/google-gemini/gemini-cli/commit/ed2ac40df67a319bf348bd7e3d10494696b31b38)，避免 `main` 后续变动混入结论；该提交根包版本为 `0.61.0-nightly.20260908.gc647533d6`。

## 发现

### 1. Subagent 的可观测事件模型只有四类：工具开始、工具结束、thought chunk、错误；它们随后被投影为 `thought` 或 `tool_call` 活动项。

来源：[`packages/core/src/agents/types.ts#L84-L105`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/agents/types.ts#L84-L105)

```ts
export interface SubagentActivityEvent {
  isSubagentActivityEvent: true;
  agentName: string;
  type: 'TOOL_CALL_START' | 'TOOL_CALL_END' | 'THOUGHT_CHUNK' | 'ERROR';
  data: Record<string, unknown>;
}
```

### 2. 主模型的 narration（`thinking`）是单独的 timeline item，并且只有 `inlineThinkingMode !== 'off'` 才会渲染；关闭该设置时持久化的 thought 不等于可见。

来源：[`packages/cli/src/ui/components/HistoryItemDisplay.tsx#L87-L94`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/cli/src/ui/components/HistoryItemDisplay.tsx#L87-L94)

```tsx
      {itemForDisplay.type === 'thinking' && inlineThinkingMode !== 'off' && (
        <ThinkingMessage
          thought={itemForDisplay.thought}
          terminalWidth={terminalWidth}
          isFirstThinking={isFirstThinking}
        />
      )}
      {itemForDisplay.type === 'hint' && (
```

### 3. 可见 narration 的具体样式是一个带左边框的、逐行输出的 `ThinkingMessage`；首段使用强调样式，其余行使用次级颜色。

来源：[`packages/cli/src/ui/components/messages/ThinkingMessage.tsx#L72-L93`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/cli/src/ui/components/messages/ThinkingMessage.tsx#L72-L93)

```tsx
      <Box
        marginLeft={THINKING_LEFT_PADDING}
        paddingLeft={1}
        borderStyle="single"
        borderLeft={true}
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderColor={theme.text.secondary}
        flexDirection="column"
      >
        <Text> </Text>
        {fullLines.length > 0 && (
          <Text color={theme.text.primary} bold italic>
            {fullLines[0]}
          </Text>
        )}
```

### 4. 时间线的分组边界按相邻 item 类型计算，不按时间戳；连续 `thinking` 合并其视觉起点，`tool_group` 与非工具项的切换形成工具组边界。

来源：[`packages/cli/src/ui/components/MainContent.tsx#L86-L100`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/cli/src/ui/components/MainContent.tsx#L86-L100)

```ts
        const prevType = i > 0 ? uiState.history[i - 1]?.type : undefined;
        const isFirstThinking =
          item.type === 'thinking' && prevType !== 'thinking';
        const isFirstAfterThinking =
          item.type !== 'thinking' && prevType === 'thinking';
        const isToolGroupBoundary =
          (item.type !== 'tool_group' && prevType === 'tool_group') ||
          (item.type === 'tool_group' && prevType !== 'tool_group');

        return {
          item,
          isExpandable: i > lastUserPromptIndex,
          isFirstThinking,
          isFirstAfterThinking,
          isToolGroupBoundary,
```

### 5. 工具调用先被映射为一个 `tool_group`，每个工具项可携带 `subagentHistory`；也就是说 subagent 活动附属于发起它的工具调用。

来源：[`packages/cli/src/ui/hooks/toolMapping.ts#L125-L138`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/cli/src/ui/hooks/toolMapping.ts#L125-L138)

```ts
      subagentHistory: hasSubagentHistory(call)
        ? call.subagentHistory
        : undefined,
    };
  });

  return {
    type: 'tool_group',
    tools: toolDisplays,
    borderTop,
    borderBottom,
    borderColor,
    borderDimColor,
  };
```

### 6. Subagent 不是另开一个并列的实时卡片：检测到 agent group 后，`ToolGroupMessage` 直接在该工具组内嵌入 `SubagentGroupDisplay`，并传入同一个 `isExpandable` 折叠语义。

来源：[`packages/cli/src/ui/components/messages/ToolGroupMessage.tsx#L395-L409`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/cli/src/ui/components/messages/ToolGroupMessage.tsx#L395-L409)

```tsx
          return (
            <Box
              key={group[0].callId}
              flexDirection="column"
              width={contentWidth}
            >
              <SubagentGroupDisplay
                toolCalls={group}
                availableTerminalHeight={availableTerminalHeight}
                terminalWidth={contentWidth}
                borderColor={borderColor}
                borderDimColor={borderDimColor}
                isFirst={isFirstProp}
                isExpandable={isExpandable}
              />
```

### 7. Subagent 工具组的折叠摘要是一行每 agent 的状态：初始为 `Starting...`，完成时为成功或早停原因；展开后才显示完整 `history`。

来源：[`packages/cli/src/ui/components/messages/SubagentGroupDisplay.tsx#L195-L213`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/cli/src/ui/components/messages/SubagentGroupDisplay.tsx#L195-L213)

```tsx
        const history = toolCall.subagentHistory ?? progress.recentActivity;
        const lastActivity: SubagentActivityItem | undefined =
          history[history.length - 1];

        // Collapsed View: Show single compact line per agent
        if (!isExpanded) {
          let content = 'Starting...';
          let formattedArgs: string | undefined;

          if (progress.state === SubagentState.COMPLETED) {
            if (
              progress.terminateReason &&
              progress.terminateReason !== 'GOAL'
            ) {
              content = `Finished Early (${progress.terminateReason})`;
            } else {
              content = 'Completed successfully';
```

### 8. 持久化记录的 Gemini turn 可包含 `toolCalls`、`thoughts`、token 用量和 model；工具记录还保留参数、结果、状态、时间及 UI 显示元数据。

来源：[`packages/core/src/services/chatRecordingTypes.ts#L37-L65`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/services/chatRecordingTypes.ts#L37-L65)

```ts
export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: PartListUnion | null;
  status: Status;
  timestamp: string;
  agentId?: string;
  // UI-specific fields for display purposes
  displayName?: string;
  description?: string;
  resultDisplay?: ToolResultDisplay;
  renderOutputAsMarkdown?: boolean;
}
```

### 9. 持久化格式是 JSONL：服务为主会话建立 `chats` 文件，subagent 会话放在父 session ID 目录下，并通过同步追加一行 JSON 写入每条 record。

来源：[`packages/core/src/services/chatRecordingService.ts#L479-L495`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/services/chatRecordingService.ts#L479-L495)

```ts
        let chatsDir = path.join(
          this.context.config.storage.getProjectTempDir(),
          'chats',
        );

        // subagents are nested under the complete parent session id
        if (this.kind === 'subagent' && this.context.parentSessionId) {
          const safeParentId = sanitizeFilenamePart(
            this.context.parentSessionId,
          );
          if (!safeParentId) {
            throw new Error(
              `Invalid parentSessionId after sanitization: ${this.context.parentSessionId}`,
            );
          }
          chatsDir = path.join(chatsDir, safeParentId);
        }
```

### 10. 记录服务在完成模型流后先 flush buffered thoughts，再在有正文、thought 或 tool call 时落一条 `gemini` 消息；因此工具前 narration 能与该模型 turn 一起保留。

来源：[`packages/core/src/core/geminiChat.ts#L1634-L1668`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/core/src/core/geminiChat.ts#L1634-L1668)

```ts
    // Flush buffered thoughts from the successful attempt
    for (const thought of bufferedThoughts) {
      this.chatRecordingService.recordThought(thought);
    }

    // Flush buffered usage metadata and token counts from the successful attempt
    if (bufferedUsageMetadata) {
      this.chatRecordingService.recordMessageTokens(bufferedUsageMetadata);
      if (bufferedUsageMetadata.promptTokenCount !== undefined) {
        this.lastPromptTokenCount = bufferedUsageMetadata.promptTokenCount;
      }
    }

    // Record model response text from the collected parts.
    // Also flush when there are thoughts or a tool call (even with no text)
    // so that BeforeTool hooks always see the latest transcript state.
```

### 11. 重放将持久会话转换为 UI history，再同时恢复给 Gemini client；恢复路径明确避免把这些历史再次写入 recording service。

来源：[`packages/cli/src/ui/hooks/useSessionResume.ts#L70-L92`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/cli/src/ui/hooks/useSessionResume.ts#L70-L92)

```ts
      setIsResuming(true);
      try {
        // Now that we have the client, load the history into the UI and the client.
        setQuittingMessages(null);
        historyManagerRef.current.clearItems();
        uiHistory.forEach((item, index) => {
          historyManagerRef.current.addItem(item, index, true);
        });
        refreshStaticRef.current(); // Force Static component to re-render with the updated history.

        // Restore directories from the resumed session
        if (
          resumedData.conversation.directories &&
          resumedData.conversation.directories.length > 0
        ) {
          const workspaceContext = config.getWorkspaceContext();
          // Add back any directories that were saved in the session
          // but filter out ones that no longer exist
          workspaceContext.addDirectories(resumedData.conversation.directories);
        }

        // Give the history to the Gemini client.
        await config.getGeminiClient()?.resumeChat(clientHistory, resumedData);
```

### 12. 限制：subagent 的运行期活动不是主会话可完整重放的时间线。新一轮调度会清空 `subagentHistoryMap`，而 session-to-UI 转换只由 durable `toolCalls` 建造工具组，未恢复该 map 的逐项 activity。

来源：[`packages/cli/src/ui/hooks/useToolScheduler.ts#L210-L214`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/cli/src/ui/hooks/useToolScheduler.ts#L210-L214)

```ts
  const schedule: ScheduleFn = useCallback(
    async (request, signal) => {
      // Clear state for new run
      setToolCallsMap({});
      setSubagentHistoryMap({});
```

来源：[`packages/cli/src/utils/sessionUtils.ts#L641-L663`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/cli/src/utils/sessionUtils.ts#L641-L663)

```ts
    // Add tool calls if present
    if (
      msg.type !== 'user' &&
      'toolCalls' in msg &&
      msg.toolCalls &&
      msg.toolCalls.length > 0
    ) {
      uiHistory.push({
        type: 'tool_group',
        tools: msg.toolCalls.map((tool) => ({
          callId: tool.id,
          name: tool.displayName || tool.name,
          args: tool.args,
          description: tool.description || '',
          renderOutputAsMarkdown: tool.renderOutputAsMarkdown ?? true,
          status:
```

### 13. 限制：subagent 的 JSONL 虽可保存为 `kind: 'subagent'`，但 session browser 明确过滤它们，称其为工具调用的实现细节，故不会作为主 agent 历史中的可恢复会话单独呈现。

来源：[`packages/cli/src/utils/sessionUtils.ts#L281-L292`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/packages/cli/src/utils/sessionUtils.ts#L281-L292)

```ts
          // Skip sessions with no resumable conversation content, including
          // startup-only, system-only, command-only, and internal-context-only
          // sessions.
          if (!content.hasResumableContent) {
            return { fileName: file, sessionInfo: null };
          }

          // Skip subagent sessions - these are implementation details of a tool call
          // and shouldn't be surfaced for resumption in the main agent history.
          if (content.kind === 'subagent') {
            return { fileName: file, sessionInfo: null };
          }
```

### 14. 官方文档确认 subagent 在主会话中以同名工具暴露：主 agent 调用后委派任务，完成时只把 findings 回报主 agent；其上下文窗口独立于主历史。

来源：[`docs/core/subagents.md#L10-L22`](https://github.com/google-gemini/gemini-cli/blob/ed2ac40df67a319bf348bd7e3d10494696b31b38/docs/core/subagents.md#L10-L22)

```md
Subagents are "specialists" that the main Gemini agent can hire for a specific
job.

- **Focused context:** Each subagent has its own system prompt and persona.
- **Specialized tools:** Subagents can have a restricted or specialized set of
  tools.
- **Independent context window:** Interactions with a subagent happen in a
  separate context loop, which saves tokens in your main conversation history.

Subagents are exposed to the main agent as a tool of the same name. When the
main agent calls the tool, it delegates the task to the subagent. Once the
subagent completes its task, it reports back to the main agent with its
findings.
```

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | Google 官方仓库固定于 `ed2ac40`；涵盖 UI item、工具组、subagent 活动、JSONL recording 与 resume。 |
| 作者或维护者本人的说法 | 未找到单独的设计说明；使用 Google 仓库内官方 `docs/core/subagents.md` 作为产品行为说明。 |
| 同类方案 | 不适用：本笔记仅核验 Gemini CLI，且用户限定来源为 Google 官方文档或其源码。 |
| issue / PR / 社区实践 | 未查：源码和官方文档已直接覆盖所问的行为与限制。 |
| 历史演变 | 未查：本次结论固定于单一 SHA，未试图推断此前版本的行为。 |
