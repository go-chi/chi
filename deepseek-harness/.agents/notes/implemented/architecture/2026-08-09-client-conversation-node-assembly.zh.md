# Agent Note: Client Conversation 业务节点组装与 Chat keyed snapshot

Status: implemented

[English](2026-08-09-client-conversation-node-assembly.md) | 中文

## 问题

Client Session 既维护传输窗口、连接状态和待处理交互，也在中心化 transcript fold 中解释 Assistant、Tool、消息、命令、压缩、重试及 turn tail 等业务事件。每增加一种业务节点，都要修改 Session 的 switch、历史 replay、索引、缓存和 React 分组；业务 identity、状态演进与最终展示没有独立所有者。

旧链路还把运行中的 Assistant 和 Tool 放在 finalized flow 之外。它们结算后才进入按日志排序的节点列表，因此 React parent 会改变，即使业务 ID 和 `key` 不变也会重新挂载。全量历史加载、older prepend、实时 append 与 token streaming 又分别走不同更新路径，使引用稳定和局部重算只能靠各处特化缓存维持。

业务事件之间的关联方式并不统一。Tool 有 call ID，Assistant 以 turn/step 关联，Compaction 有独立生命周期和 checkpoint，Inbox splice 则表示一个连续状态的瞬间。把这些差异继续塞进统一 fold，会让任一业务变化都经过全局查表并使无关缓存失效。

## 决策

Client Runtime 提供 target-neutral 的 Conversation Node 组装引擎，业务插件注册 Event Definition，视图插件注册 per-Session View Builder。`ui-conversation` 注册第一批内建 Definition 和 `chat` builder；Session 只负责把当前连续事件窗口送入引擎并发布它的 snapshot，不再解释具体 conversation 业务。

本 Note 保留实现后仍有价值的方案推导、逐业务适配、职责、算法和取舍。

### 责任分层

| 层 | 长期职责 | 明确不负责 |
|---|---|---|
| Session | 维护连续 Event 窗口，区分 replace、prepend、append，调度 snapshot 通知 | 解释 Tool、Assistant、Compaction 等业务事件 |
| Event Registry | 按 Cordis 生命周期保存唯一 `kind` 的 Definition 和唯一 fallback | 保存某个 Session 的 Context 或 State |
| Assembler | 匹配 Event，维护 Context、Location、依赖和发布脏集 | 理解业务 State 字段或 Chat 排序 |
| Node Definition | 定义一个业务对象的 identity、State 演进、Location data 和 target Node | 创建 Context、修改别的业务 State 或扫描全部 Context |
| View Builder | 把最终 target Node 增量整理成该视图的 snapshot | 重新解释原始 Session Event |
| React renderer | 按最终 Node 的 `kind` 展示 renderer-owned data，并读取当前 Node 所属 Location 的只读业务 data | 配对业务 Event、扫描全局 Nodes 或决定业务生命周期 |

Registry 注册是 Cordis effect，Definition 卸载会触发现有 Session 的低频 registry rebuild。普通业务 Event 不改变 Registry，也不会因此重建全部业务类型。

### `ConversationNodeDefinition` 总体契约

每个 [`ConversationNodeDefinition`](../../../../packages/client/runtime/src/client/contract/conversation.ts) 独立拥有一种业务对象从 Event 到 State 和最终 view Node 的转换。Definition 的 `kind` 是 Registry 内唯一名称，也是业务 ID 的命名空间。

同一个 Event 可以被多个普通 Definition 认领。例如一条 Assistant Event 同时更新 Assistant Node 和 Turn Tail；一条 Retry Event 同时更新 Retry、Assistant 和 Turn Error。Assembler 只有在全部普通 Definition 都返回 `null` 时才询问 fallback。

Definition 不持有跨 Session 的可变业务数据。每个 Session 的 Context、State、依赖和 View Builder 都由该 Session 的 Assembler 隔离持有。

#### `kind`、业务 ID 与 Context key

`match()` 返回的 `id` 只要求在当前 Definition 内稳定。Tool 的 ID 可以是 call ID，Assistant 的 ID 可以是 `turn:step`，Inbox 的 ID 可以是 splice Event seq。

Assembler 使用 `conversationContextKey(kind, id)` 组合无碰撞 key；不同 Definition 即使返回相同 `id` 也不会共享 Context。最终 view Node 必须沿用这个 engine-owned key，不能把 `seq` 或渲染位置当 identity。

每个 `(kind, id)` 最多存在一个 start Match。第二个 start 会立即报错；Definition 需要表达新生命周期时必须返回新 ID。

#### `match(event)`

`match(event)` 只读取当前原始 `SessionEvent`，返回 `{ id, role: 'start' | 'update' }` 或 `null`。它拿不到 Context、历史、Reader、Location 或 view envelope。

这项限制使单条 Event 的路由成本只随已注册 Definition 数量增长。Assembler 不会为了判断一条 update 属于谁而遍历该 Definition 的历史 Context。

start、result、resource、checkpoint 及业务自有终止 Event 必须携带或可直接推导同一 ID。若单个 Event 不能算出 ID，生产 Event 的协议负责补足关联字段，Client 不通过“最近一个未完成对象”猜测。

