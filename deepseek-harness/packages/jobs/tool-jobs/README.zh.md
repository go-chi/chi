# @deepseek-ai/dsh-tool-jobs

[English](README.md) | 中文

`ctx.jobs` 的面向模型控制器：三个与 kind 无关的工具、完成通知和一个后台工作提示词区段。加载该插件会附加 `ctx.jobs.start()` 所要求的控制器。

## 工具

- `job_output(job_id, wait?, timeout_ms?)` 默认以非阻塞方式读取。流任务只返回下一个增量；最终输出任务在终止后返回结果。每个响应都以 `[status: ...]` 结尾。`wait: true` 最多等待到配置上限，超时时仍让运行中的任务保持存活。
- `job_list()` 以 `<id> [<kind>] <status> — <label>` 返回调用方可见的任务。
- `job_kill(job_id, reason?)` 立即请求取消并转发已记录的原因。终止任务返回非消费式快照。

三个工具都使用通用 UI 卡片：output 和 list 使用 `read`，kill 使用 `execute`。

它们的规范值依次为 `{ text, job }`、`PublicJobSnapshot[]` 和 `{ outcome: 'cancellation-requested' | 'already-finished', job }`。公共快照携带 id、kind、label、status/detail 及开始／结束时间；它有意省略 `ownerSession` 和内部 `reported` 通知位。原生 renderer 保留上述状态与确认文本。

当生产方提供 `outputLimitBytes` 时，`job_output`、针对已终止任务的 `job_kill` 和完成通知会在添加状态或通知文本后，对完整的原生 UTF-8 结果施加上限。只要能够容纳，读取就会保留输出尾部与控制后缀；有界完成通知则先为 `background job <id>` 和 `job_output` 收集指令预留空间，再把剩余字节用于可变的 kind、label、status、detail 与截断标记。一个前置 pre-execute 监听器会在策略运行前捕获调用方可见任务；每个任务控制定义的 final-content 回调会把其生产方上限应用到单文本拒绝、短路、规范化工具或流水线失败、替换和阻止；结构化多块策略结果保持自身形状。已有的生产方截断标记会复用，不会重复添加。省略该字段的生产方保留现有的无界控制器行为。

## 完成通知

一项尚未报告的完成会把 `background job <id> (<kind>: <label>) finished [status: ...]. Read its output with job_output.` 交付给确切所有者。应用上限时，即使采用 PTY 支持的 64 字节下限，稳定 id 前缀和收集命令的优先级也高于可变 label/detail，因此通知仍可操作。kill 或针对已终止任务的 read/wait 会把交付标为已报告并抑制重复通知；排空 owner 或服务的 teardown 取消同样如此。

由哪条通道承载取决于所有者当时在做什么。繁忙的所有者走注入：通知进入 next-step inbox，而该 inbox 尚有内容时 turn 无法结束，因此同时结算的多个任务只花掉一步，而不是各占一轮。空闲的所有者则被 follow-up 唤醒，因为无人领取的待发通知等于模型永远不会知道的完成。`completionDelivery: quiet` 让空闲所有者也留在注入通道上，确定性 transcript 需要的正是这一点。

唤醒是有界的。每个所有者最多可通过唤醒开启 `maxConsecutiveWakes` 轮，此后的通知降级为注入；领取任何用户撰写的消息都会恢复该预算。设界是因为这条链会自激：被唤醒的一轮可能启动某个后台任务，而它的完成又会唤醒同一个所有者。本插件自己排队的通知永远不会补充它刚花掉的预算。

一个宿主注册表可能承载本插件的多份挂载——每个 agent preset 一份。注册表会把每次结算路由给所有者 scope 链所能抵达的监听器，因此某个 preset 下的挂载永远看不到另一个 preset 的 agent，无论挂载了多少 preset，一个 agent 每次完成都只读到一条通知。同一套路由也决定本挂载的控制器服务哪些 agent：组合中未加载 `tool-jobs` 的 agent 根本无法启动后台工作。

## 配置

| key | 默认值 | 含义 |
|---|---|---|
| `waitTimeoutMs` | `30000` | `wait: true` 省略 `timeout_ms` 时使用的等待时间 |
| `maxWaitTimeoutMs` | `600000` | 模型所给等待时间的上限 |
| `completionDelivery` | `wakeup` | `wakeup` 为空闲所有者开启一轮；`quiet` 让通知继续待领 |
| `maxConsecutiveWakes` | `3` | 一个所有者可由唤醒开启的轮数，超出后通知降级为注入 |

默认值高于上限时，插件会在加载时失败。

## 模型体验

### 系统提示词

#### 模型看到的内容

该插件注册 scope 中的每次请求都包含以下指引。按 agent（智能体）scope 过滤工具时，可能会隐藏工具，却不会移除独立注册的提示词区段。

##### 后台任务指引

```markdown
Track every background job id you start. You are notified in-session when a job finishes — do not busy-poll or sleep on one; keep working on independent steps and do not duplicate a running job's work. Before giving a final answer, collect every still-relevant job with job_output (set wait: true only when you are genuinely blocked on it), and job_kill jobs that stopped mattering.
```

#### Token 影响

激活期间，每次请求都会产生少量固定的输入 token 开销。

#### KV Cache 影响

只要插件 scope 与指引文本不变，前缀就保持稳定。激活或释放可能使从该提示词区段起的复用失效。

### 工具 schema

#### 模型看到的内容

该工具集可见时，会看到生成的 [`job_output`、`job_list` 和 `job_kill` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-jobs)。

#### Token 影响

工具可见时，每次请求都会产生固定的 schema token 开销。

#### KV Cache 影响

只要工具定义与可见性不变，前缀就保持稳定。注册生命周期或 scope 限制可能使从第一个发生变化的 schema token 起的复用失效。

### 结果与通知

#### 模型看到的内容

读取会返回输出或 `(no new output)`，随后是 `[status: <status>]` 和可选 detail。空列表返回 `(no background jobs)`。kill 返回 `requested cancellation of job <id>` 或现有终止状态。尚未报告且有 owner 的任务完成时使用上述通知。

#### Token 影响

结果与通知在压缩（compaction）前保留于父级历史。流读取不会重复已消费的输出；生产方提供的 `outputLimitBytes` 会限制每次完整读取或通知。在 `wakeup` 下，抵达空闲所有者的通知还会额外买下一次用户并未要求的模型请求，其数量按所有者由 `maxConsecutiveWakes` 封顶；抵达繁忙所有者的通知则只是给它已经在支付的那一轮加一步。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV-cache 条目失效。

## 已知限制与暂缓事项

- **落在 driver 退休窗口内的结算仍会让通知搁浅**：在轮次循环最后一次检查 inbox 与 driver 提交 idle 相位之间，所有者读起来仍是繁忙，因此通知走注入且无人唤醒。steer 有同样的洞；堵上它属于 `agent-loop`。
- **已花掉的唤醒预算不会随时间恢复**：只有用户撰写的输入才能补充，因此预算耗尽的无人值守 agent 要等到其他原因开启下一轮时才收走剩余通知。
- **待领于空闲所有者的通知无法在该所有者释放后存活**：释放时的取消会清空未领取的 inbox，日志保留插入/取消这一对作为记录。
- **流读取只有单一消费方**：独立观察者需要另一套运行时 API。
- **无 owner 的任务没有会话隔离**：外部调用方必须提供策略或避开这些任务。
