# Agent Note: subagent 列表经投影单元读取身份

Status: implemented

[English](2026-08-06-subagent-list-identity-projection.md) | 中文

## 问题

重写前的 `SubagentRuntime.listChildren` 对每个 `header.origin === 'subagent'` 的直接 child，每次列表都执行 `listEvents` 加 `readEvent` 两次整日志物化，且每次物化都伴随整日志 structuredClone，只为从描述符事件里折出 mode 与 label 两个字段。描述符在日志中的位置不固定——fork 前缀任意长，zstd 压缩帧没有 seq 索引——因此定位没有捷径；这条路径没有任何缓存，代价随 transcript（文本记录）长度 × child 数量 × 列表频率放大。它还把 session-query 拉成列表的硬依赖：没有 query backend 的部署，`list_agents` 以 `SUBAGENT_CONTROL_SESSION_QUERY_UNAVAILABLE` 整体拒绝，尽管枚举所需只是 header 事实。

同一根因还有第二个症状：host 侧的 `hasSubagentDescriptor()` 在每次 Agent（智能体）绑定 RPC 的属主判定上扫描目标会话的 own suffix，即便 `SessionHeader.origin` 已经回答了同一个问题的绝大部分。

根因在于 [durable-subagent-catalog 决策](../feature/2026-07-22-durable-subagent-catalog-and-list-agents.md)把描述符事件（`subagent/descriptor`）定为目录的唯一持久权威，却没有为描述符读取配任何缓存层，并把逐 child 双读明确接受为「无索引的正确性基线」。[web subagent conversations](../feature/2026-07-27-web-subagent-conversations.md)（#1569）已把「是不是 subagent」放进了 header（`SessionHeader.origin`），身份判定不再读日志；mode 与 label 仍然要扫。

## 决策

mode 与 label 由新的 `subagent` projection unit（纯身份两臂）折叠，unit 是折叠规则的唯一权威；`listChildren` 不再依赖 session-query——枚举是 subagent 自管的 live-preferred 合并，取值走三级「算完即止」阶梯：live child 同步读注册表的既有水位缓存（零日志读）；cold child 先问可选的 `sessionProjectionCache` checkpoint，取到过 seq 门的身份即定值；否则一次 `persistence.inspect` 整读加 `registry.restore` 折叠。无索引、不自建缓存、无回写。

消除逐 child 扫描的出路有三类：把 mode/label 提升进 header（写路承担）；为投影建持久派生（checkpoint 阶梯，或随查询索引重建落值、读端对账）；读时现算（live 走水位缓存，cold 一次整读）。本记录取第三条。「值随查询索引落库」已整体退役：查询基础设施被迫认识领域词汇，而唯一消费方读时现算即可满足——live child 的零读由 session-projection 既有水位缓存白拿，cold child 的一次整读被「算完即止」显式接受。前两条与退役理由详见考虑过的替代方案一节。

要点：

- **subagent 列表不依赖 session-query**：枚举由 subagent 自管的 live-preferred 合并完成，mode/label 经 `ctx.sessionProjections` 取值；没有 query backend 的部署照常列表。
- **取值三级「算完即止」阶梯**：live child 读 `sessionProjections.snapshot()`（注册表既有水位缓存，零日志读）；cold child 先读可选 `sessionProjectionCache.cachedSnapshot(header)`，values 含非 null 且过 seq 门（`seq >= seedLength ?? 0`）的 `subagent` 身份即直接用；否则一次 `persistence.inspect` 整读加 `registry.restore({}, events, 0)` 折叠；再没有就没有——不自建缓存、无回写、无索引。
- **`subagent` projection unit 是折叠规则唯一权威**：live snapshot、cold restore、GUI history 的 detached 折叠全部经 registry 计算，不存在第二份描述符解释逻辑。
- **header、描述符（v2）、session-persistence、session-projection(-cache)、session-query(-sqlite) 全部零改动**；存量数据第一次被列表时一次 `inspect` 现算获得精确值，无 unknown 降级态、无迁移。

与既有记录的关系：