`role` 描述 State 生命周期，不描述可见性。start 可以立即生成 terminal Node；update 也可以在 start 尚未加载时先进入 pending Context。

#### `ConversationMatch`

匹配成功后，Assembler 把原始 Event、可选的 wire presentation view、`role` 和引擎计算的 `location` 组成只读 `ConversationMatch`。

Context 的 `matches` 永远按 Event `seq` 升序保存，而不是按网络到达或分页摄入顺序保存。历史尾页先出现 result、older 页后出现 call 时，最终 Match 顺序仍然是 call 在前、result 在后。

Location 可以随 prepend 补齐边界或 append 关闭边界而改变。Assembler 替换受影响 Match 的只读 Location 并 replay Context；业务不把旧 Location 副本当权威保存。

#### `ConversationNodeContext`

| 字段 | 所有者 | Definition 可见语义 |
|---|---|---|
| `key` | Assembler | `kind + id` 的稳定最终 identity |
| `kind` / `id` | Definition + Assembler | 当前业务命名空间和业务 ID |
| `matches` | Assembler | 当前窗口已收集且按 `seq` 排序的完整业务证据 |
| `start` | Assembler | 唯一 start Match；尚未加载时为 `undefined` |
| `state` | Definition 返回、Assembler 持有 | 最近一次 `start`/`update` 返回值；未初始化时为 `undefined` |
| `current` | Assembler | 各 target 最近一次 materialize 的 Node 或 `null` |

Context 字段只读，不表示业务 State 必须是深度 immutable。Definition 可以返回新对象，也可以原地修改旧对象后返回同一引用。

Assembler 只采纳函数返回值。`start()` 或 `update()` 返回 `undefined` 是契约错误并立即报错；修改了对象却不返回它同样不成立。

Definition 可以读取完整 `matches` 辅助构造 State 或 fallback Node，但不能增删 Match、替换 Context 字段或修改另一个 Context。

#### `start(context, match, reader)`

`start()` 是 State 的唯一初始化入口。Assembler 首次得到唯一 start 后调用它，并采用其返回 State。

当更早分页改变 Context 的 Match 顺序、Reader 前序答案或 Location 事实时，Assembler 从 `start()` 重新计算，而不是对旧 State 做方向相反的补丁。

调用 `start()` 时，Context 可能已经收集 start 之后的 updates。`start()` 返回初始 State 后，Assembler 仍会从 start 之后按日志正序逐条调用 `update()`，因此摄入方向不会改变最终 fold 结果。

`reader` 只在 `start()` 中可用。它允许初始化逻辑读取严格位于当前 start seq 之前、指定 `kind` 的最近 active Context，但不给业务一个任意扫描引擎内部 Map 的接口。

每次重新调用 `start()` 都会替换上一次调用登记的 Reader 依赖，保证 Definition 改变查询分支时不会保留陈旧边。

#### `reader.previous(kind)`

`reader.previous(kind)` 查找满足 `candidate.startSeq < current.startSeq` 且 State 已初始化的最近 Context。它不会返回同 seq、未来 Context 或尚无 State 的 pending Context。

返回值包含前序 Context 的 key、kind、id、start seq、只读 State 和 Matches。消费者自行解释 State；提供方只负责把自己的 State 维护正确，不需要注册特化 query 方法。

Reader 每次查询都记录 `{ key, revision, windowGap }` 依赖。命中前序 Context 时，其 revision 变化会 replay 消费者；未命中且仍有 older 历史时，window gap 会等待后续 prepend。

若窗口已经到达 Session 起点仍未命中，`undefined` 是确定答案。若 `hasMore` 为 true，Definition 看到的仍是同一个 `undefined`，但 Assembler 会记住这是暂定结果。

依赖严格从较早 start 指向较晚 start，因此传递 replay 不形成时序环。Inbox 瞬间态链和 Message 对 Inbox 的读取都使用这一约束。

#### `update(context, match)`

`update()` 只处理已经由 `match()` 精确路由到当前 `(kind, id)` 的 post-start Match。它不再判断 Event 属于哪个 Context。

Assembler 按 `seq` 升序调用 `update()`。实时尾部 update 可以直接增量应用；任何非尾部证据插入、start 补齐或依赖失效都会从 `start()` 完整 replay。

没有业务变化时，`update()` 返回原 State。存在业务变化时，它可以返回 immutable replacement，也可以原地修改并返回同一对象。

Assembler 不以 State 引用相等判断是否需要发布或传播。每次成功 update 都增加 Context revision、标记 dirty，并使直接或传递 Reader 消费者重新求值。

#### `publication(match)`

`publication()` 只决定最新 State 何时 materialize 成 view Node，不改变 `match()`、`start()` 或 `update()` 的同步执行。

| 返回值 | 行为 |
|---|---|
| `immediate` | 请求当前 microtask 通知与 flush |
| `animation-frame` | 把多条高频更新合并到下一帧 materialize |
| `none` | 本 Match 不主动安排 flush，State 和 dirty 标记仍被保留 |

省略 `publication()` 等于 `immediate`。Assistant token delta 使用 `animation-frame`，不可见 Inbox Context 使用 `none`，final、依赖 replay 和 Location 边界会以 immediate 路径发布最新结果。

