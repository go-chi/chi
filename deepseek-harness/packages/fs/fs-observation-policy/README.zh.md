# @deepseek-ai/dsh-fs-observation-policy

[English](README.md) | 中文

**fs-observation-policy 插件**：它记录观测到的存在或缺失状态，并在 `ctx.fs` 提供方约定（[`@deepseek-ai/dsh-fs`](../fs)）之上增加编辑前读取和带防护的写入/编辑；它通过 `fs/*` 事件门禁参与，**不是**通过方法服务。该插件**不**注册 `ctx.fsPolicy` 服务，也没有公开的 `read`/`write`/`edit`/`resolve` 方法。它是文件系统栈的政策层：不是可替换 seam，而是不应位于 `FileSystem` 提供方基类上的政策。

```ts
import type { Context } from '@deepseek-ai/cordis'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'

declare const ctx: Context

// No service to inject — this plugin only registers the three fs/* listeners.
// Load it alongside a ctx.fs provider (e.g. @deepseek-ai/dsh-fs-local) and the
// @deepseek-ai/dsh-tool-fs tools; the tools dispatch the fs/* events this plugin
// decides. Order does not matter for resolution (no inject), but the policy
// listener should be the first decider registered for the fs/*-intent slots.
await ctx.plugin(FsPolicy)
```

## 四层拆分

| 层 | 包 | 角色 |
|---|---|---|
| 工具/执行器 | `@deepseek-ai/dsh-tool-fs` | 面向模型的 schema、读取窗口和文本渲染；通过 `ctx.fs` 读取/写入/编辑，并分派 `fs/*` 事件 |
| 策略 | `@deepseek-ai/dsh-fs-observation-policy`（本包） | 通过 `fs/*` 事件门禁提供已观察状态、编辑前读取和版本防护的写入/编辑（无服务） |
| 提供方约定 | `@deepseek-ai/dsh-fs` | `ctx.fs`：文本 I/O 与原子变更原语（可选版本防护）；拥有 `fs/*` 事件词汇 |
| 提供方 | `@deepseek-ai/dsh-fs-local` | `ctx.fs` 的本地实现 |

## 门禁的参与方式

三个 `fs/*` 事件（由 `@deepseek-ai/dsh-fs` 声明，`@deepseek-ai/dsh-tool-fs` 分派）：

| 事件 | 本插件的监听器 |
|---|---|
| `fs/write-intent` | 未见或已观测为缺失 → `{ kind: 'createIfAbsent' }`；已观测为存在 → `{ kind: 'replaceIfVersion', version: vObserved }`。单 slot 决策；不调用 `next()`。 |
| `fs/edit-intent` | 未见 → `FS_NOT_OBSERVED`；已观测为缺失 → `FS_NOT_FOUND`；已观测为存在 → 返回 `{ version: vObserved }` 作为 CAS 基础。单 slot 决策；不调用 `next()`。 |
| `fs/observed` | 为该所有者与目标记录 `{ kind: 'present', version }` 或 `{ kind: 'absent' }`。同步、只有副作用的 `WeakMap.set`。 |

## 已观察状态是先前观察记录；新鲜度由提供方 CAS 保证

观测状态是一张以所有者为弱键、记录各目标的映射表，具有三种逻辑状态：未见、确认缺失、存在于某个版本。成功读取文件或变更会记录存在；`read` 的元数据未命中，或 `str_replace_editor` 的 `view`、`str_replace`、`insert` 命令发生元数据未命中时，都会在返回 `FS_NOT_FOUND` 前记录缺失。插件不执行文件系统 I/O：它把该状态转换为提供方防护。存在状态提供观测到的版本；缺失状态只允许 `createIfAbsent` 写入继续，edit 因没有版本基准而返回 `FS_NOT_FOUND`。窗口读取会观察整个文件的版本，因此只有文件保持不变时才允许后续的定向编辑。插件 dispose（资源释放）时会丢弃状态，并且不会跨会话持久化。

## 单 slot、先到者胜

`fs/write-intent`/`fs/edit-intent` slot 只容纳一个决策器；本插件会完整决策，不调用 `next()`。slot 按注册顺序先到者胜；由本插件拥有 slot 只是默认部署约定，不是事件强制的不变式（更早注册或通过 `prepend` 注册的决策器会胜出）。这不是可组合的授权链；分层权限/审计/沙箱拦截属于 `tools/execute`。

## 不与方法耦合

由于插件只通过事件影响外部世界，移除它不会在服务注入边界破坏 `@deepseek-ai/dsh-tool-fs`：工具会直接落到裸 `ctx.fs` 提供方（无条件写入/编辑，无已观察状态）。重新加载插件后，策略会重新生效。相比必需的方法服务，这种可平稳增删的性质正是事件门禁的全部目的。

## 模型体验

### 文件系统工具结果

#### 模型看到的内容

该插件不添加提示词或 schema。没有先前观测时，它会以代码 `FS_NOT_OBSERVED` 和精确消息 `edit requires reading "<path>" first` 拒绝编辑；编辑刚被观测为缺失的目标会返回 `FS_NOT_FOUND`。正向观测陈旧时，带防护的变更会传播由提供方拥有的 `FS_STALE_VERSION` 错误。[`dsh-tool-fs`](../tool-fs/README.md) 拥有面向模型的错误包装，会为 `FS_STALE_VERSION` 消息追加恢复指令（`— re-read the file, then retry`）、为 `FS_NOT_OBSERVED` 消息追加恢复指令（`— read the file, then retry`），同时保留错误码。外部删除目标后，遵循陈旧恢复指令会记录缺失：下一次带防护的写入可以通过 `createIfAbsent` 重新创建该目标，而提供方会以原子方式保留任何并发创建者写入的文件。

#### Token 影响

允许的操作除了普通工具结果外不增加 token。拒绝会添加少量保留的错误结果，并避免产生成功 payload。

#### KV Cache 影响

仅追加；新增可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **已观察状态无法在会话恢复后保留**：`WeakMap` 记录的持久化工作延期处理，因此恢复的会话必须重新读取文件，才能执行防护写入/编辑。
- **没有 agent（智能体）会话的参与者绝无法满足策略**：它们的编辑会抛出 `FS_NOT_OBSERVED`，写入总会解析为 `createIfAbsent`，因此非 agent 调用方无法通过门禁覆盖现有文件。
- **直接 `ctx.fs` 读取不会发出 `fs/observed`**：在 `read` 工具之外读取的文件仍未观察；后续防护编辑会以 `FS_NOT_OBSERVED` 拒绝，直到工具读取该文件。
- **授权依据是版本新鲜度，而非视图完整性**：任何窗口读取都会授权对未变文件执行全文件覆盖，这有意弱于完整视图规则（见 [seam 拆分 Agent Note](../../../.agents/notes/implemented/simplification/2026-06-26-fsspec-style-fs-seam.md)）。