- 本记录取代 [durable-subagent-catalog](../feature/2026-07-22-durable-subagent-catalog-and-list-agents.md) 中列表读路径的两项设计：经 `sessionQuery.traceSession` 枚举，与逐 child 读取描述符事件（`listEvents` 加精确 `readEvent` 双读、就地诊断分类）。diagnostic 行语义保留，分类改由列表按投影值缺席与 activity 派生；描述符事件仍是 mode/label 的唯一持久权威与折叠输入，恢复鉴权与激活约定不动。属部分取代，两记录保持交叉链接。
- [session-projection RFC](../../proposed/architecture/2026-07-27-session-projection-and-command-log.md) 的 registry 约定（`ProjectionDefinition`、`snapshot`、`restore`）零改动，本记录只为其新增 `subagent` 身份 unit 一个注册项，并成为 snapshot（live）与 restore（cold）两处既有读法的又一消费实例——GUI history 的冷读已是同款。折叠规则只在 registry 注册一份；任何消费面都经 registry 计算，不存在第二份折叠逻辑。

### `subagent` projection unit

挂在现有 `subagentTiming` 旁（[projection.ts](../../../../packages/subagent/subagent/src/projection.ts)、[projection-types.ts](../../../../packages/subagent/subagent/src/projection-types.ts)），key 为 `subagent`：

```ts ignore-check
export type SubagentIdentityProjection =
  | { mode: 'one-shot'; label?: string; seq: number }
  | { mode: 'continuable'; label: string; seq: number }

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    subagent: SubagentIdentityProjection | null
  }
}
```

- 投影是纯身份，**projection 体系不做失败通道**：unit 永不抛错；载荷损坏、版本不认识与整日志没有描述符一样，折叠结果是**可序列化的 null 哨兵**——map 条目为 `SubagentIdentityProjection | null`，非可选、非 undefined/缺 key。理由：registry 的 onChanged 推送经 JSON 序列化，undefined 字段被 stringify 丢弃，客户端帧校验拒收，消费方存储的旧身份将永不更新；null 完好过帧，消费方以哨兵替换旧身份。判定纪律：消费面把 null 与 undefined（仅 JSON 边界丢 key 可产生）一律视为无值。「算出来没有」如何呈现是消费方自己的事（见下文 `listChildren` 四态映射）。
- label 强度由描述符 schema 决定：continuable 的 label 解析强制必有，one-shot 的本就可选；mode/label 判别与下文 child 行的强约定完全一致（行不携带 `seq`——它是投影内部的 own-suffix 证明）。
- 身份携带 `seq`：折出该身份的 `subagent/descriptor` 事件 seq，两臂必有、null 哨兵无——`seq >= header.seedLength ?? 0` 证明身份折叠自 child 自身后缀，而非 fork 种子回放的祖先描述符。state 增 `seq` 使 unit `stateVersion` 升至 2，既存 checkpoint 行按 registry 约定版本失配失效、落权威重折。
- 折叠规则：`subagent/descriptor` last-wins，与 `subagentTiming` 同一条 descriptor-reset 纪律——fork 前缀里的祖先描述符被自身描述符覆盖。损坏或版本不认识的载荷同样 last-wins：重置为 null 哨兵而非保留先前身份，健康祖先的 fork 不会继承自身描述符立不住的身份。

### 枚举：subagent 自管 live-preferred 合并

`listChildren`（[list-children.ts](../../../../packages/subagent/subagent/src/list-children.ts)）的枚举不经任何查询服务：`ctx.sessions.list()` 与 `ctx.get('sessionPersistence')?.list()` 两个来源按 id 合并，live 记录整条覆盖同 id 持久化记录、不做 header 一致性校验。枚举所需全部是 header 事实：

- 过滤：`header.origin === 'subagent' && header.parentSession === parentSessionId`。
- `hasChildren`：同一份合并材料向下看一层——存在 `origin === 'subagent'` 且 `parentSession` 为该 child 的直接后代。
- `activity`：live 记录为 `running`，仅存在于持久化的为 `inactive`。
- 排序：`createdAt` 升序、再按 child id 升序（与旧约定一致）。
- **persistence 缺席退为 live-only 枚举，不报错**：没有 persistence 的部署，cold child 本就无法 resume，列出 live child 仍然有意义。（对照：旧实现在 sessionQuery 缺失时整体拒绝。）
- persistence 列表失败使整次枚举失败；per-child 隔离只作用于逐 child 的冷读。