一帧内的每条 delta 仍执行 update；合并的只是 `buildViewNode()`、View Builder 和 React snapshot 通知，不会丢失 token。

#### `buildLocationData(context, scope)`

`buildLocationData()` 让 Definition 把 State 的只读派生值发布到 Engine-owned Step 或 Turn，而不把另一个业务的可变 State 暴露出去。Assembler 在每次 materialize 中固定先处理 `step`、再处理 `turn`，因此 Turn 级聚合可以读取同一轮已经更新的 Step data；全部 Location data 就绪后才调用 `buildViewNode()`。

Definition 分别收到 `step` 和 `turn` scope，可以在任一阶段返回一个值或 `null`。返回值必须声明准确的 turn/step 坐标，并使用与 Definition `kind` 相同的 key；Assembler 拥有替换和移除，并拒绝另一个 Context 占用同一 Location key。

`ConversationStepDataMap` 和 `ConversationTurnDataMap` 通过 declaration merging 约束 key 与 value。Location 只暴露稳定的 `data.get(key)` reader，消费者不能取得提供方 Context 或修改它的 State。

#### `buildViewNode(context, target)`

`buildViewNode()` 在发布阶段读取最新 Context，为指定 target 直接生成最终业务 Node。Assembler 不在它之后附加通用 activity、tail candidate 或 layout 业务层。

`null` 表示该 Context 对这个 target 尚未 materialize。普通增量路径中，一个已经返回过非空 Node 的 Context 不能再返回 `null`；暂时隐藏必须保留同 key Node，并使用 target 自己的 visibility。

Assembler 校验 Node `key === context.key` 且 Node `target === target`。业务可以改变 `anchorSeq`、data、Location 或 visibility，但不能在一次生命周期内改变 identity。

`current` 让 Definition 区分“从未生成”与“已经生成后需要隐藏”。Assistant retry 和 Turn Error suppression 使用它避免非法的 Node 撤回。

一个 Definition 最多拥有一个 view target；仅维护状态的 Definition 同时省略 `target` 与 `buildViewNode()`。即使 Chat 与 Trajectory 识别同一持久 Event 族，它们也分别注册自己的业务 Definition；共享 Assembler 则为两个 target 提供相同的匹配、replay、Location 与发布机制。

#### 不提供通用 `end()`

引擎不提供固定 `end()` 生命周期。单 Event 业务在 `start()` 中完成，多 Event 业务在自己的 update 中记录完成，长期瞬间态业务则每条 Event 建立新 Context。

Step/Turn 关闭属于外部 Location 事实，不替业务修改 State。边界变化会 replay 并 build 受影响 Context；业务结合“自己的 State 是否完成”和“Location 是否 closed”生成正常、running 或 interrupted 表现。

ID 不复用，完成的 Context 继续存在于当前窗口，既提供稳定渲染 identity，也可以作为后续 Reader 的前序证据。

### Location 是一级引擎事实

[`ConversationLocationIndex`](../../../../packages/client/runtime/src/client/sessions/conversation-location-index.ts) 根据 `turn/start`、`step/start`、显式 turn/step payload、`step/end` 和 `turn/end` 建立 Event 到 Location 的映射。

Location 有 `session`、`turn`、`step` 和 `unresolved` 四种形状。Turn/Step 各自带 `open`、`closed` 或 `unknown` 状态，以及已加载的 start/end Event。

每个 Turn 和 Step 还持有 reference-stable 的 Location data store。Definition 更新只替换自己拥有的 key；同一个 store identity 可以随 append 或 prepend 获得新值，使 Context、View Builder 和 React renderer 共享已经确定的层级业务事实，而不复制或遍历全局 Node 数组。

`unresolved` 表示当前历史窗口缺少足够前序边界，不等于 session-level。older prepend 补入边界后，索引修正 Match Location，并只 replay 拥有这些 seq 的 Context。

Append 普通 Event 只继承当前坐标；append 边界只重算所属 Turn。Prepend 会基于扩展后的完整连续窗口重建 Location facts，但引用稳定逻辑保留未变化 Turn/Step 对象。

Assembler 还把 reference-stable timeline 交给 View Builder。业务不重复维护 turn order、step list、last step 或边界 Map。

## 三种事件窗口链路

“历史反扫”描述 UI 从最新尾页向 Session 起点逐页加载的方向，不表示 Definition 逆序执行 `update()`。无论历史 API 返回顺序或页面加载方向如何，Assembler 对每个当前窗口和每个 fresh page 都按 `seq` 升序 canonicalize。

| 场景 | 输入范围 | Context/State 处理 | View Builder |
|---|---|---|---|
| 初始历史尾页或 resync | 当前完整连续窗口 | 清空并按 `seq` 正序重建全部 Context | `replace()` |
| 加载一页 older history | 只传更早且去重后的 fresh Events | 保留现有 Context identity，补 Match、Location 和依赖后局部 replay | `apply(upserts)` |
| 实时 append | 一条连续尾部 Event | 只匹配 Definitions 并精确更新命中 ID，边界只影响所属 Turn | `apply(upserts)` |

