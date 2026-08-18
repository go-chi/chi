# @deepseek-ai/dsh-session-persistence

[English](README.md) | 中文

会话持久化是一项能力 seam。抽象的 `SessionPersistence` 服务（`ctx.sessionPersistence`）是其 Service Definition。它要求持久化后端持久存储、重新加载和列出会话，但不规定具体存储实现。该 seam 采用与 `dsh-shell` 相同的角色划分（见[能力 seam](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)）：本包负责 Service Definition，同级包负责 Service Provider，Consumer 注入该服务。

持久化单元就是现有 `SessionEvent`（事件溯源模型：日志是唯一真源），因此不存在另一套并行的「持久消息」类型。不属于可回放对话状态的元数据（格式版本、cwd、血缘、种子边界、origin、委托深度）作为 `SessionHeader` 单独传输，该类型归 `dsh-session` 所有，并在此重新导出。

## 服务 API（`ctx.sessionPersistence`）

| 方法 | 约定 |
|---|---|
| `locate(meta): SessionLocation \| undefined` | 在不执行 I/O 或实体化的情况下解析每个会话的绝对产物目标。没有独立本地产物的后端返回 `undefined`。 |
| `supportsRawArtifacts: boolean` | 明确说明该后端是否为每个会话暴露一份逐字工件。Consumer 在调用 `readRaw` 前检查此能力；`false` 并不表示会话缺失。 |
| `readRaw(id, signal?): Promise<SessionRawArtifact \| undefined>` | 读取受支持后端自身的逐字工件文本；只解码物理编码，绝不从事件重建。`undefined` 仅表示所请求工件缺失；不支持的后端会拒绝。 |
| `create(meta): Promise<void>` | 注册新会话元数据。可以将物理写入延迟到第一次 `append`（延迟实体化）。 |
| `append(id, events): Promise<void>` | 持久保存一个批次。仅追加；任何修复后，第一个事件 `seq` == 已存储 next-seq；非 JSON 可序列化数据会被拒绝，并命名违规类型。 |
| `prepare(id, signal?): Promise<SessionPreparation>` | 预留恢复所使用的那个未发布 Session。协调器会尽可能复用之前的检查结果、提交待处理恢复，并在 dispose（资源释放）时将未发布 reservation 释放回有界缓存。 |
| `load(id): Promise<{ meta; events }>` | 转换同一格式版本中受支持的旧记录后，返回不可变、平衡的逻辑日志，并提交冷恢复。实时 load 先 flush 其快照，并在轮次开放时拒绝；冷 load 保留中断的最终轮次，并用合成 `tool/result`/`step/end?`/`turn/end {interrupted}` 事件持久关闭它。只丢弃撕裂尾部碎片；已提交损坏和格式错误的记录以 `SessionPersistenceCorruptionError` 拒绝，不支持的格式 `version` 或本构建不认识且信封未带 `ignorable` 标记的事件类型以 `SessionFormatUnsupportedError` 拒绝，消息说明拒绝方向，并在后端为每个会话保留独立文件时给出原始日志路径。 |
| `inspect(id, signal?): Promise<{ meta; events }>` | 返回已经升级、验证和深度冻结的逻辑视图，但不提交恢复或发布 Session。冷视图会获得仅存在于内存的合成恢复 closer，物理撕裂尾部保持不变；实时状态下的视图则是当前不可变快照，可能包含开放的轮次。基于协调器的实现会在有界 LRU 中保留该冷状态下未发布的 Session 本身，供后续 `prepare` 使用，但已存储修订值变化后会丢弃并重新读取。同 id 检查共享进行中的读取。 |
| `readFrom(id, fromSeq, signal?): Promise<{ meta; events }>` | 返回 `seq >= fromSeq` 的有效已存储事件，不进入 preparation 缓存、不截断、不合成 closer，也不发布协调器状态。`fromSeq` 达到或超过已存储末尾时返回空事件列表；负数或非安全整数 `fromSeq` 会被拒绝。可寻址后端（SQLite）只读后缀，除非转换受支持的旧记录需要读取更早的记录；顺序后端（JSONL）解析整个产物并向前跳过。未知类型拒绝遵循同一读取方式：寻址读取只检查返回的后缀，顺序回退路径还会拒绝窗口以下的未知必需事件。供 checkpoint 消费方只应用已存序号之后的事件。 |
| `list(signal?): Promise<SessionHeader[]>` | 从元数据轻量列出，不解析完整日志。可选信号取消后端列表工作。零事件延迟实体化会话不在 `list` 中。 |
| `listSnapshots(signal?): Promise<SessionPersistenceSnapshot[]>` | 返回轻量元数据和每份日志一个不透明、带品牌类型的修订值，不加载事件日志。日志及其后端存储不变时，修订保持相等；append 或变更性 load 修复后会改变；不会仅因两个存储使用相同本地计数器而冲突。可选信号请求取消后端发现工作；第一方后端会先等待所有已启动的列出工作结束，再予以拒绝，因此调用返回拒绝时，相关工作已完全停稳。 |