### 取值：三级「算完即止」阶梯

对每个枚举出的 child，mode/label 取值走三级阶梯——算完即止，不自建缓存、无回写（第三级与 apiproxy `session.history` 的冷读同款）：

| 级 | 读法 | 成本 |
| --- | --- | --- |
| 1：live child | `ctx.sessionProjections.snapshot(session).values.subagent` | 零日志读——注册表既有水位缓存，同步取值 |
| 2：cold child，cache 命中 | 可选 `sessionProjectionCache.cachedSnapshot(header)`，values 含非 null 的 `subagent` 身份且 `identity.seq >= header.seedLength ?? 0` 才直接用——own descriptor 一经追加不可变，seq 门证明该值折叠自 child 自身后缀，无视行水位 | 零日志读 |
| 3：cold child，兜底 | `persistence.inspect(id)` 整读 + `registry.restore({}, events, 0).snapshot.values.subagent` | 每次列表一次整读现算 |

- 错误约定：`ctx.sessionProjections` 未挂载是配置错误，`listChildren` 在枚举前无条件检查并以 `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE` 响亮失败——零 children 的部署同样确定失败，不因列表恰好为空而掩盖配置问题。会话存储同理：`ctx.get('sessions')`（严格全局读取，不走调用方作用域的属性代理）缺席以 `SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE` 失败。两码的 wire 映射有别：apiproxy 只为 `PROJECTIONS_UNAVAILABLE` 设专门 wire 脸，`SESSION_STORE_UNAVAILABLE` 走通用 internal 兜底——apiproxy 组合自身就 inject `sessions`，该错误在其部署不可达，专门映射违反 need 原则。`SUBAGENT_CONTROL_SESSION_QUERY_UNAVAILABLE` 已随 session-query 依赖删除。
- cache 是纯可选加速层：服务缺席判空跳过——无错误码、不进配置校验（与 `sessionProjections` 的响亮约定相对）。第二级任何抛错（包括缓存内任一 unit 行中毒使 `viewCheckpoint` 引爆）静默落第三级——缓存是派生数据，其故障不产生 `corrupt` 判决，终审归权威重折；checkpoint 切面早于描述符的行，`subagent` key 天然缺席，自动落底，无特判；行里的 null 哨兵同样不作数——一律落第三级，由权威重折裁决。创建窗口内的 count/interval checkpoint 可能把 fork 种子回放的祖先身份落进行——祖先 seq 落在 seed 区间，被 seq 门拒绝，同样落第三级裁决。
- per-child 隔离：单 child 的 cold 整读失败只使该行成为 `unavailable` diagnostic，下次列表自然重试，不影响 sibling（见四态映射）。
- 冷路径的生命周期见证：preparation 的结果必须仍指向枚举时的那个生命周期——见证字段集与旧 SOURCE_CONFLICT 检查同款七字段（version、id、createdAt、cwd、parentSession、seedLength、delegationDepth）；同 id 删除后重新发布的会话对旧 parent 的目录降级为 `corrupt` 行，不外漏新 owner 的 child。
- 冷读并发以常数 4 有界——它约束的是本地介质的一次只读扫描而非部署行为；出现联网 persistence backend 时提升为验证过的 `Config` 字段。
- 冷读成本如实记录：cache 未挂载或未命中时，cold child 每次列表才付一次整读，成本与其 transcript 大小成正比；定案「算完即止」，不自建缓存。整读经 `inspect()` 走 [Session 准备阶段](2026-08-05-session-preparation.md)的冷读，同 id 短期重复读取可命中其 LRU 复用，但列表不依赖此。live child 全程零日志读。
- 取消：每次 persistence 读前后检查调用方 signal，abort 之后才结算的读拒绝归一化为稳定错误码 `CANCELLED`。

### 权威模型