### 初始历史尾页与逻辑反扫

1. `Session.open()` 拉取最新 tail page，并把连续 History Entries 交给 `replaceWindow(entries, hasMore)`。
2. `replaceWindow` 清空旧 Context、start-seq 索引、seq 反向索引、Reader 依赖和输入 Map。
3. 全部 entries 按 Event `seq` 升序排序并写入当前窗口。
4. LocationIndex 对这个窗口重建 Turn/Step facts。
5. Assembler 按升序 Event 逐条调用每个普通 Definition 的 `match(event)`。
6. 每个命中结果按 `(kind, id)` 取得或创建 Context，并把 Match 插入该 Context 的有序数组。
7. 遇到 start 时执行 `start()`；已有 State 的尾部 update 直接执行 `update()`。
8. 当前页只含 result/resource 而缺 start 时，Context 仍会按 ID 创建并收集 Matches，但 State 保持 `undefined`。
9. 全部 Event 匹配后，Assembler 复查 Reader 依赖，使同一窗口内较早瞬间态先稳定、较晚消费者再读取它。
10. 所有 Context 标记 dirty，下一次 flush 先按 Step→Turn 完整重建 Location data，再对每个 target 调用 `buildViewNode()`。
11. 某些业务在缺 start 时返回 `null`；Compaction、Command、Tool result 或 Turn Error 等可根据充分 update 证据构造 fallback Node。
12. 每个 View Builder 收到完整 Node 集和 timeline，通过 `replace()` 建立初始 snapshot。

这条链路“从最新页开始”只发生在分页选择层。页面内部 State 始终正序计算，因此同一个窗口不会因为扫描方向不同产生不同业务结果。

缺 start 的 Context 不是错误。它是等待 older 页补齐的 pending 聚合容器；是否提前可见由该 Definition 的 `buildViewNode()` 决定。

若当前页中的同 ID update 在日志顺序上真的早于 start，而不是仅仅先被加载，补齐 start 后 replay 会报协议错误。到达顺序可以反向，业务日志顺序不能反向。

### 新 older 分页的 prepend

1. `Session.loadOlder()` 以当前 `baseSeq` 拉取紧邻前页，并先验证页尾与当前窗口连续。
2. Session 把 raw Event/view 数组 prepend 到自己的窗口，只把这一页传给 `assembler.prepend(entries, hasMore)`。
3. Assembler 按 seq 去掉与当前窗口重叠的 Events，再把 fresh page 内部升序排列。
4. 已存在的 Context、State、current Nodes 和 View Builder 实例不清空。
5. LocationIndex 用扩展后的完整输入重建 facts，并报告 Location identity 真正变化的 seq。
6. 拥有这些 seq 的 Context 更新 Match Location，并从 start replay；无关 Context 不参与 Location replay。
7. fresh Events 逐条执行 Definition matcher，并按稳定 ID 插入已有或新 Context 的有序 Matches。
8. 新页补出 pending Context 的 start 时，该 Context 从 start 初始化，再正序应用已经收集的所有 updates。
9. 新页建立更近的 Reader predecessor、改变 predecessor revision 或消除 window gap 时，消费者从 `start()` 重算。
10. Reader 依赖沿 start seq 向后传递 replay；同一传播批次不会把 Event 逆序应用。
11. `hasMore` 从 true 变为 false 的空页也会复查依赖，把暂定 `undefined` 收敛为确定不存在。
12. flush 只为 dirty Context 重新发布 Step/Turn Location data 和 target Node，并把非空结果作为 `upserts` 交给 View Builder `apply()`。

Prepend 保留已有 Context key 和 current Node identity。新页可以在 Chat `order` 前部增加 key，也可以修正既有 Node 的 anchor、Location、visibility 或 data，但不会为无关业务重新创建 Context。

Chat Builder 遇到结构变化时会从 keyed store 重算可见 `order` 和 Location 二级索引；这是视图索引计算，不会重新执行全部业务 Definition 或替换未变化 Node value。

Reader gap 修复是 prepend 与普通 append 最大的算法差异。新页不仅可能创建可见历史 Node，也可能改变后续 Inbox 瞬间态以及依赖它的 Message 分类。

### 正向实时 append

1. Session 只接受紧邻当前 tail seq 的 live Event；重叠 seq 去重，出现 gap 时先走 tail-page repair。
2. 非边界 Event 增量写入当前 Turn/Step 坐标；边界 Event 更新所属 Turn 的 Location facts。
3. Assembler 对这一个 Event 的每个普通 Definition 调用一次 `match()`，不会遍历任何 Definition 的 Context 集合。
4. 每个命中结果通过 `(kind, id)` 直接定位一个 Context。
5. 新 ID 创建 Context；已有 ID 的正常尾部 update 直接调用一次 `update()`。
6. start 或任何需要插入非尾部位置的证据会走完整 `replayContext()`，保持同一正序语义。
7. Context revision 变化后，只沿已登记 Reader 依赖 replay 消费者。
8. Location close 会更新所属 Turn 中受影响 Match 的 Location，并 replay 这些 Context，使未完成 Assistant、Tool 或 Retry 得到 interrupted/cancelled 语气。
9. Assembler 汇总所有命中 Definition 的 publication urgency；`immediate` 高于 `animation-frame`，后者高于 `none`。
10. Session 把 immediate 交给 microtask notifier，把 animation-frame 交给 RAF notifier。
11. flush 先为 dirty Context 更新 Step/Turn Location data，再调用 `buildViewNode()`，最后把本轮 upserts 和最新 timeline 交给 View Builder。
12. React 订阅的新 snapshot 复用稳定 Context key；同一 Tool running→settled 或 Assistant streaming→final 不跨父节点移动。

