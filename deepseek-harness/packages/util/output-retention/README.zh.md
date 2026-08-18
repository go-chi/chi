# dsh-output-retention

[English](README.md) | 中文

一个轻依赖的**保留**库：为必须限制返回上下文量的工具提供有界的面向模型输出。调用方将项或文本分片送入有界对象，然后取回保留的内容和精确的省略元数据。

该库**只**负责这个机制问题：*「我们保留了什么，又省略了什么？」*。工具专用代码保留其业务语义：文件分组、行号、退出码、提供方错误状态、每行预览截断、spill 文件以及面向模型的文案。这就是 [Agent Note](../../../.agents/notes/implemented/architecture/2026-07-06-tool-result-retention-library.md) 划定的边界。

它是**库，而非服务或插件**：没有 `ctx`，不注册任何内容，不发出任何事件。状态只存在于每个 retainer（一次累积）中，绝不跨调用。工具包直接导入它。

## 对外接口

```ts
import {
  ItemRetainer, TextRetainer,
  describeOmitted, formatRetentionNotice,
} from '@deepseek-ai/dsh-output-retention'
import type {
  Omitted, PushDecision, RetainedItems, RetainedText,
  ItemRetentionStrategy, TextRetentionStrategy, RetentionNotice,
} from '@deepseek-ai/dsh-output-retention'
```

| 导出项 | 职责 |
|---|---|
| `ItemRetainer<T>` | 限制有序逻辑单元（路径、grep 匹配项、来源）。只支持 `head`。`push()` → `PushDecision`；`finish()` → `RetainedItems<T>`。 |
| `TextRetainer` | 限制面向字节的文本流。`head` / `tail` / `headTail`，并在 `finish()` 时保留 UTF-8 边界。`push()` → `PushDecision`；`finish()` → `RetainedText`。 |
| `describeOmitted(omitted, unit)` | 标准化的省略子句（`exact` 输出数量；`unknown` 不输出）。 |
| `formatRetentionNotice(notice, recovery)` | 将标准化的省略子句与工具自有的恢复指引连接起来。 |
| `Omitted` | `none` / `exact` / `unknown`：省略了多少内容。 |
| `PushDecision` | `{ kept, truncated }`：每次 push 的保留结果。 |

## 资源模式

两个 retainer 使用独立名称，而不是同一个通用收集器，因为它们的**资源模型**不同。

- **`ItemRetainer` 限制有序逻辑单元**。搜索工具可收集完整结果集用于 spill 文件恢复，同时只为面向模型的预览保留前 `maxItems` 项。因为调用方会继续送入每个已观察到的项，所以省略数量是精确的。
- **`TextRetainer` 限制面向字节的文本**。`head`、`tail` 和 `headTail` 在 `finish()` 时保留 UTF-8 边界；`headTail` 是 `dsh-spill-policy` 用于围绕 spill 文件通知构建有界预览的形态。

## `truncated` 是预算事实，绝不表示「不完整」

`truncated` 表示*因为预算限制，retainer 省略了本可获得的内容*。它**不**表示上游不完整。权限失败、跳过二进制文件、提供方部分失败、不可读候选项和无效 UTF-8 保留在工具领域字段中，绝不合并到 `truncated`。将两者混为一谈是该库命名最容易诱发的缺陷；务必保持分离。

## 字节，而非字符

文本上限和 `omittedBytes` 按**字节**计数，以保证进程/正文安全（子进程管道和 HTTP 正文都是字节流）。跨越码点的分片会被正确处理：`finish()` 会修剪每个切割位置的不完整码点，使返回文本绝不在边界引入替换字符；首尾两侧会分开解码，因此绝不会跨越被省略的中间部分重建码点。按字符或行限制的预览预算属于独立的工具职责。

## 工具映射

当前的保留机制消费方采用以下映射：

| 工具 | Retainer 与策略 | 说明 |
|---|---|---|
| `glob` | `ItemRetainer<FsGlobEntry>`，`head` | 收集完整的已排序路径列表用于 spill 文件，同时在内联位置保留第一页。路径映射、已跳过候选项和 `incomplete` 保留在外部。 |
| `grep` | `ItemRetainer<FlatGrepMatch>`，`head` | 收集匹配项用于 spill 文件，同时在内联位置保留第一页。每个匹配项的预览截断、分组、排序和 `incomplete` 保留在外部。 |
| `bash` | `TextRetainer`，`tail` 或 `headTail` | 执行器仍负责 spill 文件、退出状态、信号、超时和后台任务。 |
| `web_fetch` | `TextRetainer`，`head` 或 `headTail` | 提供方/资源上限保留为提供方事实；retainer 只提供保留文本和省略元数据。 |
| `web_search` | `ItemRetainer<WebSearchSource>`，`head` | 当提供方返回的来源超过面向模型的结果应包含的数量时，标准化「来源已达上限」通知。 |

`read` 仍不属于这个通用库。其 `read-render` 辅助工具负责文件专用的分页约定：`offset`/`limit`、行号、`totalLines`、偏移越界错误、每行预览截断，以及所选窗口的字节上限。该辅助工具是一个行窗口渲染器。单个 `Omitted` 数量无法表示该窗口两侧。

## 使用形态

```ts ignore-check
// glob: keep the first page inline while still collecting the full list for spill.
const retainer = new ItemRetainer<FsGlobEntry>({ kind: 'head', maxItems: globMaxResults })
const allEntries: FsGlobEntry[] = []
for await (const entry of candidates) {
  allEntries.push(entry)
  retainer.push(entry)
}
const { items, truncated, omitted } = retainer.finish()

// bash: keep a head + tail, read to process exit.
const out = new TextRetainer({ kind: 'headTail', headBytes: headCap, tailBytes: tailCap })
child.stdout.on('data', (chunk: Buffer) => { out.push(chunk) })
const { text, omittedBytes } = out.finish()

// A footer: the library standardizes the omission clause; the tool owns recovery words.
const footer = formatRetentionNotice(
  { scope: 'grep', strategy: 'head', unit: 'items', limit: grepMaxMatches, kept: items.length, omitted },
  ({ kept }) => `Results capped at ${kept}. Narrow the pattern, path, or include to see more.`,
)
```

## 模型体验

通过渲染保留内容和省略元数据的工具消费方间接影响模型。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与暂缓事项

- **项保留只支持 `head`**：tail、head/tail、分页、分组和提供方完整性语义仍由工具负责。
- **文本保留面向字节**：`read` 分页等行窗口和字符窗口需要单独的渲染器；切割可能会丢弃部分 UTF-8 边界字节，以保持返回文本有效。