## 每个后端必须遵守的不变量

- **仅追加；崩溃轮次会被关闭，而非截断。** 已 flush 事件绝不重写。崩溃可留下未关闭最终轮次，其事件真实且可能很大；`load` 保留它们，并持久追加合成 closer（为每个未获回答的 assistant 调用添加一个带风险分类错误的 `tool/result`，再添加 `step/end?`+`turn/end {interrupted}`），以平衡日志，并确保重新载入的历史仍是有效的提供方 transcript（文本记录）。只丢弃从未完整写入的撕裂尾部碎片。
- **连续 seq。**`load` 拒绝日志中间的 `seq` 缺口/解析错误；`append` 的第一个 `seq` 必须等于已存储 next-seq。
- **JSON 可序列化数据。**`append` 通过共享单遍无损 JSON 边界实体化每个直接/回放批次。活动 `Session` 事件已深度冻结，但写入协调器仍将每个事件复制到持久化自有缓冲区。
- **持久性。**`append` 只在批次持久后返回。

## 写入协调器

`PersistenceCoordinator` 负责每 id 状态和串行化、每个活动会话各自的有界写入 controller、延迟实体化、崩溃尾部修复、会话接管和完全停稳的 dispose。第一方后端组合一个协调器，实现小型 `PersistenceBackend` 存储钩子接口，并委托其有状态方法。因此 JSONL 和 SQLite 共享生命周期正确性，同时保留不同存储原语；见[协调器 Agent Note](../../../.agents/notes/implemented/architecture/2026-06-18-shared-persistence-write-coordinator.md)、[flush controller 简化](../../../.agents/notes/implemented/simplification/2026-07-23-collapse-persistence-flush-state.md)和[有界批处理决策](../../../.agents/notes/implemented/architecture/2026-08-08-bounded-session-persistence-write-batching.md)。

每个 `session/event` 将事件复制到会话 controller。第一个待处理事件会开启固定批处理窗口；后续事件会加入该批次，但不会重置截止时间。配置的 `writeBatchMaxDelayMs` 只限制这段有意等待，而不限制事件循环、初始化、串行化操作或后端延迟。写入期间接纳的事件会形成一个新的有界批次。`session/flush` 会取消等待，并作为共享的完全停稳屏障，排空屏障运行期间接纳的事件。后台写入失败只记录一次日志，保留顺序不变的批次，并暂停自动重试；新事件会开启新的固定窗口，而显式 flush 或后端拆卸会立即重试，并在失败再次发生时向调用方暴露失败。

崩溃修复只适用于冷状态。对于已有活动会话的 id，`load(id)` 为权威内存日志制作快照，等待该快照持久，并只在平衡时返回；活动会话中开放的轮次会被拒绝，而不会收到合成中断 closer。对于冷 id，检查只读取、验证、冻结并构造一次未发布 Session；只有来源修订值仍然是当前值时，重复检查才会复用该对象图。`prepare(id)` 在修复前执行相同校验，预留该 Session 本身，提交任何待处理的撕裂尾部或中断轮次修复，并将其返回用于发布。HMR（热模块替换）接管通过 `loadStored` 读取，应用协调器 cwd 检查，并绝不关闭活动轮次。

后端读取会在验证当前记录前，转换同一格式版本中明确受支持的旧记录。消息标识机制引入前的消息会获得确定性的 id `legacy-message:<session-id>:<event-seq>`；工具结果的内容替换会继承其目标导入后的 id。react-loop 引入前的 `turn/start` 会移除过时的 trigger，已移除的 steering（中途引导）事件 `steering/message` 会转换为同一条带标识的 `user/message`；旧版 `turn/end` 会映射终止原因，但不会虚构旧记录中没有记载的调用方。协调器对 `load`、`inspect`、`readFrom`、无所有者状态的认领和 HMR 前缀接管使用同一份转换后视图。存储仍然仅追加：读取不会重写旧记录，此后追加的事件使用当前格式。这些是[消息标识机制引入前的消息](../../../.agents/notes/implemented/bug-fix/2026-07-28-load-pre-identity-session-messages.md)与 [react-loop 引入前会话](../../../.agents/notes/implemented/bug-fix/2026-08-04-load-pre-react-loop-sessions.md)决策所规定的范围受限的导入例外，并不构成通用的 v0 迁移承诺。

活动会话发出 `session/disposed` 时，协调器等待其 controller，以串行方式执行最终 drain，然后释放该精确 `Session` 对象拥有的状态。失败退役会将 controller 保留在活动会话 map 中，使后端拆卸可重试。后端拆卸先停止事件接纳，flush 每个剩余 controller，等待每 id 操作，最后才关闭存储句柄。

无副作用 `locate`、轻量 `listSnapshots` 和按 id 查询的 `readStoredRevision` 仍由后端负责，因为它们描述存储拓扑和修订身份，而非写入编排。`listSnapshots(signal?)` 将调用方传入的同一个信号传给后端发现流程，使观察者可在不脱离该工作的情况下取消。