Append 的业务匹配成本是 Definition 数量加实际命中的 Context 更新，不随历史 Context 数量增长。Reader 消费者和 Location 关闭会增加与真实依赖或所属 Turn 成比例的 replay。

Chat `order` 的结构性变化仍可能重排当前可见 key；纯 data 更新只替换 keyed store 中一个 Node，并 touch 所属 Location 索引。这里保证的是无关业务不 refold、Node identity 不替换，而不是宣称所有视图索引操作都是常数复杂度。

### Replace、prepend 与 append 的一致性

三条链路最终都遵守同一不变量：Context Matches 按 seq 排序，State 从唯一 start 正序 fold，Reader 只看严格前序 active Context，Location data 按 Step→Turn 发布，Node key 只由 kind 和 ID 决定。

`replaceWindow` 是初始打开、resync、gap repair 和 registry 变化的低频完整替换，不用于实现普通 load older。`prepend` 与 `append` 都保留现有 Builder 和 Context identity。

分页页宽、历史加载次数和 RAF 合批只影响何时得到更多证据或何时发布，不改变窗口证据相同时的最终 Context State 与 Node。

## 内建业务如何使用 Definition

### 匹配、ID 与 State

| 业务 / `kind` | 稳定 ID | start Match | update Matches | State 与跨 Context 读取 |
|---|---|---|---|---|
| Next-turn Inbox / `inbox-next-turn` | splice Event seq | 每条目标为 next-turn 的 `agent/inbox/spliced` | 无 | 从 `reader.previous(ownKind)` 的 pending/claimed 瞬间态应用当前 splice |
| Next-step Inbox / `inbox-next-step` | splice Event seq | 每条目标为 next-step 的 `agent/inbox/spliced` | 无 | 同样形成逐指令瞬间态，claimed 集合供 Message 读取 |
| Message / `input-message` | message ID | append-surface `user/message` | 无 | 根据 source 生成 context message，或读取最近 next-step Inbox 判断 user/steering |
| Assistant / `assistant-step` | `turn:step` | `step/start` | `assistant/chunk`、final `assistant/message`、同 step Retry | 聚合 blocks、usage、首 token 时间、final 和 retry 隐藏状态，并发布同 key Step data |
| Tool / `tool-call` | root call ID | root `tool/call` | root result、Code Dispatch start/result | 聚合 root、children 和 parent Map；Dispatch Event 用 `rootCallId` 精确路由 |
| Command / `command` | command ID | `command/run` | `command/done`、带 source command ID 的 compact lifecycle/checkpoint | 聚合 command outcome 和手动压缩证据 |
| Automatic Compaction / `compaction` | compaction ID | 无 source command ID 的 `compaction/start` | summary、end、replacement checkpoint | 聚合 summary/checkpoint；checkpoint 足够时可在缺 start 下 fallback |
| Retry / `model-retry` | retry ID | attempt 1 的 `llm/retry` | 后续 `llm/retry` 与 `llm/retry-started` | 聚合同一 RetryId 的 attempts 与 scheduled/started 状态 |
| Turn Error / `turn-error` | turn number | `turn/start` | error `turn/end` 与该 turn Retry Events | 聚合 terminal failure，并用 Retry 证据决定隐藏 |
| Turn Tail / `turn-tail` | turn number | `turn/start` | Assistant、Retry、`step/end`、`turn/end` | 保存 turn end，读取各 Step 的 Assistant data，发布 Turn data；完整 Matches 用于选择视觉尾部 anchor |
| Deliverables / `deliverables` | turn number | `turn/start` | 该 Turn 的 Tool call/result | 聚合成功 mutation paths 并发布 Turn data，不生成 view Node |
| Unknown fallback / `unknown-surface` | Event seq | 未被普通 Definition 认领的 append-surface Event | 无 | 保存原始 type/data 作为 JSON fallback |

### Chat Node 与历史/实时特性

