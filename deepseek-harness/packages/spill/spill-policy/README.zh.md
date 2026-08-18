# @deepseek-ai/dsh-spill-policy

[English](README.md) | 中文

**工具结果 spill 策略**：一个 `tools/post-execute` 转换器，用于防止过大的纯文本工具结果进入模型上下文。当最终结果超过 `maxInlineBytes` 时，它会通过 [`ctx.spillStore`](../spill) 保存完整文本，并将面向模型的结果替换为有界的首尾预览、后端定位信息与取回指引。

该插件**不注册任何服务**，也不负责存储或预览机制：预览由 [`@deepseek-ai/dsh-output-retention`](../../util/output-retention)（`TextRetainer`）负责，存储由 `ctx.spillStore` 负责。它只决定何时 spill，并组合通知。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `maxInlineBytes` | *（省略）* | 面向模型的纯文本结果上下文上限，以 UTF-8 字节数计（在加载时验证为非负整数）。**省略时完全禁用该策略**（插件不注册任何内容）。设置后，超过该上限的结果会被 spill，并替换为从同一预算派生的预览（首尾拆分）。 |

## 行为

1. 允许工具运行（通过 `next()` 委托，因此可以限制任何下游钩子接受的结果）。
2. 跳过嵌套执行（存在 `exec.parent`——其持久化副本由下方的 dispatch-log 分支设界）、已接受的值替换（注册表必须重新验证并重新渲染它们）、`read`（避免 `read → spill → read again` 循环）以及任何非 `accept` 决策（`block` 的纠正反馈会原样通过）。
3. 仅在已接受的内容为**纯文本**（全部都是 `text` 块）时才将其展平；包含任何非文本块的结果都保持不变。
4. 如果 UTF-8 大小为 `≤ maxInlineBytes`，则保持不变。
5. 否则，保存完整文本，并将结果替换为预览和以下通知。系统会调整大小，使整个替换内容（预览、空行和通知）不超过 `maxInlineBytes`：先从预算中保留通知所需字节，再缩小预览以适配剩余空间，因此面向模型的结果绝不会超过上限：

   ```text
   <retained head/tail preview>

   (Omitted N bytes. Full formatted result stored at: /…/session-…/…-web_fetch.txt. Use read with offset/limit, or grep this path to search within it.)
   ```

   当通知本身已占满预算时（上限极小或定位信息很长），预览为空，只返回通知。如果仅通知的替换内容仍会超过 `maxInlineBytes`，策略将保留内联结果；它绝不会发出超过上限的替换内容（而且上限内的替换内容总比原结果更小，因此这也意味着 spill 绝不会增加字节数）。

**尽力而为**：没有会话所有者、没有 `ctx.spillStore` 后端，或 `saveText` 返回拒绝 ⇒ 策略记录警告并返回原始结果。spill 失败绝不会将成功调用变为 `isError`，也不会隐藏内联结果。成功替换时只会更改 `content`；规范的程序化值保持不变。

**dispatch-log 分支：**注册在 `tools/code-dispatch-log` 上的第二个监听器，把同一套上限、替换流水线与尽力而为的回退应用到每个 `run_code` 子调用结果的持久化副本上（产物标签为 `dispatch`，按子调用 id 归档）。程序的值不受影响，因为它早已完整跨过 worker 边界；`read` 子调用同样设界：日志副本不是模型上下文，因此不会发生 read-again 循环，而 `read` 恰恰是最容易产生巨型日志的工具（[原理](../../../.agents/notes/implemented/feature/2026-07-26-code-dispatch-log-spill.md)）。

## 范围

该策略只能看到最终格式化的呈现结果，看不到工具的内部资源或规范值。如果提供方已经截断内容（例如 `web-fetch-http.maxBodyChars`），spill 产物保存的是工具返回的完整格式化结果，而非完整原始源。提供方／资源上限仍然是必需的，并且与该策略相互独立。`glob`/`grep` 负责对项级呈现结果执行 spill，因为渲染前仍然存在完整的已获取值；bash 流负责在获取时 spill。通用策略预先注册自己的 waterfall（瀑布式事件）监听器，然后再委托，因此无论插件加载顺序如何，普通工具自身的异步投影都会在通用字节限制之前完成。详见[工具输出 spill Agent Note](../../../.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md)。

## 模型体验

### 过大的纯文本结果

#### 模型看到的内容

大小不超过 `maxInlineBytes` 的结果、嵌套结果、`read` 结果、被阻止的决策和包含非文本块的结果都保持不变。过大的纯文本呈现结果会变为有界的首尾预览，后面附加 `(Omitted <bytes> bytes. Full formatted result stored at: <locator>. <retrievalHint>)`；存储失败或没有会话所有者时，原始结果仍然可见。

#### Token 影响

成功替换后的内容最多为 `maxInlineBytes` 个 UTF-8 字节，并会保留在历史中直到压缩（compaction）；完整 spill 文本不会重新发送给模型。

#### KV Cache 影响

仅追加；新可见内容位于可重用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **只能对最终纯文本结果执行 spill**：混合内容结果、阻止反馈和 `read` 会原样通过；无法在此恢复先前已经发生的提供方截断或工具自身执行的保留处理。
- **通知无法容纳时，该次调用的替换功能会禁用**：当上限极小或定位信息很长时，后端已经保存了无引用的 spill，但过大的原始结果仍会保留在内联位置。
