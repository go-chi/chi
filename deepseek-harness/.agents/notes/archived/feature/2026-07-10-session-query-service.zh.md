# Agent Note: 精确会话查询服务

Status: implemented
Archived: 2026-07-27

[English](2026-07-10-session-query-service.md) | 中文

## 问题

会话历史存在于两处：当前的 `SessionStore` 对象与可选的持久化后端。需要精确检查的消费方若无统一服务，就不得不各自重复实现活跃/持久化优先级判定、持久化生命周期处理、原始事件的 surface 分类、关系追踪以及防御性克隆。在检查点之间，持久化状态可能落后于活跃日志，因此仅靠持久化并非当前状态的可靠来源。

全文搜索与此相关，但规模大得多。将提供方协调、同步、失效、排序和游标状态放入精确读取服务，会在具体数据库拥有方旁边再创建一个状态机。

## 决策

`@deepseek-ai/dsh-session-query` 拥有面向单一逻辑语料库的唯一抽象 `ctx.sessionQuery` 服务。它具体实现 `listSessions()`、提供方无关的 `filterSessions(filters)`、`listEvents(sessionId)`、`filterEvents(sessionId, filters)`、有界的 `readEvent(request)`、`traceSession(sessionId)` 和 `traceEvent(request)`，而具体后端实现其两个全文搜索方法。[统一服务决策](../../archived/architecture/2026-07-23-unified-session-query-service.md)拥有这一拓扑，[SQLite 搜索决策](2026-07-10-sqlite-session-query-provider.md)拥有搜索行为，[追踪决策](2026-07-13-session-query-tracing.md)拥有血缘与事件关系语义。

该服务动态观察可选的 `ctx.sessionPersistence` 绑定，但不保留持久化缓存或失效监听器。每次跨语料库列表操作向活跃后端请求权威元数据，然后叠加一份新鲜的活跃 store 列表。id 匹配的条目合并为一条 `SessionRecord`：活跃 header 优先，`live`/`persisted` 各自独立报告来源可用性。不可变 header 不一致时产生 `SESSION_QUERY_SOURCE_CONFLICT`。

精确目标读取首先检查活跃 store，快照活跃 header 与事件日志。此路径从不查询持久化，因此持久化后端故障不会导致已知的活跃历史不可读。若活跃 store 中无目标，服务列出当前持久化元数据、证明该 id 存在、加载它，并在列表/加载 header 不一致时拒绝。所有返回的 header 与事件都经过一次 structured-clone 边界。

## Surface 语义

`dsh-session` 导出 `foldSurface(events)`，`SurfaceManager` 使用相同的转换函数维护其增量缓存。fold 返回分离的当前事件 seq 以及每次替换实际移除的 seq。`listEvents()` 和 `traceEvent()` 利用该结果为每个原始事件分类，使检查结果不会在位置替换语义上与 model-history 推导产生分歧。

`readEvent()` 返回完整的目标加上按连续 seq 排列的原始相邻事件。`before` 和 `after` 默认为零，各自受 `readWindowMax`（默认 50）约束。结果携带克隆的 `SessionHeader` 而非来源可用性记录，因为判断活跃目标的 persisted 标志会违反「活跃精确读取不依赖持久化健康状态」这一保证。

## 安全边界

该服务是上下文级别的受信任基础设施，而非授权层。未来面向模型的历史工具或人类 UI 将施加显式的调用方/会话范围。该服务不添加面向模型的工具，也不改变 transcript（文本记录）或快照的 surface。

## 曾考虑的替代方案

- **将逻辑语料库解析直接放在每个消费方中**：否决。来源优先级、冲突处理、可选服务生命周期、克隆与 surface 分类是共享的正确性规则。
- **仅查询持久化**：否决。检查点可能落后于当前活跃日志。
- **缓存持久化元数据并监听写入/删除**：否决。精确读取可以直接询问权威来源，而缓存失效在规模尚未要求时就引入了生命周期与并发状态。
- **将提供方注册放入精确读取服务**：否决。SQLite 包拥有一套对账/事务生命周期；若没有第二个提供方证明其必要性，注册表只会拆分该状态。

## 后果

继承的精确读取实现只有一个来源解析状态变量：当前挂载的持久化服务。它没有提供方队列、指纹、提取器注册表、观察代次或派生索引更新；具体后端单独拥有其全文搜索状态。精确读取、语义扫描和事件追踪在纯活跃部署中仍然可用，在持久化存在时具有确定性。

跨语料库列表、血缘追踪和持久化事件操作在每次调用时执行后端 I/O。这是有意为之：正确性来自当前权威状态，而面向规模的全文搜索方法使用具体后端的 SQLite 派生索引。
