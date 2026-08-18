# Agent Note: 停止将 token 流镜像为 agent 事件

Status: implemented
Archived: 2026-07-27

[English](2026-07-02-remove-stream-chunk-mirror.md) | 中文

## 问题

agent loop（智能体循环）将模型的每个 token delta 同时记录为持久的 `assistant/chunk` 会话事件，并发射一个携带相同数据的并行实时 `agent/stream-chunk` Cordis 事件。在 `packages/core/agent-loop/src/agent.ts` 中，二者仅相隔一行：

```ts ignore-check
const chunkEvent = session.append('assistant/chunk', { turn, step, chunk })
chunkSeqs.push(chunkEvent.seq)
ctx.emit('agent/stream-chunk', agent, turn, step, chunk)   // ← the mirror
```

- 持久事件：`assistant/chunk: { turn, step, chunk }`。
- 实时发射：`agent/stream-chunk(agent, turn, step, chunk)`——相同的 `StreamChunk`，相同的 `turn`/`step`。

实时发射相比会话事件唯一多出的东西是实时的 `Agent` 句柄，而唯一的消费方直接丢弃了它（其处理函数签名为 `(_agent, _turn, _step, chunk)`）。

这与[移除边界镜像](2026-06-20-remove-agent-boundary-mirror-events.md)为轮次/步骤边界消除的重复相同：消费方面对同一持久事实的两个真源，每次变更都必须同时触及两者。该 Agent Note（agent 决策记录）没有把分片流一并纳入，而是推迟处理（“`assistant/chunk` 持久化仍承载关键约束，所以以后可以将分片流作为镜像评估，但那是一项独立决策”）。本 Agent Note 就是那项独立决策。

推迟所依赖的前提已经明确：分片持久化是权威的，且将保留。停止持久化分片、仅保留瞬态实时流事件的提案已被[否决](../../rejected/simplification/2026-06-20-assembled-assistant-messages-only.md)——高保真回放、部分失败的流以及快照回放都依赖持久化的 `assistant/chunk` 序列。因此 `session/event` 上的 `assistant/chunk` 是持久的、承重的 token 流，而 `agent/stream-chunk` 是它的纯冗余镜像。

## 决策

从 agent 事件分类体系中移除 `agent/stream-chunk`。token 流通过 `session/event` 以 `assistant/chunk` 的形式读取——持久化与回放已经使用的正是同一个序列。`session/event` 是唯一的实时 transcript（文本记录）流（assistant 分片、轮次/步骤边界、工具活动、todo）。

**消费方。** 持久化、回放和交互式渲染器直接消费权威的会话流。[仅面向自动化的 ACP（Agent Client Protocol）桥接层](2026-07-23-acp-automation-only-protocol.md)发出已提交的 `assistant/message` 文本而非原始分片，因此两种事件它都不需要。没有生产消费方需要一个 `Agent` 优先的 token 镜像。

## 范围

移除：`agent/stream-chunk`。

未触及：
- `assistant/chunk`（持久会话事件）——权威 token 流，原样保留。本 Agent Note 移除的是实时镜像，而非持久化（移除持久化的提案已单独遭到拒绝——见上文）。
- `agent/steering`——本决策未触及（它是控制信号，不是 token 流）。其持久孪生事件是 `steering/message`，镜像发射由其自身的后续 Agent Note 移除：[移除 `agent/steering` 镜像发射](../../archived/simplification/2026-07-04-remove-agent-steering-mirror.md)。
- `agent/status`、`agent/error`、`agent/created`/`agent/disposed`、`agent/queued`、`agent/session-start`——生命周期/控制事件，不是 transcript 数据，也没有持久副本。

## 曾考虑的替代方案

**移除持久化、仅保留瞬态实时流**——反向裁剪，已被[单独否决](../../rejected/simplification/2026-06-20-assembled-assistant-messages-only.md)：高保真回放、部分失败的流以及快照回放都依赖持久化的 `assistant/chunk` 序列。在此前提确定后，实时发射才是配对中冗余的那一半。

## 后果

插件不能再从 `Agent` 优先事件观察 token 增量。它需要订阅 `session/event`、过滤 `assistant/chunk`，并在需要时通过 `ctx.agents.get(session.id)` 直接查找对应的实时 handle。没有生产消费方需要在分片时刻取得实时 `Agent`；这与移除边界镜像所作的取舍相同，均可接受。