- session log 是唯一权威；本方案不新增任何派生持久化——没有索引值、没有自己的 checkpoint、没有进程 memo；第二级读取的 `sessionProjectionCache` checkpoint 是既有组合项的派生数据，本方案只读不写。取值现算现弃，值的新鲜度就是读取时点的 live 状态或持久化 revision（own descriptor 一经追加不可变——缓存身份过 seq 门后无陈旧性问题，门防的是种子回放的祖先身份）。
- Session 与 persistence 写路完全不感知列表与投影消费：没有事件监听回写，没有写时折叠。
- 枚举与取值不构成第二个鉴权来源，也不让尚未发布的 child 可见——两个来源只见已发布的 live 记录与已落盘的持久化记录，与 durable-subagent-catalog 记录对派生读面立下的规则一致。

### `listChildren` 行形状与消费面

`SubagentListEntry` **数据结构与重写前完全一致**——child 与 diagnostic 两臂、`kind` 判别、reason 三值、child 臂的 mode/label 强约定全部保留；变化只在诊断的信息来源：投影体系没有失败通道，diagnostic 由列表按投影值缺席与 activity 派生，列表本身零事件解析。「没有就等待硬读取」保证阶梯对健康数据必然算得出 mode/label。

```ts ignore-check
export type SubagentListEntry =
  | ({
    readonly kind: 'child'
    readonly id: SessionId
    readonly activity: 'running' | 'inactive'
    readonly hasChildren: boolean
  } & (
    | { readonly mode: 'one-shot'; readonly label?: string }
    | { readonly mode: 'continuable'; readonly label: string }
  ))
  | {
    readonly kind: 'diagnostic'
    readonly id: SessionId
    readonly reason: 'corrupt' | 'unsupported' | 'unavailable'
  }
```

对每个枚举出的 child，阶梯取值结果按四态映射成行：

| 阶梯取值结果 | 行 |
| --- | --- |
| 快照含非 null 的 `subagent` 身份 | child 行 |
| 快照在、`subagent` 为 null 哨兵或 key 缺席，且 child **inactive** | diagnostic 行，reason `corrupt`（定局残骸：无、损坏或版本不认识的描述符，不再细分） |
| 快照在、`subagent` 为 null 哨兵或 key 缺席，且 child **running** | 行不出现（创建窗口：描述符尚未追加，与旧实现同窗口 omit） |
| cold 整读失败 | diagnostic 行，reason `unavailable` |

- `unsupported` 不再被产出：类型与 wire 枚举按「数据结构保持现状」留存该成员，本记录留档其为不再产出。
- descriptor-less 定局残骸从旧实现的 omit 归入 `corrupt` diagnostic——库里的坏、死子会话可见，不静默消失，这正是保留 diagnostic 的原始动机。
- 任一注册 unit 的 fold/schema 在该 child 日志上抛错，同样收纳为该 child 的 diagnostic 行，reason `corrupt`——确定性数据故障，对齐旧实现 `SESSION_QUERY_CORRUPT_SESSION`→`corrupt` 的映射语义；live 与 cold 同待遇，逐 child 隔离，sibling 与列表本身不受影响。它与「无值 + running → omit」正交：创建窗口是「尚无数据」，fold 抛错是「数据坏了」——running 的中毒 child 也出 `corrupt` 行而非 omit。

已知边界偏差（有意接受，随本记录留档）：

