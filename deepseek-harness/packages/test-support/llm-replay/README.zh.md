# @deepseek-ai/dsh-llm-replay

[English](README.md) | 中文

用于无密钥快照测试的 LLM（大语言模型）回放插件。它根据已记录的**会话 JSONL** fixture（测试前置数据）重建模型流，使测试无需 API 密钥即可针对固定的模型 transcript（文本记录）启动真实 agent（智能体）。配置 `providers` 后，它会注册仅用于回放的适配器，其模型目录可供测试模型发现功能的场景使用；未配置 `providers` 时，它会安装无需模型发现功能的测试所用 catch-all `llm/stream` waterfall（瀑布式事件）。

其消费方包括 ACP（Agent Client Protocol）与 headless `stream-json` 快照套件，以及 Web 浏览器 e2e 流水线。Loader 驱动的套件使用此插件替代真实 LLM 适配器；Web 流水线直接安装它，以保留清理阶段的消费检查句柄。

## fixture 的工作方式

fixture 就是持久化的会话日志（`<scenario>/session.jsonl`）。其 `assistant/chunk` 事件包含每个 `StreamChunk`，因此按 `(turn, step)` 分组即可重建每次 agent loop（智能体循环）的 `stream()` 调用的分片序列。压缩（compaction）摘要器成功时，日志记录方式有所不同：当 `compaction/summary` 携带 `llmStreamCall: true` 和完整的 `rawOutput` 时，回放会在该事件的位置重建一条规范成功流，其中每个块各使用一对 `block-start`/`block-end`，带上已记录的用量（如有），并以 `stop` 终止。提供方增量的精确切分不属于持久压缩结果。不带该标记的 `rawOutput` 并不意味着发生了本地 LLM 调用，因为模板摘要器和远程摘要器即使未使用此上下文的适配器，也可能保留完整输出。

因此，录制就是「运行一次真实 agent 并收集 `.jsonl`」，由快照 harness 完成；该插件本身不录制。fixture 的 `request/header` 内容可能被标记化为 `{{system}}`/`{{tools}}`（harness 会在一个场景中固定该内容，并清除其余场景中的内容）；回放不受影响，因为派生过程只读取 `assistant/chunk` 和 `compaction/summary` 事件以及第 0 行的会话 header。

有两种失败模式无法仅根据 `assistant/chunk` 重建：在产生任何分片前直接抛出异常（例如 HTTP 401，此时日志只有 `turn/end {error}` 而没有分片），以及取消或挂起（差异在时序，而非分片内容）。需要这些行为的场景可提供伴随文件（`<scenario>/replay.override.json`）：它可以替换派生脚本（裸 `ReplayEntry[]`），也可以增补派生脚本（`{ patches: [{ at, entry }] }`：保留所有从 JSONL 派生的调用，只替换指定的从 0 开始计数的调用索引；当 `at` 等于派生长度时，则在注入瞬态异常后的重试位置追加一次调用）。补丁索引不得重复。文件加载时会校验覆写文档、每个补丁和条目，以及每个分片的判别标签。`hang` 条目可以指定 `readyFile`；当前缀分片到达循环后、开始等待取消前，回放会写入这个空标记，使外部驱动程序无需观察展示层更新即可确定性地取消。

脚本字符串可以内嵌 `{{fromRequest:<regex>}}`，用来填入静态伴随文件不可能预知的值——例如模型必须原样回填到 `update_goal` 的随机生成 goal id。回放时每个占位符针对实时请求解析：语料是请求消息的所有字符串叶子按换行拼接的结果，取该模式在语料中的最后一次匹配，用其第一个捕获组（无捕获组时用整个匹配）原位替换。模式匹配不到内容、模式非法、占位符未闭合都会明确报错。连续右花括号串的最后两个花括号才是占位符结束符，因此模式可以以花括号量词收尾（如 `[0-9a-f]{4}`），但不能在 `}}` 之后还有后续模式内容。解析作用于所有脚本条目，包括从已记录 JSONL 派生的条目——若录制文本本身合法地含有该字面量标记，需改用不含标记的伴随文件表达。

## 嵌套 agent：每会话键控

父 agent 委托给进程内 subagent 的场景会记录多个日志：父会话使用 `session.jsonl`，每个子会话各使用一个日志（`session.1.jsonl` 等）。每个 agent 都在同一上下文中作为独立的 `Session` 运行，因此回放必须为每个 agent 提供各自的脚本。

回放根据发起调用的会话 id 为每次调用建立键（`GenerateOptions.sessionId` 由 agent loop 写入）。实时会话 id 每次运行时都会重新随机生成，绝不会等于记录中的 id，因此实时会话按**首次调用顺序**绑定到已记录脚本：脚本按 header 中的 `createdAt` 排序（父会话在前，因为它必须先开始流式输出才能委托）；第一个发起调用的实时会话取得第一个脚本，下一个新会话取得下一个脚本，以此类推。此后每个会话分别推进自己的游标。没有 `sessionId` 的调用视为一个绑定主脚本的匿名会话。不同实时会话的数量超过已记录脚本数时会明确报错。

