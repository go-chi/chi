# @deepseek-ai/dsh-message-feedback

[English](README.md) | 中文

本包提供由 Host 拥有、针对单条已完成 assistant 消息的可编辑反馈。它注册 `ctx.messageFeedback`，在 storage-domain 中为每个 Session 持久化一条绑定生命周期的伴随记录（sidecar），并发布 Host `messageFeedback.list`、`messageFeedback.put` 与 `messageFeedback.delete` 一元 Remote 契约。它与不可变的 Session 级 `feedback/record` 事件相互独立，不执行遥测交接。[消息反馈伴随记录 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-10-message-feedback-sidecar.md)拥有其设计边界。

公开的请求、值、版本与失败类型从包根入口及 `@deepseek-ai/dsh-message-feedback/types` 导出；其源码为 [`src/types.ts`](src/types.ts)。

## 配置

| 键 | 含义 |
|---|---|
| `maxNoteBytes` | 必填正 safe integer：一条可选备注的最大 UTF-8 字节长度。 |

备注必须包含至少一个非空白字符，但通过校验的文本按原样存储，不会 trim。省略 `note` 表示目标值不含备注，因此 version 匹配的实质 `put` 会清除已有备注。备注校验早于 Session 查找，因此即使 Session 不存在，也可能在不访问持久化的情况下返回 `note-blank` 或 `note-too-large`。

```yaml
- id: message-feedback
  name: '@deepseek-ai/dsh-message-feedback'
  config:
    maxNoteBytes: 8192
```

服务注入 `storageDomain`、`sessionPersistence` 与 `sessions`。其持久存储域为 `message_feedback`，其中 `sessions` 表按 `SessionId` 每个一行。

## 数据、生命周期与持久性

`MessageFeedbackItem` 包含 `messageId`、`rating: 'positive' | 'negative'`、可选 `note`、只能做相等比较的 opaque `version`，以及由 Host 分配、以 Unix 毫秒表示的 `createdAt`/`updatedAt` 时间戳。实质更新保留 `createdAt`、替换 `version`，并保证 `updatedAt` 不倒退。`list` 按首次创建顺序返回新的不可变快照；更新条目时保留其位置，删除后再创建则追加为新条目。

每条存储行都携带检查所得 Session header 身份 `{createdAt, cwd}`。不匹配按不存在处理：`list` 返回空 `items` 数组，`delete` 返回已不存在的后置条件，`put` 可以用绑定当前身份的新行替换陈旧行。这会在复用的 `SessionId` 具有不同 header 身份时形成隔离。fork 使用独立的 Session 身份，不复制反馈伴随记录。

`SessionPersistence.inspect()` 提供 cold-safe 观测，不发布或恢复 Agent，也不提交 cold repair。对于没有 live owner 的 Session，系统先用 `listSnapshots()` 判定明确不存在；已进入目录的 Session 若 `inspect()` 失败，仍属于基础设施故障，不会被猜测成 `session-not-found`。`put` 只接受具有指定 `MessageId` 的非空、append-origin `assistant/message`；replacement-origin 消息、仅承载 usage 的空 assistant 记录与非 assistant 记录都返回 `target-not-found`。

初步校验后，`put` 在写入伴随记录前建立 durability barrier。身份匹配的 live Session 先通过权威 `ctx.sessions.flush` checkpoint 提交，随后 live 与 cold 路径都会通过 `SessionPersistence.readFrom` 从序列零做物理复读。之后再次校验所得观测的 header 身份与目标。缺少 flush 参与方、身份变化、目标消失或物理读取失败都会阻止伴随记录提交，因此持久反馈绝不会先于其持久目标消息。

message feedback 不是 Session 日志内容或 Session 投影。它不发出 `feedback/record` 事件，不进入模型历史，也不触发 `FEEDBACK_ONLY` 遥测释放。

## 服务与 Host Remote 契约

`TypertRemoteService` 与 `@Remote` 将 `MessageFeedbackService` 的同三个方法发布出去；Host endpoint 名称为 `messageFeedback.list`、`messageFeedback.put` 与 `messageFeedback.delete`。每个方法都返回判别式业务 union：`{ ok: true, value }` 或 `{ ok: false, error }`。存储、损坏或缺少 durability listener 等操作故障会产生 reject，不会被误标为业务错误。

