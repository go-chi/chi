# @deepseek-ai/dsh-session-telemetry

[English](README.md) | 中文

遥测（telemetry）Service Definition 声明 `SessionTelemetrySink` 后端约定，捕获协调器把会话记录传给实现该约定的任意上报 SDK 后端。捕获侧可跟随实时会话事件，也可按需回放权威会话日志前缀。本包调用 `emit()` 后就停止处理：批处理、重试、排队与丢失策略都属于后端自身的 SDK，本包既不规定也不包装。设计依据与被否决的替代方案见[复活 Agent Note](../../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md)、[反馈门控投递](../../../.agents/notes/implemented/feature/2026-08-05-feedback-gated-session-telemetry.md)与[无缓冲反馈回放](../../../.agents/notes/implemented/simplification/2026-08-06-buffer-free-feedback-telemetry.md)。

## 后端约定

`SessionTelemetrySink` 有三个成员：`emit(record)` 必须入队且不能阻塞，因为它会在 `session/event` 或显式权威日志回放期间同步执行；可选的 `flush()` 是轮次结束后的提示，调用方不等待结果，多数后端省略它并使用 SDK 的常规批处理计划；`shutdown()` 排空已入队记录，并在 SDK 停止后结束，dispose（资源释放）会等待它。提供 `flush()` 的实现必须安排并发 flush 与 `shutdown()` 最终排空的先后顺序。`SessionTelemetryBackend` 将此 API 注册在 `sessionTelemetry` 上下文键下：每个上下文只允许一个实现，重复加载会抛出异常。后端以 `live` 或 `on-demand` 捕获构造 `SessionTelemetryCoordinator`，并在自己选择的触发器中调用 `captureSession(session, throughSeq?)`。