## 配置

| 键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `file` | string | `$DSH_SNAPSHOT_FILE` | 主（父）`session.jsonl` fixture 的路径。必需（配置或 env）。 |
| `overrideFile` | string | `$DSH_SNAPSHOT_OVERRIDE` | 主会话的可选 `ReplayOverrideDoc` 伴随文件：裸 `ReplayEntry[]` 替换其派生脚本，`{ patches }` 则按调用索引增补该脚本。 |
| `childFiles` | string[] | `$DSH_SNAPSHOT_CHILD_FILES`（以路径分隔符分隔） | 嵌套场景中已记录的 subagent 子会话日志；单会话场景为空。 |
| `providers` | `ReplayProviderConfig[]` | 无 | 可选的仅回放提供方和模型目录。每个提供方可以设置 `retryPolicy`，每个模型可以发布 `contextWindow` 和仅包含 `text`、`image` 的 `inputModalities` 数组；模态配置无效时，插件加载会失败。已配置路由通过回放适配器分派，绝不执行提供方 I/O。 |
| `paceMs` | number | 无（突发） | 可选的每分片延迟（单位为毫秒），使下游传输（例如真实浏览器观察到的 Web SSE（Server-Sent Events）多路复用器）看到真正的增量传递。它只是用于提高真实性的调节项，测试不得依赖它保证正确性。值必须是非负整数；pace 等待期间中止会迅速取消流。 |

```yaml
- id: llm-replay
  name: '@deepseek-ai/dsh-llm-replay'
  config:
    providers:
      - id: deepseek-official
        name: DeepSeek
        retryPolicy:
          mode: normal
          backoff:
            initialDelayMs: 1
            maxDelayMs: 1
            jitterRatio: 0
        models:
          - id: deepseek-v4-flash
            contextWindow: 128000
          - id: deepseek-v4-pro
  # file/overrideFile/childFiles default to $DSH_SNAPSHOT_FILE /
  # $DSH_SNAPSHOT_OVERRIDE / $DSH_SNAPSHOT_CHILD_FILES, set by the snapshot
  # harness per scenario.
```

## 导出项

- `installLlmReplay(ctx, config)`：安装已配置回放适配器或 catch-all `llm/stream` 监听器；返回 `ReplayHandle`（包含用于保证 HMR（热模块替换）安全的 `dispose()`，以及清理阶段执行的 `assertConsumed()` 检查；后者确保每个已记录脚本都绑定到实时会话，且每个已绑定游标都已耗尽，从而将场景静默驱动的模型调用少于记录数转换为明确诊断）。在测试中使用它，可以不通过 Loader 或 env var 驱动回放。
- `loadSessionScripts(config)`：解析场景中有序的 `SessionScript[]`（主会话 + 子会话），准备按首次调用顺序绑定到实时会话。
- `loadReplayScript(config)`：只解析主会话的 `ReplayEntry[]`（如果伴随文件存在，则使用经校验的替换或补丁；否则从 JSONL 派生；fixture 缺失时明确报错）。
- `deriveReplayScript(events)` / `parseSessionLog(text)` / `parseSessionHeader(text)` / `resolveScriptedEntry(entry, messages)`：将已记录会话日志中的普通 loop 分片和显式标记的本地压缩输出转换为脚本、读取其 header `id`/`createdAt`、并针对单次实时请求解析 `{{fromRequest:...}}` 占位符的纯辅助工具。派生的 assistant 分组必须以 `finish` 分片结束；没有该分片的分组是 `stream()` 抛出异常的指纹，必须改用 override 伴随文件表达。
- 类型 `ReplayEntry` / `ReplayOverrideDoc` / `ReplayOverridePatch` / `SessionScript` / `ReplayConfig` / `ReplayProviderConfig` / `ReplayModelConfig` / `ReplayHandle` / `Config`。

## 插件导出形态

命名导出 `name` / `inject` / `Config` / `apply`，且**没有默认导出**：Cordis Loader 的 `unwrapExports` 执行 `exports.default ?? exports`，因此意外的默认导出会将模块折叠为函数本身，并丢弃 `inject` 命名空间（见 [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)）。

## 模型体验

无。该无密钥测试适配器不向提供方模型发送请求，只将已记录 assistant 分片回放到测试 loop 中。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **首次调用顺序脚本绑定假设串行委托**：一种并发运行同级 subagent 的实现会非确定性地将实时会话绑定到已记录脚本；在这种场景出现前暂不实现更强的键控（`XXX(concurrent-subagents)`）。
- **只有普通 loop 分片和带标记的本地压缩输出才能派生**：在产生分片前直接抛出异常、取消/挂起，或未标记的外部摘要器调用场景需要 `replay.override.json` 伴随文件。替换和补丁两种形式都只影响主会话；子会话脚本仍从各自日志派生。