| 业务 | `publication()` | Chat 产物 | 历史分页与运行时行为 |
|---|---|---|---|
| Inbox | `none` | 不生成 Node | prepend 补前序 splice 时沿 Reader 链重算瞬间态 |
| Message | 默认 immediate | `user`、`steering` 或 `context` | window gap 修复可让同一 message key 重新分类 |
| Assistant | chunk 为 RAF，final immediate，纯 usage/finish 为 none | 同 key `assistant-step`，状态为 running/settled/interrupted | 缺 `step/start` 可先用 Matches fallback；Location close 生成中断表现 |
| Tool | 默认 immediate | 一个递归 `tool-call` root，包含全部 `subCalls` | result-only 历史窗口可 fallback；running→settled 保持 key |
| Command | 默认 immediate | 普通 `command` 或集成 `manual-compaction` | checkpoint 到达可改变 anchor，但不改变 Context key |
| Compaction | 默认 immediate | `compaction` marker | checkpoint 可先展示，older 补 start 后正序 replay |
| Retry | 默认 immediate | 一个 `model-retry` Node 内含 attempts | 多次 retry 更新同一 key；Location close 把最后 scheduled 表现为 cancelled |
| Turn Error | 默认 immediate | `turn-error` visible/hidden | 缺 start 可从 error end fallback；Retry 到达后保留 key 并隐藏 |
| Turn Tail | 仅 `turn/end` immediate，其余 none | 独立 `turn-tail` footer | 从 Step Assistant data 计算 closing/metrics，并通过同 turn Matches 决定 anchor |
| Deliverables | 默认 immediate | 不生成 Node | Tool 结算增量更新所属 Turn data，Turn Tail 扩展槽读取 produced files |
| Fallback | 默认 immediate | `unknown` JSON row | 只兜底 append surface，普通业务已认领但暂不可见时不会重复生成 |

Inbox 展示了“每条 Event 都是一个 start-only 瞬间态 Context”，不是所有业务都需要 start/update 配对。它通过 Reader 与前一个同 kind Context 形成连续 fold，而非给整个 Inbox 人工制造生命周期 ID。

Assistant、Turn Tail 和 Turn Error 展示了同一 Event 被多个 Definition 独立认领。每个 Definition 只更新自己的 State，最终分别生成原子 Chat Node。

Assistant、Turn Tail 和 Deliverables 展示了 Location data 的分层组合。Assistant 负责写好每个 Step 的 `assistant-step` data；Turn Tail 从这些 Step values 计算 `turn-tail` data；Deliverables 独立维护同一 Turn 的 `deliverables` data。消费者只读取声明合并后的 key，不扫描其他业务 Node，也不取得提供方的 Context State。

Tool 和 Command 展示了多 Event 聚合：生产者提供共同 ID，Context 在业务内部构树或整合 Compaction，不把配对工作推给 Chat Builder。

Compaction 和历史 Tool result 展示了缺 start 时的业务 fallback。引擎不统一规定“没有 start 就不渲染”；Definition 根据当前 Matches 是否足够自行决定。

Retry 展示了业务 State 与 Location 的分工。scheduled/started 属于 Retry State；Step/Turn 是否关闭属于引擎 Location；`buildViewNode()` 组合两者得到 cancelled 视觉状态。

Unknown fallback 展示了 Registry ownership：fallback 只处理没有任何普通 matcher 认领的 append surface Event，不会因为普通 Context 暂时返回 `null` 而误生成第二个 Node。

## View Builder 与 React identity

[`ConversationViewRegistry`](../../../../packages/client/runtime/src/client/conversation/view-registry.ts) 为每个 target 创建独立的 per-Session builder。Registry 保存 factory，不共享某个 Session 的排序或缓存。

Assembler 低频完整替换时调用 `replace({ nodes, timeline })`；普通 prepend/append flush 调用 `apply({ upserts, timeline })`。Builder 只接收 Definition 已构造完成的 target Nodes。

[`ChatSnapshotBuilder`](../../../../packages/client/ui-conversation/src/client/conversation-nodes/chat-snapshot-builder.ts) 维护 `order`、keyed `nodes` store、turn/step `locations` index、`timeline`，以及由 StatsLine 使用并镜像到顶层公共兼容字段的 `legacy` slice。

Chat 结构变化只由新 key、`anchorSeq`、visibility 或 Location identity 变化触发。普通内容变化不重建 `order`；keyed Node store 只替换该 key 的 value。

Builder 遇到结构变化时从 store 的当前 values 计算 visible order，并按未变化引用复用索引数组。Prepend 可以增加前部历史 key，append 可以增加尾部或按业务 anchor 落位，既有 key 不因排序变化而重命名。

[`ChatView`](../../../../packages/client/ui-conversation/src/client/chat/ChatView.tsx) 只遍历 `order`。每个 [`ChatNodeSeat`](../../../../packages/client/ui-conversation/src/client/chat/ChatNodeSeat.tsx) 以 Context key 固定在同一个父列表中，并按 `node.kind` 分发 `'conversation.chat.node'` keyed slot。

[`ChatNodeDataMap`](../../../../packages/client/ui-conversation/src/client/contract/chat-nodes.ts) 是 declaration-merged 的 renderer payload registry。每个业务模块分别注册自己的 Definition 和 keyed renderer；`registerConversationNodes()` 与 `registerChatNodeRenderers()` 只负责装配这些独立贡献，不通过 closed union 或中心 switch 解释业务。内建实现仍位于 `ui-conversation`，但该类型和注册边界允许业务迁入独立 package 而不修改 Chat dispatcher。

`conversation.view` 的 Chat entry 在声明 `conversation.chat.node` child slot 时统一注册 `ChatNodeTurnDataInjected`。`ChatNodeSeat` 只把稳定 Node key 作为 `hookContext` 传给 slot；Slot renderer 用官方 standard props 中的 `useSession` 和该 key 构造 `useTurnData(businessKey)`，因此每个 keyed Chat renderer 都能读取自己 Node 所属 Turn 的强类型只读 data，Assistant renderer 不拥有特殊注入权限。