`PersistenceBackend<TornMarker>` 钩子（协调器与存储之间的唯一约定）：

| 钩子 | 职责 |
|---|---|
| `name` | dispose 失败 `AggregateError` 的后端标签。 |
| `loadStored(id, signal?)` | 在全部存储范围中按 id 读取已存储前缀。用于恢复／加载、非修改式 inspect、活动会话接管和 create 冲突探测。可选信号属于仅观察读取。返回元数据标识 `id`；`revision` 精确标识返回的 header 和事件；当且仅当必须截断撕裂尾部时才存在不透明 `tornMarker`。 |
| `readStoredRevision(id, signal?)` | 在不加载事件日志的情况下读取一个 id 当前的来源限定修订值。它使用与 `loadStored` 相同的修订值表示；id 不存在时返回 `undefined`。 |
| `loadStoredFrom?(id, fromSeq, signal?)` | 服务 `readFrom` 背后的可选可寻址后缀读取：返回 header 和 `seq >= fromSeq` 的已存储事件，非修改式、无撕裂标记。SQLite 实现它（`WHERE seq >= ?`）；不实现的后端使用协调器回退——`loadStored` 加向前跳过。 |
| `appendBatch(meta, events, isMaterialized)` | 持久追加连续批次；尚未实体化时以原子方式延迟实体化。 |
| `commitRepair(meta, tornMarker, closers)` | 使崩溃修复持久：截断撕裂尾部（当且仅当 `tornMarker !== undefined`；标记可为 falsy，例如 seq/offset `0`），并追加 `closers`。不要求原子性。由 load（截断 + closer）和活动会话接管（仅截断）使用。 |
| `list(signal?)` | 列出全部已存储元数据，并遵循可选的取消信号。 |
| `close?()` | 可选生命周期拆卸（例如关闭 db 句柄），在 dispose drain 后等待其完成。 |

协调器断言已存储 id，并在修复或活动会话接管前比较已存储/活动会话 cwd。其 `inspect()` 路径取得新鲜后端值的所有权，只验证和冻结一次，并在不调用 `commitRepair` 的情况下最多保留配置数量的未发布 Session。只有保留源的修订值仍等于 `readStoredRevision` 时，系统才会复用或修复它；否则协调器会重新读取。该新鲜性校验不会增加跨进程写入排他。持久日志在一次读取与复核往返内保持不变时，修订值重试才能收敛；持续的外部写入可能延迟 `load`、`inspect` 或 `prepare`。`tornMarker` 完全不透明：协调器只测试 `!== undefined`，并将其原样往返给 `commitRepair`，绝不检查值（JSONL 后端使用待截断字节偏移，SQLite 后端使用待删除 seq）。第三方后端可以不用协调器直接实现抽象服务，但必须提供相同的非修改式检查和可信轻量快照修订。详见[写入协调器 Agent Note](../../../.agents/notes/implemented/architecture/2026-06-18-shared-persistence-write-coordinator.md)。

## 元数据与位置类型

从 `dsh-session` 重新导出：`SessionHeader`（不可变会话元数据：`version`、`id`、`createdAt`、`cwd?`、`parentSession?`、`seedLength?`、`origin?`、`delegationDepth?`）。`SessionLocation` 是 `{ readonly kind: string; readonly path: string }`；其 path 是绝对后端目标，不证明产物已存在或包含未 flush 轮次。

## 模型体验

### 恢复的对话历史

#### 模型所见

该 seam 不添加提示词或 schema。恢复会将已存储的表层事件还原为消息历史；已存储请求 header 重建较早调用，新 loop 则为下一次请求组合当前系统提示词、工具和会话前缀。崩溃修复将没有持久调用的 assistant 请求标记为 `TOOL_NOT_STARTED`；有持久调用但无结果时变为 `TOOL_OUTCOME_UNKNOWN`，其文本允许模型重试只读或幂等工作，但要求验证副作用或询问用户，而不是盲目重试。

#### Token 影响

普通持久化期间为零 token。恢复后会重新计入保留历史的 token 用量，并照常计入当前请求 envelope 的 token 用量；每个已修复调用都会增加一段以引用形式保留的错误文本。

#### KV Cache 影响

持久化不修改当前请求前缀。只有当重建历史、当前 envelope 和模型路由匹配时，恢复 loop 才能重用提供方缓存；崩溃修复结果仅追加，不重写较早历史。

## 已知限制与暂缓事项

- **无删除或保留接口**：剪枝已存储会话是带外后端维护。
- **`list()` 无分页且无过滤**：它返回每个已存储会话的 header；适合本地存储，大规模时无索引。
- **修复时合成 closer 是唯一崩溃方案**：后端必须在 load 时合成 `tool/result`/`step/end`/`turn/end` closer；没有继续中断轮次而不先关闭它的部分轮次恢复。
