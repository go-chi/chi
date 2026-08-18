# @deepseek-ai/dsh-session-query

[English](README.md) | 中文

`SessionQueryEngine` 是组合式抽象 `ctx.sessionQuery` 约定。它对实时 `ctx.sessions` 和可选的动态挂载 `ctx.sessionPersistence` 实现精确会话历史取回、关系跟踪和与提供方无关的过滤；具体后端实现它的两个全文方法。匹配 id 只产生一条记录：实时事件优先，而 `live` 和 `persisted` 会报告两种来源的可用性。如果不可变 header 存在冲突，则以 `SESSION_QUERY_SOURCE_CONFLICT` 失败。

## 读取

- `listSessions(signal?)` 读取当前持久化元数据，以实时记录优先的方式合并它们，并按确定性的最新优先顺序返回克隆记录。
- `readSession(sessionId)` 在执行与恢复相同的核心回放验证后，返回一份完整、脱离存储的原始日志；它绝不会将该会话放入实时存储。
- `filterSessions(filters, signal?)` 对同一份克隆逻辑语料库应用与提供方无关的会话元数据和可用性谓词。
- `filterEvents(sessionId, filters)` 提取第一方语义文档，并按 seq 升序应用与提供方无关的元数据和字面文本谓词。
- `readTitleSnapshots(sessionIds, signal?)` 从一次实时优先的语料库观察中解析唯一 id，将取消信号传递给持久化列表查询和检查，并按顺序返回每个会话的结算结果，使某个缺失或格式错误的标题来源不会导致其他会话的结果被丢弃。每个实时来源直接 fold，每个持久化 worker fold 为脱离存储的 header/标题结果，并在出队下一个 id 前释放完整日志。取消会拒绝整个批次。`readTitleSnapshot(sessionId, signal?)` 是单次观察视图；`readTitle(sessionId, signal?)` 只返回其可选的 folded `session/title`。
- `listEvents(sessionId)` 加载实时优先的原始日志，将每个事件分类为 `current`、`shadowed` 或 `log-only`；该分类使用共享 `dsh-session` 表层 fold。
- `readSurface(sessionId)` 返回一个克隆 header、原始日志捕获边界，以及按模型历史顺序排列的完整折叠后当前表层。实时会话优先于持久化；压缩（compaction）只会在其替换追加之前或之后被观察，绝不会出现合成混合。
- `readEvent(request, signal?)` 返回一个克隆 header、完整目标事件和有界的原始 seq 窗口。`before` 和 `after` 默认为 0，且不得超过 `readWindowMax`。
- `traceSession(sessionId, signal?)` 只读取一次语料库，返回从直接父级向外的祖先，以及确定性的递归后代树。`complete: false` 标识第一个缺失父级；与目标相连的循环会以 `SESSION_QUERY_INVALID_LINEAGE` 失败。
- `traceEvent(request, signal?)` 只加载一次逻辑日志，返回其克隆源 header、直接位置替换和直接引用的源事件链接。`replacementChain` 沿位置替换者跟踪到最终替换；源事件链接仍不传递。

持久化是可选的，可动态挂载或卸载。已挂载持久化无法读取时，跨语料库列表和血缘跟踪以 `SESSION_QUERY_PERSISTENCE_FAILED` 失败；已经成功读取、但无法通过 Session 校验的持久化记录则以 `SESSION_QUERY_CORRUPT_SESSION` 失败。针对已知实时会话的标题读取、事件跟踪或事件读取不会查询持久化，因此持久化后端的健康状态无法使当前内存状态变得不可读。持久化标题和事件操作在加载前先执行列表查询，并在元数据不匹配时拒绝，而不会组合不一致的观察。血缘跟踪的取消信号会传递给持久化列表查询；事件跟踪和事件读取的取消信号会传递给持久化列表查询和检查。每项操作都会等待已启动的后端调用结算，然后使用信号的精确原因拒绝，即使后端忽略了该信号。针对已知实时会话且预先中止的标题读取、事件跟踪或事件读取会在 fold 或快照之前拒绝，且不查询持久化。批量标题观察执行一次元数据列表查询，使用最多 `persistedInspectConcurrency` 个 worker 检查唯一持久化 id，并保留每个标题自己观察到的 header，供下游授权使用。取消不会启动已排队检查，且只在已启动 worker 结算后拒绝。`listSessions()` 仍保持轻量，不加载日志或索引标题。