Slot-level contextual Hook 与 entry-owned `inject.hooks` 是两条独立路径。后者继续只绑定 registration-owned Observable；前者按稳定 slot inject face 缓存定义，并按稳定 render occurrence 绑定 factory 和 Hook。`useTurnData()` 内部 selector 只返回当前 Node 的 `turn.data.get(key)`，无关 Session publication 会被 selector equality 截断。

标准 `useSession` 仍属于所有 session-scoped slot renderer 的公开能力，`useTurnData()` 是收窄常见读取方式而不是权限沙箱。全窗口统计或任意对象索引仍可显式使用 Session snapshot；它们不能伪装成“当前 Node 的 Turn data”。

Assistant streaming 到 final、Tool running 到 settled 只更新同一个 Seat 的 data 和必要的排序属性，不再从末尾 running container 移入 finalized flow，因此组件内部 State 不因结算自动归零。

业务主动把已发布 Node 改成 hidden 时，它会退出 visible order，恢复 visible 时会重新 mount。这是明确的业务撤显语义，与 running→settled 的稳定 Seat 保证不同。

具体 Tool renderer 仍由 [`ui-tool ownership decision`](2026-08-08-client-tool-presentation-ownership.md) 约束。Tool Definition 只交付递归 root/subcall data，`ui-tool` 再按 Tool name keyed slot 分发具体表现。

Trajectory 针对与 Chat 相同的 Assembler 和 Session 事件窗口注册自己的 target 与业务 Definition。它的 target builder 保留 stage-oriented read model，既不消费 Chat Builder 的 legacy slice，也不运行独立 history fold。Chat Builder 为 StatsLine 和顶层公共兼容字段保留 legacy slice；target 专属 Definition 不改变共享的 Context、Reader 或 Location 契约。

target 专属 Trajectory Definition、保留的 stage model、Steering 适配、复杂度上界与表现层热点由 [Trajectory Context 组装决策](2026-08-11-trajectory-conversation-context-assembly.md)负责。

## 运行时与渲染链路

```text
Session Event window
  -> ConversationNodeAssembler
       -> Definition.match(event) -> (kind, id, start/update)
       -> Context matches + State + Location
       -> Definition.buildLocationData(step -> turn)
            -> StepLocation.data / TurnLocation.data
       -> Definition.buildViewNode() for its declared target
  -> target View Builder
       -> chat: ChatSnapshotBuilder -> ChatView -> keyed ChatNodeSeat
       -> trajectory: TrajectorySnapshotBuilder -> stages/layout/table
```

## 验证

Runtime tests 固定 Definition 生命周期注册、exact-ID append、update-before-start 收集与 start 后正序 replay、prepend identity、Reader window-gap 修复、传递依赖、Location closure、Step→Turn data phase order、Location data replacement、publication cadence、非法撤回和 per-target Builder。

Conversation tests 覆盖全部内建 Chat Definition、Assistant Step data、Turn Tail 与 Deliverables Turn data、Chat 排序和结构共享、selector isolation、Assistant/Tool running-to-settled identity、nested Code Dispatch、steering、Compaction、Retry、interruption、load-older anchoring 和 slot dispatch。Trajectory tests 则覆盖它独立注册的 Message、Assistant、Tool、Compaction、Request-header 与 boundary Definition，以及继续保留的 stage-oriented view model。

Slot type/runtime tests 固定父注册必须提供声明的 common inject、`hookContext` 类型、不同 Node context 的 Hook 隔离、factory/Hook identity 稳定，以及无关 Session publication 不重渲染业务 renderer。原 entry-owned Observable Hook 测试继续固定未使用 contextual factory 的路径。

Assembled Web snapshot、GUI 和浏览器场景覆盖真实 plugin graph。浏览器证据比较 Assistant streaming→settled、Bash running→settled 以及 Code Mode root + nested subcalls 与 master 的布局。

历史链路验证同时覆盖完整 replace、非重叠 prepend、重叠 seq 去重、空页 `hasMore` 收敛和 live append。相同 Event 窗口通过不同摄入路径得到相同业务 State 与最终 Node。

## 考虑过的替代方案

**保留中心化 Session transcript fold，只抽 helper。** 拒绝：业务 identity、历史 replay 和 cache invalidation 仍属于一个闭合 switch，移动函数不会产生独立所有权。

**让 React renderer 自己扫描 Session Event。** 拒绝：每种 view 都会重复匹配和生命周期 State，React 会成为业务权威，paging 与 streaming 也会重算无关组件树。

**把全局 Nodes 或 Location 索引传给每个业务 renderer。** 拒绝：业务组件会自行扫描和推断当前 Turn/Step，订阅范围随窗口增长。Definition 把聚合值发布到 Engine-owned Location，renderer 只读取自己 Node 的 Location data。

**每个新 Event 都调用同 Definition 的全部 Context。** 拒绝：append 成本随历史增长，`update()` 也会同时承担匹配与转换。无 Context 的 `match(event)` 先算出 ID，随后只更新一个 Context。