- 死于发布窗口的 fork child，seed 里若有祖先描述符，last-wins 会给出祖先身份，误现为 child 行；恢复仍按 own-suffix 折叠权威失败（`NOT_RESUMABLE`）。旧实现靠 `seedLength` 过滤将其 omit；projection unit 看不到 header，接受此残骸级偏差（`subagentTiming` 有同类既有暴露）。
- own suffix 出现多个描述符，旧实现判 corrupt，现 last-wins 取末者（提供方约定本就保证恰一）。
- live/persisted header 冲突，旧实现是 per-child corrupt；现枚举 live 优先、不做一致性校验，冲突不再被察觉，以 live 记录成行。
- 损坏存储的源读失败（如坏 surface 被冷读整读拒收），旧实现映射 per-child `corrupt`，现统一成 `unavailable` 行（读侧无从区分成因）。
- 未知 parent，旧实现经 session-query 抛 not-found（「parent session … was not found」）；现自管合并对不存在的 parent 得到空子集，枚举返回空列表，wire 上后续操作落到 child 级 subagent-not-found——语义与文案的静默变化，显式接受。
- rung 2 的更晚事件窗口：cache 行恰在首个自有描述符之后落盘，日志随后追加第二个自有描述符（或 malformed 载荷置 null 哨兵），且进程在下一次 checkpoint 前崩溃——此后冷列表的 rung 2 凭 seq≥seedLength 门持续供出行内旧身份（第一个自有描述符的值），与权威重折（last-wins 第二个）分歧，且 rung 2 命中期间不触发重折、无从察觉。边界三条：①前提是同一 child 出现第二个自有描述符，违反建档提供方「恰追加一次」约定，属损坏类数据，与多描述符偏差同族同源；②需「损坏 + 崩溃错过 checkpoint（turn/end 与 disposal 两个 mandatory 点及 count/interval 节流点全部未及）」双条件同时成立；③健康 child（恰一自有描述符）不受影响——seq 门放行的正是唯一真身份。自愈条件：该 child 任一次 live 运行（turn/end mandatory checkpoint）或任何触发 cache.write 的时点，都会以新 fold 整行覆写（whole-record replace），rung 2 随即供正；权威路径（rung 3 重折、live snapshot、resume 折叠）自始正确，分歧只存在于持续冷、行未再更新期间的列表读。机制修法不采：gate 对账需知日志末端 seq，冷路径零读不可得；cache 行携 revision 是 opaque token，无法比较且跨域改 schema——按「cache 永不为权威」总纲归档为接受项。

消费面：wire、tool、GUI 的 diagnostic 处理**全部保持原状零改动**（`list_agents` 的 description 与 output schema 未动；该插件仅加载要求收窄——inject 去掉 `sessionQuery`）。行为上动的只有 apiproxy：路由段的 `hasSubagentDescriptor()` 扫描已删除，`hasSubagentOwner` 只看 `header.origin`——pre-#1569 的无 `origin` 存量不再被认作 subagent 属主，其本就不进目录，pre-release 立场接受；`subagents.history` 与 `session.history` 同源对齐——live child 用内存事件与注册表水位快照，cold child 用 `inspectServable` 直读持久化并 detached 折叠，不经查询服务，SESSION_QUERY_* 错误臂随之退役，wire 形状不变（`history` 的 JSDoc 措辞改为 live 内存快照／cold 持久日志双臂）。

### 改动落点

| 区域 | 文件 | 改动 |
| --- | --- | --- |
| subagent | projection.ts、projection-types.ts、index.ts | 新 `subagent` unit 与注册 |
| subagent | list-children.ts 及类型 | 重写为自管枚举 + 投影阶梯四态映射；删 session-query 依赖、逐 child 事件读取与就地分类机器；错误码 `SUBAGENT_CONTROL_SESSION_QUERY_UNAVAILABLE` 换 `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE`；新增可选依赖 dsh-session-projection-cache（纯加速读取，缺席跳过） |
| host/apiproxy | api-proxy.ts | 删 `hasSubagentDescriptor`，属主判定只看 `header.origin`；`subagents.history` 与 `session.history` 同源——live 用内存事件与注册表水位快照，cold 用 `inspectServable` 直读持久化并 detached 折叠，不经查询服务，SESSION_QUERY_* 错误臂随之退役 |
| tool | tool-subagent-control/list-agents.ts | 加载要求收窄（inject 去 `sessionQuery`）；model-visible schema、描述与渲染零改动 |
| wire/client | api/subagents.ts、runtime sessions/service.ts、GUI | 类型、行形状与 diagnostic 处理**零改动**；api/subagents.ts 仅 `history` 的 JSDoc 措辞改为双臂 |
| core/session、session-persistence、session-projection(-cache)、session-query(-sqlite) | — | **零改动** |

## 考虑过的替代方案

