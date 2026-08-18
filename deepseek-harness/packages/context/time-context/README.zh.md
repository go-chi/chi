# @deepseek-ai/dsh-time-context

[English](README.md) | 中文

可选的持久上下文，包含当前带时区时间、附加到当前开放请求的浏览器时区，以及在模型请求准备期间采样的经过时长。默认组合不启用它；Schedule Web overlay 会挂载它，使模型可以按用户的浏览器时区解释未明确限定时区的日期和时间。决策记录：[持久 time-context Agent Note](../../../.agents/notes/implemented/feature/2026-07-16-durable-per-step-time-context.md)。

## 配置

```yaml
- id: time-context
  name: '@deepseek-ai/dsh-time-context'
  config:
    timeZone: Asia/Shanghai  # optional fallback when the request has no unique browser zone
    refreshIntervalMs: 60000 # optional; omit or set to 0 for every eligible attempt
```

当当前开放轮次只包含一个经 Host 校验的浏览器时区时，使用该请求本地时区格式化时间戳。浏览器来源信息缺失或混杂时，`timeZone` 提供显示回退；省略它则会在插件加载时解析一次 Node 进程时区。Node 遵循 `TZ`，每个显式回退值都经 `Intl.DateTimeFormat` 校验。

`refreshIntervalMs` 必须是非负安全整数。省略或设为 `0` 时，会为每个信号尚未中止且将进入步骤的合格 pre-step 添加上下文。正数值只会在会话没有更早的 time-context 注入、挂钟时间倒退，或自最新注入起已经过至少相应毫秒数时添加上下文。

## 请求时区归属

浏览器会为每条提示词采样 `Intl.DateTimeFormat().resolvedOptions().timeZone`。Host 校验并规范化该值，再将其绑定到确切的持久 `user-rpc` 消息来源。Time-context 只检查当前开放轮次中的这些来源：唯一一个时区可解析请求，多个时区记为 `mixed`，没有时区则记为 `unavailable`。它不会读取或修改会话标头、连接状态或 Schedule 记录。

解析后的指令告诉模型，把未明确限定时区的日期和时间解释为该浏览器时区。来源信息为 mixed 或 unavailable 时，模型会收到要求用户澄清的指令。这是自然语言上下文，并非另一个包边界上的输入默认值：接受本地日历字段的工具仍自行负责其显式时区要求。

## 时序语义

该插件会前置一个 `agent/pre-step` 监听器，并先行委托下游。需要注入且下游决策进入步骤时，它会向返回批次追加一条带来源的 `UserMessage`。AgentLoop 在 `step/start` 之后、请求派生之前记录最终批次。决策被拒绝、监听器失败或信号已经中止时，不会记录任何内容。

每个读数都使用确切的快照来源 `{ kind: 'plugin', plugin: 'time-context', form: 'snapshot', sections: [{ name: 'time-context', text: <same text> }] }`。`./invariant` 配套模块会校验该形状，根据原始 `user-rpc` 消息重新派生当前轮次的浏览器策略，并检查时间戳时区与经过时长基线。

正数间隔调度会扫描原始持久会话事件，查找最新一条归因于插件的消息，其中包括已被压缩（compaction）遮蔽的读数。因此，它无需进程本地缓存也能在恢复后继续生效。正数间隔可以有意让后续请求复用现有历史，而不添加新读数；Schedule Web overlay 会省略该间隔。

第 1 步从最新一条在其之前持久化的用户、助手或工具结果消息起测量。为该步骤拟议的提示词尚未追加。后续步骤从同一轮次中前一个 time-context 事件起测量。缺少基线时报告 `unavailable`，挂钟时间倒退时将经过时长限制为零。

读数记录的是已进入的步骤，不是已完成或已传输的请求。后续准备失败时，该读数可能留在历史中。消息会保留在派生会话历史中，直到压缩将其遮蔽；`request/header` 不含 time-context 状态，请求重建会使用每个 `step/start` 之后的完整持久表层前缀。

## 模型体验

### 准备期时间上下文

#### 模型看到的内容

每条注入消息包含三行。`<timestamp>` 是带数字偏移和 IANA 时区、形如 ISO 的时间戳；持续时间使用紧凑的整秒单位。

##### 第一步

```markdown
Time sampled while preparing turn <turn>, step 1: <timestamp>
Browser time zone for this request: <iana-zone-or-mixed-or-unavailable-policy>.
Elapsed since the preceding model-visible message: <duration-or-unavailable>.
```

##### 后续步骤

```markdown
Time sampled while preparing turn <turn>, step <step>: <timestamp>
Browser time zone for this request: <iana-zone-or-mixed-or-unavailable-policy>.
Elapsed since the preceding step context: <duration-or-unavailable>.
```

#### Token 影响

每个读数都会累积，直到压缩将其遮蔽。正数间隔会减少新增读数；省略或设为 `0` 时，每次合格的准备尝试都会添加一条。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **仅限提示词来源信息**：浏览器时区上下文用于指导自然语言解释，但不会悄然填入另一工具所要求的时区字段。
- **混合轮次会询问**：如果同一个开放轮次包含来自不同浏览器时区的提示词，模型会收到要求澄清的指令，而不会猜测哪个时区拥有未限定的时间。
- **回退值不代表用户权威**：浏览器来源信息缺失或混杂时，配置或进程时区用于格式化时钟，但面向模型的策略仍要求澄清。
- **整秒显示**：时间戳与持续时间省略亚秒精度，尽管持久事件时间保留毫秒。
- **压缩之间的历史成本**：省略或设为 `0` 时，每次合格尝试都会保留一条读数；正数间隔可以降低但无法消除该成本，也可能使后续请求缺少新鲜的浏览器时区指导。
