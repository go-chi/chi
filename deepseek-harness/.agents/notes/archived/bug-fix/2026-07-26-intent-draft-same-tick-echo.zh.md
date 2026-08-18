# Agent Note: Intent draft echoes in the same tick

Status: implemented
Archived: 2026-07-26

[English](2026-07-26-intent-draft-same-tick-echo.md) | 中文

## Problem

hero composer（「Let's start building」）是一个受控（controlled）的 textarea，它的值取自前端 Session Intent 保留下来的提示词，读自会话**列表**快照（`EmptyState` 通过 `useSessions` 绑定 `intent.prompt`）。输入经由 `SessionManager.updateIntent → Session.updatePendingPrompt`，后者会同步刷新 **Session 自身的** notifier——但 composer 实际渲染所依据的那份列表快照，只能通过 `startIntent` 中的 intent watch 订阅得知这次变更，而该订阅调用的是 `markDirty()`，即一次延迟到微任务的刷新。

延迟的回显违反了 Notifier 上所记录的受控输入契约（见 [web 客户端架构笔记](../architecture/2026-07-19-gui-web-client-architecture.md)）：React 在与 `onChange` 相同的 tick 内，把 DOM 值与仍然陈旧的快照相比对，随后把 textarea 回滚。普通输入时，这表现为光标跳动；使用输入法（IME）时，它会损坏输入——每一次 composition 更新都会被回滚，并针对陈旧的值重新应用，因此输入拼音「nihao」会提交出类似「nnini hni hani hao你好」这样的片段。resident composer（`ConversationRoot`）不受影响：它的草稿存放在 chat store 中（同步刷新），或来自 `updateSessionPrompt`，后者直接读取 Session 快照，而不是列表投影。

## Decision

`SessionManager.updateIntent` 在 `updatePendingPrompt` 之后调用 `this.notifier.notifyNow()`，从而在与变更事件相同的 tick 内刷新列表快照。这符合 Notifier 的通道规则：当某个用户手势的受控输入正是从该快照渲染时，对它的直接回显使用 `notifyNow`；而 intent watch 对其余所有（异步的）intent 状态转换仍保留 `markDirty`。

## Alternatives considered

**把 `startIntent` 中的 intent watch 回调改为 `notifyNow`。** 对那个 seam 而言是错误的通道：该 watch 也会在帧驱动的 Session 变更（发布、发送阶段）时触发，而架构笔记禁止对帧驱动的来源使用 `notifyNow`，因为那会瓦解批处理。

**让 `EmptyState` 从 Session 快照而非列表读取提示词。** 这会重构槽位契约（EmptyState 有意绑定到标准的 `useSessions` 数据源，且尚无 session 作用域——前端 Session 是页面本地的），相比刷新它本就读取的那份投影并无收益。

**在 `InputBar` 中用本地的非受控状态抑制回滚。** 这只是掩盖症状，放弃了单一真源的草稿（保留下来的提示词必须在工作区重定向以及发送／重试后依然存在），并让其余每一个由列表快照控制的输入都暴露在同一问题之下。

## Consequences

在 hero composer 中输入（包括输入法 composition 在内）会同步回显。在无 intent 的状态上调用 `updateIntent` 仍是一次空操作，不发出任何通知。web workspace-flow 快照的 composer 辅助函数现在断言的是同一 tick 内的回显，而不是等待它，因此一旦回退成延迟回显，就会让无密钥快照门禁失败；一个运行时单元测试在 manager 这一 seam 处钉住了同一份契约。