## 过滤与提取

`SessionResultFilter` 覆盖 id、可空 cwd、创建时间范围、可空父级和来源可用性。`SessionEventResultFilter` 覆盖 seq/时间范围、事件类型、表层和语义文本。过滤器数组使用 AND；同一列表子句内的值使用 OR。空列表值不匹配任何内容，范围包含端点，而格式错误的范围或封闭联合值以 `SESSION_QUERY_INVALID_FILTER` 失败。

文本子句刻意与 FTS 提供方无关：调用方文本会被转义为不区分大小写的 Unicode 正则表达式，每段连续空白匹配一个或多个空白字符。它是字面语义文本扫描，而非全文查询。`extractSessionEventText()` 和 `buildSessionEventSearchDocuments()` 定义共享的第一方文档投影；推理（reasoning）块、结构边界、流分片、请求 header 和未知声明合并变体不产生文档。

## 全文方法

`SessionQueryEngine.searchSessions(request, exec?)` 按匹配最强的事件对逻辑语料库分组；`searchEvents(request, exec?)` 搜索一个逻辑会话。这两个是服务仅有的抽象方法。两者都返回分页结果，其延续信息是由服务持有的带品牌 `SessionSearchCursor`；接受可选取消，并在不使用提供方专用数值分数的情况下提供摘录。事件搜索分页结果还携带来自与命中相同索引世代的克隆目标 header，使授权消费方可将策略绑定到此次载荷观察。搜索请求只接受事件元数据过滤器，因为字面文本过滤使用上文所述扫描路径。

该包没有提供方协调器、回退实现或独立具体插件。具体服务后端继承已实现的读取、过滤和跟踪，同时负责全文观察、对账、排名、游标世代和查询执行；第一个实现是 [`@deepseek-ai/dsh-session-query-sqlite`](../session-query-sqlite/README.md)。

`SessionQueryError.code` 是一个封闭联合，覆盖请求验证、缺失目标、格式错误的表层、来源冲突、持久化/索引失败、取消，以及无效或陈旧游标；精确字面值在 [`src/config.ts`](src/config.ts) 中定义。

`listEvents()`、`readSurface()` 和 `traceEvent()` 执行同一个单遍 `dsh-session` 表层 fold。只有当事件 seq 从零开始且连续、表层标记符合事件类型的适用性要求、源事件数组非空且无重复、引用指向较早事件，且每个位置替换都命名并引用它移除的每个表层节点时，加载的日志才有效；任何违规都以 `SESSION_QUERY_INVALID_SURFACE` 失败。

## 配置

| 键 | 默认值 | 约定 |
|---|---:|---|
| `readWindowMax` | `50` | `before` 或 `after` 的最大原始事件数。 |
| `persistedInspectConcurrency` | `4` | 一次批量读取中的最大并发持久化日志检查数；必须是正的安全整数。 |

## 模型体验

无。该可信查询服务只向调用方返回克隆会话记录，不注册面向模型的提示词、schema、工具或消息。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **无调用方授权**：这是上下文范围内的可信基础设施；未来的模型工具或 UI 必须限制调用方可检查的会话。
- **无注册表或面向模型工具**：尚未提供提取器和搜索提供方注册表、递归遍历所引用的源事件的能力，以及面向模型的工具。[跟踪决策](../../../.agents/notes/implemented/feature/2026-07-13-session-query-tracing.md) 负责关系语义；SQLite 归属和 tokenizer 决策位于[已实现搜索记录](../../../.agents/notes/implemented/feature/2026-07-10-sqlite-session-query-provider.md)。
