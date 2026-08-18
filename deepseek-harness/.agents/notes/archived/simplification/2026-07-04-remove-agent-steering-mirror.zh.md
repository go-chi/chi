# Agent Note: 移除 `agent/steering` 镜像 emit

Status: implemented
Archived: 2026-07-26

[English](2026-07-04-remove-agent-steering-mirror.md) | 中文

## 问题

`agent/steering` 是最后一个仍存在的、对持久会话事件的瞬态镜像。agent loop（智能体循环）的 steering（中途引导）drain 逻辑先追加持久事件 `steering/message { turn, content, source }`，紧接着下一行就 emit `agent/steering(agent, turn, content, source)`——同一个事实以 fire-and-forget 事件的形式重复发出（`packages/core/agent-loop/src/loop.ts`，`drainSteering`）。它在生产环境中没有任何监听者：唯一的订阅方是一个 agent loop 回归测试，断言 emit 携带了 `source`——而这同一个事实已经由上一行的持久事件记录。

`agent/steering` 以相同的 payload 重复了紧接其前的持久事件 `steering/message`。`agent/queued` 仍保留为纯瞬态信号，因为它在持久化之前触发，覆盖了可能在进入日志前被取消的工作。

Steering 承载真实生产流量——钩子 bridge 的轮次延续决策通过 `inbox.steer()` 注入其理由，最终成为由钩子矩阵预期输出固定的持久 `steering/message` 事件——而这些消费方无一例外都观察持久事件。没有任何内容观察镜像。

## 决策

`agent/steering` 已从 agent 事件分类中移除：包括 `packages/core/agent/src/types.ts` 中的声明（以及其中实时事件 JSDoc 列表对它的提及）、`drainSteering` 中的 emit（当时已无用的 `ctx` 参数也随之移除）、`packages/core/agent/README.md` 中的表格行，以及循环伪代码块（`packages/core/agent-loop/src/loop.ts` 模块文档和 [architecture.md](../../../../docs/architecture.md)）中的 emit 行；Cordis 目录重新生成后不再包含它。唯一的回归测试改为在持久 `steering/message` 事件上固定来源保留行为——所固定的事实存在于日志上。

三份已实现 Agent Note（agent 决策记录）曾说明保留该事件；按照 [implemented/AGENTS.md](../AGENTS.md)，每份记录都已修改并指向本文作为移除记录：包括[边界 Agent Note](2026-06-20-remove-agent-boundary-mirror-events.md) 的保留列表条目、[流分片 Agent Note](2026-07-02-remove-stream-chunk-mirror.md) 的范围条款，以及[事件域语义 Agent Note](../architecture/2026-06-30-event-domain-semantics.md) 的瞬态 emit 枚举。

## 曾考虑的替代方案

### 为什么不保留？

“它是控制信号，不是边界”——但该分类的实际区分是镜像/仅实时，而非控制/边界，并且该事件确实是镜像。希望在入队时收到通知的消费方可以使用 `agent/queued`（及其 steering 标记）；希望在排空时收到通知的消费方，本质上是在要求获知 `steering/message` 被追加的时刻，而 `session/event` 会交付相同 payload 并附带持久性。遭拒绝的[退役轮次中途 steering Agent Note](../../rejected/simplification/2026-06-20-retire-mid-turn-steering.md)所捍卫的是 steering *功能*——`steer()`、持久事件、强制延续——本次移除不会触及其中任何一项。

## 验证

`agent/steering` 拼写只存在于 Agent Note 正文中（本 Agent Note、上方三份已修改 Agent Note，以及已冻结的[遭拒绝 steering 功能 Agent Note](../../rejected/simplification/2026-06-20-retire-mid-turn-steering.md)，其正文记录了它所否决的提案）；目录已重新生成；重新定向的测试在 `steering/message` 上固定来源保留行为。

## 后果

生产环境中没有需要迁移的监听者，两种瞬态通知需求各有归宿：入队时由 `agent/queued`（带 `steering` flag）承载，drain 时由 `session/event` 在持久事件 `steering/message` 落地时承载。