| 方法 | 请求 | 成功 `value` | 拒绝的 `error.code` |
|---|---|---|---|
| `list` | `MessageFeedbackListRequest { sessionId }` | `MessageFeedbackListValue { items }` | `session-not-found` |
| `put` | `MessageFeedbackPutRequest { sessionId, messageId, rating, note?, ifVersion }` | 已提交的 `MessageFeedbackItem` | `session-not-found`、`target-not-found`、`version-conflict`、`note-blank`、`note-too-large` |
| `delete` | `MessageFeedbackDeleteRequest { sessionId, messageId, ifVersion }` | `MessageFeedbackDeleteValue { absent: true }` | `session-not-found`、`version-conflict` |

`MessageFeedbackVersionConflict` 返回权威 `current` 条目；条目不存在时为 `null`。调用方无需额外执行 `list`，即可协调当前 rating、note 与 version。`MessageFeedbackNoteTooLarge` 同时返回 `maxBytes` 与 `actualBytes`。客户端 Remote 聚合尚未挂载生成的客户端 contribution；Host 调用方无需该客户端组装即可使用 service/Remote 契约。

## Compare-and-set 与幂等性

`ifVersion: null` 表示仅当条目不存在时才创建；已有条目的每次请求都必须与其当前 version 完全一致，即使目标值已经相同、不会产生实质更新。检查按消息而非按 Session 进行，因此修改一个条目不会与另一个条目冲突。每次实质创建或更新都会分配新的 opaque UUID token，防止陈旧写入穿过 ABA 值循环。

携带匹配 version 的无变化请求会返回已存条目，version 与时间戳均不变。成功响应丢失后，使用旧 token 重试会得到 `version-conflict.current`；调用方无需额外读取，即可把权威当前值与目标值比较。条目已不存在时，`delete` 忽略 `ifVersion`；成功后始终返回稳定的 `{ absent: true }` 后置条件。

按 Session 划分的 promise 队列覆盖检查、持久性校验、伴随记录读取、比较与整行写入。这些语义会串行化经由同一服务实例的并发变更；storage-domain 自身没有跨进程条件写。

Plugin disposal 会先关闭变更接纳，排空已进入各个 Session 队列的所有操作，然后才关闭 storage domain。disposal 开始后提交的变更会以生命周期故障拒绝，不会进入正在关闭的 domain。

## 模型体验

### 本地消息反馈状态

#### 模型看到的内容

无。`ctx.messageFeedback` 不注册工具、提示词段落、模型可见上下文或 Session 事件；除非另一个具有独立文档的 Consumer 显式公开反馈，否则它只留在 Host 拥有的伴随记录中。

#### Token 影响

为零。本包的请求、结果、评分、备注、时间戳或失败都不会进入模型请求。

#### KV Cache 影响

相互独立。读取或变更消息反馈不会触碰模型请求前缀，也不会使本可复用的提供方缓存条目失效。

## 已知局限与延后工作

- **缺少客户端聚合与 UI**——Host Remote 契约已经发布，但客户端 Remote 聚合 contribution 与任何 UI 消费方由各自边界负责并保持延后。
- **Compare-and-set 仅限单进程**——按 Session 划分的队列只串行化一个服务实例；storage-domain 不提供跨进程条件写，因此多个 Host 进程写入同一存储根目录时仍可能丢失更新。
- **没有持久 Session 删除级联**——Session persistence 没有删除接口，且 `session/disposed`/`host/session-removed` 表示 detach 而非持久删除。因此服务会保留空行，并可能在带外移除日志后留下遗留行，而不会在 detach 时删除仍有效的反馈。
- **Detach/catalog retirement 窗口**——请求若恰好落在 live detach 之后、persistence catalog 物化 header 之前的极短窗口，可能收到 `session-not-found`；调用方应在 retirement materialization 后重试。
- **Header 身份不是内容指纹**——只有 `{createdAt, cwd}` 不同时才能识别复用；本契约无法区分保留相同 header 身份的克隆日志。
- **调用方边界受信任**——`list`/`put`/`delete` 不携带已认证的 actor 或审计身份。在加入授权与归属信息前，部署方必须只通过受信任或另行认证的边界暴露 Host gateway。
- **目录与行边界**——由于 persistence 没有按 id 读取元数据的操作，cold 请求会扫描完整的 Session snapshot 目录。`maxNoteBytes` 只限制单条备注，单个 Session 行的条目数和聚合保留字节尚无上限；按索引读取元数据和由部署决定的行边界，延后到具体消费方明确策略时处理。