**mode/label 进 SessionHeader。** 零读保证最强——列表只看 header 就能成行。但 header 形状变更传导两个 persistence backend 与 header 兼容检查；SQLite 存量直接拒收，JSONL 存量只能 unknown 降级或 backfill。读时现算对存量的答案是「第一次列表一次 `inspect` 现算」，不碰持久格式。

**projection-cache 阶梯（`cachedSnapshot ?? coldSnapshot` 加 fail-soft 写回）。** 机制成立——session-projection-cache 的 checkpoint 阶梯本就为冷读设计。但 checkpoint 写回是一套由列表驱动的派生数据持久化与失效编排（floor/identity/putSoft）；被否的是这套编排作为主机制。定稿的第三级阶梯后来以只读方式机会性复用该缓存作第二级——无写回、无编排、缺席即跳过。

**给 persistence 加有界读原语抢救存量。** 为一次性问题新开 persistence 原语；被读时 `inspect` 整读取代——存量第一次被列表时的整读就是取值本身。

**list 行 mode/label 可选化。** 健康数据必然可算；可选化只是把垃圾数据的处理复杂度外溢给全部消费方——每个消费面都要长出过滤分支和 unknown 展示态。强约定加算不出即 omit 更干净。

**彻底删除 diagnostic 行。** 删除把库损坏的可见性外溢为行静默消失，wire/tool/GUI 反要各自承担约定与快照变更；而保留只需列表侧按投影值缺席与 activity 派生分类，零成本。库里的坏、死子会话必须可见是 diagnostic 存在的原始动机，保留后消费面整体零改动。

**registry 计算失败通道（per-unit 容错加 `failures` 附加字段）。** 为把损坏、版本不认识报告给消费方，由 registry 捕获 unit 异常并在 snapshot 旁附 per-key 失败态。被否：failure 不是值，也不必是通道——unit 永不抛错，缺席本身就是信号，「大不了算出来没有」，如何呈现是消费方要考虑的事。一个独立观察：vendor cordis 的 `emit`（[vendor/cordis/src/events.ts](../../../../vendor/cordis/src/events.ts)）对 listener 抛错零捕获，投影驱动挂在 `session/event` 上时 unit 异常会沿 emit 逃逸——这加重了「unit 永不抛错」纪律的分量，但 emit 容错的修复不属于本记录范围。

**值随 query 索引 preparation 落库。** 投影值在 sqlite backend 的对账重建里折叠落进 session 索引行，读稳态零日志：`projectionsFor` 批量读面、行值随 `(key → stateVersion)` 注册集存储的失效对账与 SCHEMA bump。整体退役：方向反了——查询基础设施被迫认识领域词汇（投影列、注册集对账），而唯一消费方 subagent 列表读时现算即可满足；消费方归零后，这套派生持久化没有存在理由。`SESSION_QUERY_PROJECTIONS_UNAVAILABLE` 随读面一并删除。

**subagent 手工 parse 加进程 memo 加创建播种。** 为摘除 session-query 依赖，由 subagent 包自己解析描述符事件、以进程内 memo 避免重复整读、创建时播种初值。被已交付的阶梯取代：live 走 `sessionProjections` 水位缓存、cold 走 `registry.restore`，复用 registry 这一份折叠权威，不再出现第二份描述符解释逻辑，也不引入进程态缓存与播种时序。

**session-query 输出面 DeepReadonly（读路径改造实验）。** 公开查询输出深只读化，以在类型层面钉死不可变借用。实证否决：3 处 TS2589（类型实例化过深）加 17 处数组位传染（消费方数组方法与展开处被迫跟改）；深层不可变由 core/session 的运行时深冻结保证，该读路径改造未纳入本记录。

## 验证