该服务还携带必需的 [`SessionTelemetrySharingStatus`](#the-sharing-disclosure) `sharing` 成员：每个后端都必须向面向用户的确认 surface（`/feedback` 命令的确认文本）披露的部署级共享策略。消费方只有在未挂载任何遥测服务时才渲染「未配置」。seam 拥有该词汇（`full` | `feedback-only` | `disabled`），因此任何后端都可以披露策略，而无需依赖 OTel 包。

<a id="the-sharing-disclosure"></a>

## 共享披露

一条已记录的反馈条目的确认文本会报告该会话是否以及如何被共享，读取自已挂载后端的 `sharing`。后端根据其部署配置设置该属性：`full`（每个事件在发生时立即交接）、`feedback-only`（在 `feedback/record` 事件释放其之前的未释放前缀之前，不交接任何内容）或 `disabled`（完全不交接任何内容）。消费方把状态映射为面向用户的文案；披露从不声称投递——交接是非阻塞入队，批处理、重试与丢失策略仍归后端 SDK。

## 捕获点

在 `live` 模式中，协调器的全部注册都经由组合方 fiber 的 effect 完成：`session/created`（收养：记录 header，并经投影从构造边界起回读日志；来自 fork 或恢复的构造函数种子绝不会在 firehose 上再次发出，也绝不会再次导出）、`session/event`（投影、深拷贝、脱敏，再交接；零 I/O）、`session/flush`（转发可选的 `flush()` 提示并返回 void；循环所等待的并行任务绝不能等待遥测）、`session/disposed`（在会话自身的终止边缘捕获该会话的 `shutdown` 运维记录，然后将其退役）、`agent/error`（唯一的实时总线转发；会话事件词汇有意不包含运维错误记录）、一个 dispose effect（捕获每个仍存活会话的 shutdown，再等待后端的 `shutdown()`；失败只发出警告而不抛出），以及对 `ctx.sessions.list()` 的收养扫描（热重载不会重放 `session/created`）。在 `on-demand` 模式中，协调器只注册 dispose effect：`captureSession()` 读取权威日志，直至可选的序列号边界（含边界）；flush 提示与运维事件留在本地。

## 脱敏 waterfall（瀑布式事件）

每条记录在投影后立即经过 `sessionTelemetry/record` waterfall，这是 Service Definition 的脱敏扩展点。本包自身不带任何规则：最内层的 `next()` 原样透传记录，因此未挂载监听器时，记录以捕获时的原样到达后端；导出数据能干净到什么程度，恰恰取决于部署方挂载了什么规则。监听器通过变换 `next()` 的返回值来堆叠；不调用 `next()` 就返回，即替换其下方的全部逻辑；抛出异常的监听器会在协调器的隔离范围内以 fail-closed 方式拦下这一条记录。实时捕获在追加时运行 waterfall；按需捕获则在回放权威日志时使用当时挂载的规则运行 waterfall。脱敏只作用于外发副本；权威会话日志永不改写。

## handoff 游标

一个模块作用域的 `WeakMap<Session, seq>` 记录每个会话已交接（而非已投递）的最高 seq。实时捕获在追加时推进游标；按需捕获只有在 `captureSession()` 将请求的前缀交给后端时才推进游标。未捕获的前缀只留在权威日志中，因此协调器重载不会增加遥测自有的恢复状态。回放时，协调器只重新交接游标之后的事件（游标及其之前的事件仍用于重建分片投影状态）；游标缺失时安全退化为从会话构造边界起的重新交接（`Session.firstLiveSeq`，对在本进程中诞生的会话即 seq 0），由接收端基于 `(session.id, event.seq)` 的去重吸收。构造函数种子绝不会再次导出：恢复会话的历史已由上一个进程以同一 id 发出，fork 继承的前缀则位于父会话的流中（接收端基于 `session.parent_id` + `session.seed_length` 拼接）。由此接受的代价与至多一次（at-most-once）投递一致：恢复不会回填上一个进程未能投递的记录；有回填要求的部署需要的是已推迟的 outbox，而不是回放。这是对「注册即 effect」纪律的一次有意且范围极窄的例外：条目随其会话消亡，值是单调水位线，丢失它绝不是错误。

## 固定分片投影

每个 `(turn, step)` 只发出第一条 `assistant/chunk`；其余分片在捕获时丢弃，且绝不推进游标。这一条分片就是「流已开始」的信号：`step/start`、首分片是否存在、`assistant/message` 是否存在，加上 `turn/end` 的原因，无需分片流量即可区分「请求从未开始」与「流中途夭折」，首个 token 延迟（time-to-first-token）也仍然可以计算。分片省略使导出流中的 `seq` 缺口成为常态：缺口绝不是丢失信号。其余所有事件类型都会完整透传，包括本包从未听说过的插件所合并的事件类型。

## 逻辑记录

`SessionTelemetryRecord` 包含：`channel`（`ledger` | `ops`）、`time`（epoch 毫秒）、`severity`（预先映射好的严重级别：`tool/result.isError`、`turn/end` 的错误原因与 `agent-error` 映射为 ERROR，其他已捕获记录映射为 INFO，而 `sessionTelemetry/record` 策略可以指定 WARN）、只含身份信息的 `attributes`（`session.id`、`event.type`、`event.seq`，header 中存在时再加 `session.cwd`/`session.parent_id`/`session.seed_length`），以及作为 `body` 的完整深拷贝 `event.data`，且以脱敏后的内容为准。运维记录携带 `sessionTelemetry.op`（`agent-error` | `shutdown`）和 `session.id`，并刻意不带 `event.seq`/`event.type`：它们是用来告警的信号，不是用来累加的条目；`agent-error` 会把任意抛出值规范化为稳定的 `{ name, message }` 记录主体。交接之后的投递由后端 SDK 负责；重复仍然可能出现（无游标的重新收养、SDK 重试），因此接收端基于 `(session.id, event.seq)` 去重。

## 模型体验

无。本包只观察会话流，并把脱敏后的副本交给上报后端；它绝不向模型请求贡献任何内容。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **尽力而为的投递**：游标标记的是已交接而非已投递；在重载窗口内被拆除的会话无法重新收养；崩溃时留在后端队列中的内容会丢失。持久化 outbox（spool、每 sink 游标、at-least-once）推迟到有部署方提出明确的崩溃丢失要求时再实现；见[复活 Agent Note](../../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md)。
- **不内置脱敏规则**：未挂载 `sessionTelemetry/record` 监听器时，记录以捕获时的原样离开进程，包括文件内容或命令输出中内嵌的任何凭据；向共享 collector 导出的部署方自行负责其规则集。
- **按需脱敏使用当前状态**：未捕获的事件只存在于权威会话日志中。后续的 `captureSession()` 会使用当时挂载的策略，深拷贝并脱敏其当前值；不存在捕获时的遥测快照或持久化的捕获前 spool。