**让 Definition 的 matcher 读取 Context 或扫描历史。** 拒绝：匹配将依赖摄入方向，result-first 历史页无法独立算出归属，实时 append 也退化成开放对象查找。

**为历史反扫定义逆向 State fold。** 拒绝：每个业务都要维护互为逆运算的两套逻辑，删除、非可逆聚合和跨 Context 依赖很难保持一致。统一 Matches 后从 start 正序 replay 只有一套业务语义。

**把 Inbox 做成引擎一级公民或一个窗口级 Context。** 拒绝：Inbox 是普通业务状态，不应污染通用引擎；逐 splice 瞬间态加严格前序 Reader 同时支持 prepend、append 和 Message 查询。

**给跨业务查询注册特化 query method。** 拒绝：消费者仍要依赖提供方 API，新增关系会扩张中心接口。Reader 暴露指定 kind 的只读前序 Context，由提供方写好 State、消费者读懂 State。

**让 Location data 消费者直接读取提供方 Context State。** 拒绝：消费者会依赖另一个业务的可变内部形状，也无法表达值属于哪个 Turn/Step。declaration-merged data map 只公开提供方选择发布的只读值和 Engine-owned 坐标。

**增加通用 `end()`、prepared 或 window reset 生命周期。** 拒绝：不同业务完成条件不同，分页缺口也不是业务生命周期。业务 Event 更新 State，Location close 触发 replay/build，Reader dependency 负责补页失效。

**在同一个 Event Definition 内通过 `buildViewNode(target)` 为 Chat 与 Trajectory 分支。** 拒绝：两种视图需要不同的业务 State 与中间记录，共用 Definition 会迫使每个 package 携带另一边的条件与 payload。target 自有的 Definition 把这些选择留在本地，同时复用 Assembler 的摄入与生命周期约定。

**在最终业务 Node 上再叠一层通用 layout model。** 拒绝：activity、tail candidacy 和 layout enum 会把当前 Chat 的业务语义重新集中到引擎。最终 Node 直接携带 renderer 所需 data，只共享 identity、排序和 Location 事实。

**只在 Assistant renderer 注册 Turn data Hook。** 拒绝：访问当前 Node Location 是 `conversation.chat.node` slot 的公共能力，不属于某个业务 renderer。父 Chat entry 注册一次 common inject，所有 keyed renderer 共享同一强类型约定。

**把 running Assistant 或 Tool 保留在独立 tail container。** 拒绝：结算时会跨 React parent 移动，稳定业务 key 也无法阻止 remount。统一 keyed order 允许 data 和排序位置改变，但不改变 Seat identity。

## 后果

新增业务节点可以局部注册自己的 matcher、State 转换、可选 Location data、最终 target Node 和 renderer，不再修改 Session 的业务 switch。`ChatNodeDataMap` 和 Location data maps 允许业务 package 通过 declaration merging 合入强类型 data；所有相关 Event 仍须暴露可单 Event 推导的稳定 ID。

Host 业务 package 把自己的持久 Event 成员 declaration-merge 到 `@deepseek-ai/dsh-session/types`，Client Definition 则通过对应业务 package 的 `/types` 子路径进行 type-only import。增强实际声明接口而不是重导出 barrel，使 Host 和 Client 的独立 TypeScript Program 都能获得相同的 Event narrowing，同时不把 Host runtime 带入 Client 图。

初始尾页、older prepend 和 live append 共享一套 Context 不变量。缺 start、Reader window gap、Location unknown 以及高频 delta 都是引擎明确表达的状态，不需要业务另建方向相关 cache。

Append 不扫描历史 Context；prepend 只 replay Match、Location 或 Reader 答案真正受影响的 Context。Chat 结构变化仍可能重算 visible order 和索引，但不会重跑无关业务 fold 或替换未变化 Node identity。

State 更新与发布频率分离后，Assistant 每条 delta 都被 fold，同时每 animation frame 最多 materialize 一次。step/turn close 和 final 可立即发布最新 State。

Step/Turn 成为业务间共享聚合的稳定宿主。Turn Tail 和 Deliverables 不再依赖 renderer 扫描全局 Nodes；Slot-level `useTurnData()` 把常见读取限制到当前 Node 所属 Turn，并通过 selector equality 隔离无关更新。

代价是 Runtime 新增 Registry、Assembler、Location data、依赖重放和 per-target Builder 契约，UI Slots 也新增 parent-owned common inject 与 per-occurrence `hookContext`。Definition 作者必须理解稳定 ID、唯一 start、正序 replay、Step→Turn 发布顺序、只读 Reader 和 Node 不撤回规则。

`useTurnData()` 不撤销 session-scoped renderer 的标准 `useSession`，因此该边界依靠 API 引导和测试，而不是能力隔离。Registry 变化仍是低频完整 rebuild；Chat Builder 继续为 StatsLine 和顶层公共字段维护 legacy slice，Trajectory 则在共享 Session 窗口上拥有 target 专属 Definition 与 Builder。内建 Definition 分别留在所属 UI package；这些兼容边界不把业务解释权交还给 Session。
