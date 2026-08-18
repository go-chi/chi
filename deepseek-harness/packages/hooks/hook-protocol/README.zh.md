# @deepseek-ai/dsh-hook-protocol

[English](README.md) | 中文

Claude Code／Codex hook 协议格式（wire format）的**共享核心**。它不是 Cordis 插件：不注册也不注入任何内容。它是一个**库**，提供两个桥接插件（`@deepseek-ai/dsh-hooks-claude-code`、`@deepseek-ai/dsh-hooks-codex`）导入的方言无关原语，使两者都无需重复实现协议中相同的部分。

Codex 有意重新实现了 Claude Code hook 协议的一个*子集*，包括相同的 `hooks.json` matcher group 结构、相同的退出码／stdout 输出约定以及相同的 command hook 执行模式。真正共享的部分位于此处；每个桥接只负责不同的部分。

## 共享内容（此处）与各方言内容（桥接）

| 关注点 | 此处（`dsh-hook-protocol`） | 桥接（`dsh-hooks-claude-code` / `-codex`） |
|---|---|---|
| Matcher 校验与匹配判断 | `matcherDiagnostic(pattern, mode)` 用于解析时诊断；`matchesMatcher(pattern, query, mode)` 用于隔离的运行时匹配 | 选择自身的 `mode`（`claude` = 字面量或正则，`codex` = 始终使用正则），并拒绝带有诊断的配置组 |
| 运行 hook | `runHook(bash, hook, opts, now)`：通过 `ctx.shell` 提供 stdin payload + env，再解码 | 构造每个事件的 stdin **payload** + 该方言的 **env** |
| 解码输出 | `parseHookOutput(exit, stdout, stderr)` → 中性 `HookOutput` | 将中性 `HookOutput` 映射到扩展点特定的类型化 Decision |
| 合并 N 个 hook | `mergeHookOutputs(outputs)` → 最严格的 `MergedHookOutcome` | （无） |
| 持久记录 | `appendHookInvoked` / `appendHookResult`（`hook/*` 会话事件；结果的 `decision`／`stderrSummary` 从此处的 `HookOutput` 派生） | 在每次调用前后调用它们 |
| 脱离运行的完全停稳 | `createDetachedRuns()`：跟踪触发后不等待的运行链；`drain()` 先 abort，再等待它们 | 将 `signal` 传给每个脱离的 `runHook`，并将 `drain` 注册为 effect disposer |

## 原语

- **`matcherDiagnostic(matcher, mode)` / `matchesMatcher(matcher, query, mode)`**：缺失、`''` 或 `'*'` 时匹配全部；`claude` mode 将纯 `[A-Za-z0-9_|]+` pattern 视为字面量（管道符 = 精确匹配交替），其他 pattern 视为正则；`codex` mode 始终使用未锚定正则。桥接解析器会丢弃没有 matcher 匹配对象的事件所带的 matcher 字段，再用 `matcherDiagnostic` 拒绝事件实际使用的无效正则，并在注册任何钩子之前给出稳定诊断。运行时谓词仍会将无效 pattern 隔离为不匹配，因此直接调用本库不会向 agent loop（智能体循环）抛异常。
- **`runHook(bash, hook, options, now)`**：要求并转发调用方拥有的 `options.signal`，将 `options.payload` 序列化到 hook stdin（当且仅当 `options.trailingNewline` 时添加尾随换行符），在执行器凭证清理后合并 `options.env`（`dsh-shell` 受信任插件接口），遵循 hook 的 `timeoutSec`（否则使用 `options.defaultTimeoutMs`；默认值属于桥接，其配置默认为 lib 的 `DEFAULT_HOOK_TIMEOUT_MS` 10 分钟参考值），再解码结果（将 `options.expectedEventName` 传递给 codec）。因此取消会到达执行器的进程组终止与 join 边界。它绝不抛出异常：执行器拒绝（基础设施故障）会变为 `HookOutput`，其 `exitCode: undefined`（非阻塞错误）。`now` 会被注入，以便测试持续时间。
- **`parseHookOutput(exitCode, stdout, stderr, expectedEventName?)`** 解码退出状态与结构化 stdout。退出码为 2 时，会以 stderr 内容阻止执行；其他失败不阻塞。匹配的 hook 特定权限决策会覆盖遗留顶层决策；事件判别字段不匹配或缺失只会抑制事件特定字段。顶层字段仍与事件无关，成功但非 JSON 的输出会留给桥接处理。
- **`mergeHookOutputs(outputs)`**：折叠在一个点上匹配的每个 hook 结果：权限优先级为 **deny > ask > allow**，从首个 `continue:false` 起，halt 状态保持不变，阻塞原因用 `\n\n` 连接，`additionalContext`／`systemMessages` 按顺序累积。
- **`createDetachedRuns()`**：跟踪以 emit 形式脱离运行的点是否完全停稳（没有扩展点等待它们）。桥接会跟踪每条运行链，包括 hook 运行及其 continuation，并将 `drain()` 注册为 effect disposer。drain 会触发 tracker 的 abort `signal`（因此仍在运行的 hook 进程会通过 `runHook` 终止，而不是等待到超时），随后在所有已跟踪链结算后 resolve。因此 `fiber.dispose()` resolve 时，不会遗留任何可能作用于已 dispose（资源释放）的上下文的脱离 hook 工作（见 [防御模式](../../../docs/defensive-patterns.md)：dispose 必须达到完全停稳）。

## `hook/*` 会话事件

通过 declaration merging 合并到 `SessionEventMap`（仅日志，与 `compaction/*` 相同；不是 `SurfaceEventType`，没有 `surfaceOp`）：`hook/invoked`（hook 命令已运行）与 `hook/result`（其结果，按 `handlerId` 配对，决策规则由 `appendHookResult` 负责）。Payload 与每事件 JSDoc 位于生成的 [持久化日志事件目录](../../../docs/persistence-catalog.md)；`stderrSummary` 会截断到记录的 `stderrSummaryMaxChars`（桥接配置，参考默认值 `DEFAULT_STDERR_SUMMARY_MAX_CHARS` = 500；为空时省略）。

Hook 调用／结果记录必须位于一个尚未结束的轮次内。`UserPromptSubmit`、`PreToolUse`、`PostToolUse` 与 `Stop` 按构造满足这条由所有者定义的关系。`SessionStart` 在轮次 1 之前运行，因此没有 `hook/*` 记录；其获准的上下文会在 inbox 中保持待处理，直到唤醒交付打开一个轮次，详见 hooks Agent Note。

## 模型体验

通过 `dsh-hooks-claude-code` 与 `dsh-hooks-codex` 间接影响；它们可以将解析后 hook 输出转为提示词上下文、已阻塞结果或 continuation 反馈。

#### KV Cache 影响

不会直接失效；请求前缀变更由上述消费方负责。

## 已知限制与暂缓事项

- **`HookOutput.updatedInput` 会被解析但不会应用**：输入改写是已暂缓的一致性设计问题（见 [pre-tool-input-rewrite Agent Note](../../../.agents/notes/proposed/feature/2026-06-30-pre-tool-input-rewrite.md)）；当 hook 设置它时，桥接会记录 + 警告。完整约定见 `src/types.ts`。