`packages/subagent/subagent/tests/list-children.spec.ts` 重写为本约定：无 persistence、query 服务与继续运行时的 live-only 列表；registry 缺席时零 children 也响亮报 `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE`；live child 全程零 `inspect`、cold child 每次列表恰一次；多描述符 last-wins 取末者；损坏载荷与未知版本折为 `corrupt`；冷读失败映射 `unavailable` 且下次列表重试；fork seed 里的祖先描述符按该身份成行（偏差一钉住）；普通 fork 与无 subagent origin 的后代不入列也不计入 `hasChildren`；`createdAt`→id 排序；提供方未挂载不影响列表；压缩与未压缩孪生一致；预中止、持久化列表与冷读取消三例归一 `CANCELLED`；空列表与稳定错误码。敌意 unit 双路探针（`apply` 惰性置毒、`view` 引爆）证明任一注册 unit 在该 child 日志上的 fold/schema 抛错，在 live 与 cold 两条取值路径上都收纳为该 child 的 `corrupt` 行，sibling 与列表本身不受影响。第二级例：own-seq 身份直用零 `inspect`、fork 种子祖先身份（seq 落在 seed 区间）被门拒绝落底、行内无身份（null 哨兵或 key 缺席）落底、cache 服务缺席落底、缓存行中毒静默落底重折；冷路径 lifecycle 篡改按见证七字段逐一（`it.each`）降级为 `corrupt`。`tool-subagent-control` 的 list-agents 测试随加载要求收窄更新；`optional-session-query.spec.ts` 随依赖消失删除；既有无密钥快照（`subagent-list-agents` 等）零变化，钉住健康路径的 wire 与 model-visible 面不变；新增无密钥快照 `subagent-diagnostic`（examples/headless-agent）钉住四态映射的诊断分类——descriptor-less 定局残骸成 `corrupt` 行等模型可见变化。

## 后果

- live child 的列表全程零日志读；cold child 在 cache 未挂载或未命中时每次列表一次 `inspect` 整读，成本与其 transcript 大小成正比、随列表频率重复——定案「算完即止」，不自建缓存、不回写，同 id 短期重复整读可命中准备阶段 LRU 但列表不依赖它。
- subagent 列表不再要求 query backend：纯 live 与无 persistence 的部署都能列表；`SUBAGENT_CONTROL_SESSION_QUERY_UNAVAILABLE` 消失，`list_agents` 插件加载不再要求 `sessionQuery`。
- 身份解释只存在于 registry 注册的一份 unit：列表三级阶梯与 GUI history 冷读走的都是 registry 与 cache 的既有读法（snapshot、cachedSnapshot、restore），不存在旁路折叠；若未来某消费面绕开 registry 手写折叠，各读面的值将漂移——这是本设计要求维持的纪律，不是机制保证。
- per-child 隔离回归：单 child 冷读失败只损失该行，healthy sibling 不受影响；persistence 列表失败仍使整次枚举失败。
- 诊断与枚举语义留下六处边界偏差（stillborn fork 祖先身份误现、多描述符取末者、header 冲突不再被察觉、损坏源读失败由 `corrupt` 转 `unavailable`、未知 parent 由 not-found 改为空列表、rung 2 更晚事件窗口），完整语义见已知边界偏差清单；前四处为残骸级数据的展示或分类偏差，未知 parent 一处是查询语义的静默变化，rung 2 窗口一处是损坏加崩溃双条件下可自愈的缓存供值分歧；恢复鉴权均不受影响，显式接受。
- pre-#1569 的无 `origin` 存量不再被认作 subagent 属主；其本就不进目录，pre-release 无兼容承诺。

## 相关

- [durable-subagent-catalog 与 list_agents](../feature/2026-07-22-durable-subagent-catalog-and-list-agents.md)——被本记录部分取代：描述符仍是 mode/label 的持久权威与折叠输入，列表的枚举与取值改为自管合并加投影阶梯。
- [session projections 与命令生命周期日志](../../proposed/architecture/2026-07-27-session-projection-and-command-log.md)——registry 约定的权威；本记录为其新增 `subagent` 身份 unit，并成为 snapshot/restore 两处既有读法的消费实例。
- [web subagent conversations](../feature/2026-07-27-web-subagent-conversations.md)——`SessionHeader.origin` 的出处（#1569），身份判定去日志化的前半步；其 history 冷读（inspect 前缀加 registry 折叠）是本记录取值阶梯的同款先例。
- [发布前可复用的 Session 准备阶段](2026-08-05-session-preparation.md)——`inspect()` 冷读与 LRU 复用；cold child 整读的成本模型建立其上。
