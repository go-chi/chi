# Agent Note: Remote 事件投递（ctx.remote.$on）

Status: implemented

[English](2026-08-10-remote-event-delivery.md) | 中文

## 问题

[Typert Remote 方法调用](../../implemented/architecture/2026-08-02-typert-remote-method-calls.md)只覆盖「一次请求一个结果」的定向调用，明确把 Session 事件流与有状态交互留在别处；Host 向消费端的**单向事件推送**因此仍然全部压在遗留的 API Proxy 上。

Host 拥有 `agent-preset/selected`、`commands/change`、`credentials/updated`、`llm/adapters-updated`、`settings/document-updated` 这五条单向事件；它们既不依赖 AgentScope，载荷也本来就是 JSON。过去每条都要穿过 host cordis 事件、apiproxy 手写帧、client/runtime 手写桥和 Client 事件别名才能抵达 UI，而这些层没有陈述 owner 事件之外的新事实。

那份重复声明还是**有损**的：client 侧写成 `settings/changed(ns: string)`，brand 类型在这一跳被拍平成裸 `string`，与 Remote 方法侧「消费端类型指向业务包唯一符号」的既有契约相反。

## 决策

消费端 Remote 面持有一个单向事件订阅动词 `ctx.remote.$on(event, listener)`；**名单驱动、原样转发**：

- `packages/api/remotes/src/remote-events.ts` 持有一份可转发 host 事件名单，它同时是「消费端能订阅什么」的唯一控制点。旁边的 `src/types.ts` 由它派生类型投影并填充 selection 座位，按包约定保持纯类型。两个文件**都同时列进本包 host 与 client 两个 face 的 `files`**，两侧读同一份。
- wire 上的事件名 **就是 host cordis 事件原名**（`settings/document-updated`），不加 `host/` 前缀；载荷 **就是 host 的实参列表**，逐元素原样过 JSON，无投影、无脱敏、无改名。
- 载体**寄生现有 host 流**：`HostFrame` 加一个包裹帧 `host/remote-event`，不新开下行通道。
- 事件**签名**不另立表：owner 包把自己的 cordis `Events` 声明搬进 client-safe 的 `./types` 纯类型出口，两侧读**同一份**——`$on` 的 listener 类型就是 `Events[Event]` 本身。「原样」不需要证明，是构造性成立的。
- 但**只借 cordis 的类型形状，不接 cordis 的事件系统**：投递语义、注册表、异常处置全归 Typert 自己。

一条 `Events` 条目若签名里够到了 host-only 符号（Service、`Agent`、Context 等），处理方式是**把代码拆到能干净落进 `./types` 为止**；不接受「一半留 index、一半搬走」的分裂声明，也不接受在 `./types` 里造结构等价的影子类型。这五个包都不需要拆：它们的条目只够到纯类型。agent-presets 把原词汇模块改名为 `preset.ts`，让导出的 `types.ts` 专门承载 client-safe 事件声明。

五条事件全部走这条路径，专用帧与 Client 别名都已删除。模型消费方直接订阅 `llm/adapters-updated` 和 `settings/document-updated`；preset 消费方订阅 `agent-preset/selected`。真正需要投影或去重的数据仍保留专用帧。

`skills/change`、`tools/change`、`system-prompt/change` 是同形状的纯失效事件但目前**没有任何消费者**，按「每个抽象都要有当前 owner 与需求」不进名单，只作为扩展位记录在此。

### 消费端契约（dsh-typert-protocol）

type-meta 加一个**形状谓词**、一个**选择座位**和 `TypertClientRemote` 的**一个**成员；零运行时代码：

```ts
import type { Events } from '@deepseek-ai/cordis'

/** Cordis events shaped for one-way remote delivery: no Scope binding, void return. */
export type TypertForwardableEvent = {
  [Event in keyof Events]: unknown extends ThisParameterType<Events[Event]>
    ? ReturnType<Events[Event]> extends void ? Event : never
    : never
}[keyof Events]

/** The Host assembly's forwarding selection; api/remotes' allowlist fills it, no other package does. */
export interface TypertRemoteEventSelection {}

/** `$on`'s legal keys: selected, and present in the current compilation face. */
export type TypertRemoteEvent = Extract<keyof Events, keyof TypertRemoteEventSelection>
```

```ts ignore-check
/** Subscribe to one forwarded Host event; the returned disposer belongs to the calling fiber. */
$on<Event extends TypertRemoteEvent>(event: Event, listener: Events[Event]): () => void
```

`Events` 按程序解析：host 程序里是 host 事件全集，client 程序里是 client 编译面看得见的那些——同一个谓词在两侧各自成立，不需要把 host 声明拖进 client。

**契约把消费动词与载体交接分开**：消费方用 `$on` 订阅，持有 host 帧 sink 的一方用 `$dispatch` 把解码后的帧交进来。它**不能**是一个跨插件的模块级函数：client bundle 纯度门禁（`packages/client/tsdown.client.ts`）只放行 `CLIENT_EXTERNALS`、`INLINE_SAFE` 那层 wire 契约与 `/remote` 生成物三类值导入，而靠 inline 绕过会把 `ClientRemoteService` 复制一份进 runtime bundle、令 `instanceof` 恒假。cordis 服务方法正是该门禁指定的协作形态：

```ts ignore-check
$dispatch(event: string, args: readonly unknown[]): void
```

持有 host 帧 sink 的 client/runtime 直接调用它，帧不经中转事件即到达订阅表。`event` 形参是 `string` 而非 `TypertRemoteEvent`：这是 wire 边界，收到无人订阅的名字即静默丢弃。

投递语义与 cordis 事件系统不共用实现：只有单向投递，没有 waterfall / bail / parallel / serial 模式，也没有 `@mode` 概念（`ReturnType extends void` 是这条纪律的静态表达）；不绑 `this`；没有 `EventOptions`、`prepend`、优先级；按注册顺序逐个调用，单个 listener 抛错就地隔离并记日志——它绝不能拖垮帧泵（沿用 `ConnectionController` 对 sink 异常的既有处置）。

### 名单：两个 face 共读的同一份声明

`packages/api/remotes/src/remote-events.ts` 同时列进 `tsconfig.host.json` 与 `tsconfig.client.json` 的 `files`，是名单的**唯一家**；`src/types.ts` 由它派生类型面：

```ts
// remote-events.ts — the value
export const API_REMOTE_FORWARDED_EVENTS = [
  'agent-preset/selected',
  'commands/change',
  'credentials/updated',
  'llm/adapters-updated',
  'settings/document-updated',
] as const

// types.ts — the type face, derived
export type ApiRemoteForwardedEvent = typeof API_REMOTE_FORWARDED_EVENTS[number]

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteEventSelection extends Record<ApiRemoteForwardedEvent, true> {}
}
```

于是**加一个事件只改这一行数组**：类型投影、`$on` 的键面、host 的转发循环全部从它派生。`ctx.remote.$on('slots/changed', …)`（client 本地事件）或 `$on('skills/change', …)`（名单没开）都是**编译错误**。

host 半再加一处形状断言，把 host 事件词汇的约束落到同一份名单上：

```ts ignore-check
API_REMOTE_FORWARDED_EVENTS satisfies readonly TypertForwardableEvent[]
```

写成表达式语句而不是命名常量：后者会被 `noUnusedLocals` 判为未使用（下划线前缀只豁免参数）。它卡住三件事：**名字合法**（谓词以 `keyof Events` 为基）、**不绑 Scope**（`goal/changed` 那族的 `ThisParameterType` 不是 `unknown`，被排除——「不依赖 AgentScope」的静态表达）、**单向**（非 `void` 返回的 waterfall/bail 形状被排除）。

**「原样」不在任何地方证明，而是构造性成立**：`$on` 的 listener 类型取自 owner 包 `./types` 里那一份 cordis `Events` 声明，host 转发读的是同一份，不存在可以彼此偏离的第二份声明。

载荷 JSON-safe 交给运行时：apiproxy 转发前用 `dsh-session` 的 `isJsonValue` 逐元素校验，不合格**抛错 fail loud**（这是名单配置错误，不是外部输入）。

### 线协议（apiproxy）

```ts ignore-check
| { type: 'host/remote-event'; event: string; args: JsonValue[] }
```

zod 侧 `args: z.array(z.unknown())`：帧本身来自 `JSON.parse`，元素必然已是 JSON 值，结构契约由 owner 包的 `Events` 声明承担——与既有 `session/projection` 帧的 `value` 同 posture。

`events.host()` 打开时按名单挂监听；每条流自持 disposers，无需新增广播集合或派生失效 listener。


`api/events.ts` 是浏览器侧也要编译的 wire 契约文件，所以它引用的每个类型都必须走 owner 包的 **client-safe type-only 子路径**，绝不能走包根出口。实证：从 `@deepseek-ai/dsh-session` 根引一个类型，就把根出口的 `declare module 'cordis' { interface Context { sessions: SessionStore } }` 拖进 client 编译面、把 client 的 `ctx.sessions: ISessions` 顶掉，在完全无关的 `ui-input-trigger` / `ui-conversation` 里炸出 18 条错。`JsonValue` 因此需要 `dsh-session/src/types.ts` 补一条 re-export。

### apps/web 的 browser e2e 属于 Host 面

`apps/web/tests/**` 那批 e2e 在**根 `tsconfig.host.json`** 做类型检查：它们在进程内起真 harness、直接摸 `ctx.apiProxy`、host `SessionStore.get/create/flush`、`ctx.sessionProjectionCache`。**运行时用浏览器 ≠ 类型上属于 client 程序**——把它们搬进 client 聚合会立刻报 21 条错，因为一个 program 装不下两个 face 对同一个 Context key 的合并。

由此得到一条对本设计要紧的连带纪律：**这些测试从客户端包 import 值或类型，会把该包的整个 project——以及它引用的每个 project——拖进 Host 构建图**。`ui-settings-general`/`ui-settings-models`/`ui-permission`/`ui-commands` 四个消费者 references `api/remotes` 的 client face，而该 face 必须等 host tsdown 生成 `@deepseek-ai/dsh-goal/remote` 才能编译，于是形成构建期死锁：host tsc → api/remotes client face → `goal/remote` → host tsdown → 排在 host tsc 之后。

所需的客户端符号在测试侧**镜像**了一份（`scaffold.ts` 导出镜像后的 welcome-notice 常量，两个 chat e2e 直接引 `dsh-client-runtime/client` 因为 `runtime` 工程本来就在 host 图里），从而让那 4 个消费者离开了 host 图；`apps/cli/tsconfig.json` 里 15 条 client 工程引用随之失去 owner-map 职责，已一并删除。镜像值与源逐字一致，漂移的表现是选择器失配或通知未被抑制，都是响亮失败。

### 改动清单

| 位置 | 改动 |
|---|---|
| `dsh-typert-protocol` | `src/types.ts` 加 `TypertForwardableEvent`、`TypertRemoteEventSelection`、`TypertRemoteEvent`；`TypertClientRemote` 增 `$on` 与 `$dispatch`。纯类型，零运行时 |
| `api/gateway` client 半 | `ClientRemoteService` 实现 `$on`（订阅按注册项寻址、`ctx.effect` 归属调用方 fiber）与 `$dispatch`（快照后按注册顺序派发，收容抛出或拒绝的 listener） |
| `api/remotes` | 新增 `src/remote-events.ts`（名单值）与 `src/types.ts`（类型投影 + 选择座位），两者都双列进两个 face 的 `files`；`./types` 出口 + `files` 补 `lib/types/**/*.js`；host 半加形状断言并 `import type {}` 三个 owner 包的 `./types`；client 半 `export type {}` 那三个 `./types` 与 `@deepseek-ai/dsh-api-gateway/client` |
| 根 `tsconfig.base.json` | 加 `dsh-settings/types`、`dsh-credentials/types`、`dsh-api-remotes/types` 三条 `paths`，全部指向**源**平面 |
| `dsh-commands` / `dsh-settings` / `dsh-credentials` | `interface Events` 子块移入各自 client-safe 的 `./types`（settings/credentials 新建该出口，brand 与纯类型一并移入，index 继续 re-export 并留住构造器；`files` 补 `lib/types/**/*.js`） |
| `host/apiproxy` | `HostFrame` 增 `host/remote-event`、删除五个专用变体及其 zod；`events.host()` 按名单挂监听并通过 `assertJsonArgs` 校验 |
| `dsh-session` | `src/types.ts` 补 `export type { JsonValue }`，让 wire 契约文件能走 client-safe 子路径 |
| `client/runtime` | 五条 Client 事件桥分支收敛为 `ctx.remote.$dispatch(frame.event, frame.args)`，并删除重复声明 |
| 5 个消费者 | ui-commands / ui-settings-models / ui-settings-general / ui-permission / ui-agent-preset 改订 `ctx.remote.$on(...)`；照 `ui-goal` 先例 type-only 引 `@deepseek-ai/dsh-api-remotes/client` 并把 `'remote'` 加进 `inject` |
| `client/connection` | fixture 的 `emitHost` 造 `host/remote-event` |
| `apps/web/tests` + `apps/cli` | 客户端符号镜像（见上节）；`apps/cli/tsconfig.json` 删 15 条 client 工程引用 |

## 备选方案

**给 Remote 事件新开一条通用下行通道**（`ctx.connection.rpc` 的推送对偶，第三条 WebSocket）。最符合「Connection 独占载体、Gateway 不碰传输」；但要同时改 host 下行、`WebApiClient`、`ConnectionController`、fixture 与 web e2e 各一条流，代价与本次收益不匹配。寄生 host 流的代价是新契约暂时寄居在 legacy 帧联合里——host 流将来整体搬家时它随之搬走，消费端契约不变。

**在 type-meta 立一张独立的 `TypertRemoteEventMap`，让 owner 包 declare-merge 进去**。消费端键集会精确等于「被声明为可远程投递的事件」；代价是每条事件的签名要在 cordis `Events` 之外**再写一遍**，于是需要一条双向 `extends` 的等价性证明来防漂移，还要给三个 owner 包新增 type-meta 依赖。共用同一份 `Events` 声明让等价性变成构造性成立，这张表因此不立。

**让 typert generator 从 host `Events` 声明生成事件投影**（codec + `.d.ts` + 声明映射，与 `/remote` 同族）。generator 已经在分析 host 事件；但它拿不到投影与脱敏语义，且要动生成器与构建面。原样转发这条路本就不需要投影。

**给可转发事件加载荷投影函数**（`{ 事件名, 投影, zod }` 转发表）。能一举覆盖 `models-changed` 的 fan-in 与 workspace 的 view 派生；代价是投影逻辑与载荷类型手工对齐，回到方法侧刚刚消灭的中心表形态。

**把 apps/web 的 browser e2e 搬进 client 聚合**。看似「客户端测试归客户端面」，实测立刻 21 条错：它们用 host 服务，而 client 程序里 `ctx.sessions` 是 `ISessions`。已否。

**给 `directory-picker-browse`/`-native` 做 host/client 双 face 切分**，从根上让客户端包不进 host 图。方向正确（它们确实是未切分的双半包），但改动落在别人属地，而收益只是「构建图更干净」——本设计在测试侧镜像客户端符号之后已经不需要它。**已评估不做**。

## 验证

钉住该行为的东西：

- 一个真组合测试：host 每 emit 一次，真实 host 流就出一帧 `host/remote-event`，`event` 为 host 原名、`args` 与实参逐元素相等。
- 类型层负例拒绝三类候选：不是事件的名字、绑 Scope 的事件（`goal/changed`）、返回值非 `void` 的事件。`$on('slots/changed', …)`（client 本地事件）与 `$on('skills/change', …)`（已声明但未选中）都编译失败——因此 `$on` 的键面恰好等于名单。
- 消费端 `$on('settings/document-updated', …)` 把 `ns` 解析为 `SettingsNamespace`：brand 穿过 wire 存活。
- `$on` 的 disposer 归属调用方 fiber；同一个函数对象订阅两次时两条注册各自独立退订——按 listener 身份做键的表会把它们合并，所以订阅按注册项寻址。
- 投递同时收容抛出的 listener 与拒绝所返回 promise 的 listener：声明返回值是 `void`，没人 await 异步 listener，其拒绝否则会完全逃出这层收容。投递遍历快照，因此派发中订阅或退订都不会改变本帧的接收者集合。
- `assertJsonArgs` 直接单测，而不是从事件总线造畸形 emit：类型化的 `ctx.emit` 造不出来——名单内每条事件的载荷在静态上都是 JSON-safe 的。
- 五个专用帧、五条 Client 别名及其桥分支都不存在；各消费方直接观察 owner 事件。

## 后果

- **寄居在 legacy 帧联合里**：契约住在 apiproxy 的 `HostFrame` 中，读者可能误以为 apiproxy 拥有 Remote 事件。该帧的 JSDoc 点名名单归 `api-remotes`，apiproxy README 在 known limitations 记录这项寄居。host 流将来整体搬家时，包裹帧随之搬走，消费端契约不变。
- **两个文件打破了 api/remotes 的 face 互斥约定**：`src/remote-events.ts` 与 `src/types.ts` 同属两个工程，各自向共享的 `lib/types` 发射一份相同声明。内容逐字节相同、`.tsbuildinfo` 各自独立，实践上无害；README 的构建边界节陈述了这个例外及其成因（`paths` 指向源码面）。
- **载体交接是开发者可见的**：任何持有 `ctx.remote` 的 client 插件都能调 `$dispatch` 合成一条转发事件。这个暴露面早于该动词存在——先前由内部事件中转帧时，`ctx.emit` 同样可达——与 `connection/reset` 可被伪造成重连同一量级（client 是单一信任域）。测试只钉「交接到 `$on` 的转换」，不假装该端口鉴别调用方。
- **畸形实参在发射方的收容里失败，而非加载期**：`assertJsonArgs` 在转发监听内抛出，因此由发射 seam 自己的 listener 收容记录并丢弃该帧——响亮地出现在 host 日志里，而不是加载时或 emit 点。
- **测试侧镜像值可能漂移**：没有任何机制核对 `apps/web/tests` 中镜像的 client 常量与其源；安全网只是漂移会让选择器失配。规则写在 `apps/web/tests/README.md`，由 review 守；grep 级门禁经评估后刻意不做。
- **放弃的能力**：不支持投影或脱敏载荷、不支持 Scope 化事件（`agentCtx.remote.$on`）、重连不重放——这些都是纯失效信号，且 `connection/reset` 已覆盖重连后的重新拉取。mux 流的会话事件、可应答帧与快照基线不在范围内。
- **仍有 client 包留在 host 图里**：12 个工程（`connection`、`runtime`、`ui-slots` 等）经未拆分的 `directory-picker-browse`/`-native` 与 `api/gateway → client/connection` 仍可达 host 图。它们都能编译且不再牵连 api/remotes 的 client face，因此没有阻塞本次改动；拆分那些包能减少几个，但经评估后不做。两个 chat e2e 直接引 `dsh-client-runtime/client` 依赖 `runtime` 本来就在图里——属偶然而非保证。
- **invariant companion 不做运行期检查**：早先的修订曾在活事件总线上断言投递形状（`thisArg === null`、`mode === 'emit'`），这让 companion 与名单值耦合，并使 rolldown 把它提成第三个 bundle chunk——而机械推导的发布文件清单并不携带它。host 面的 `TypertForwardableEvent` 断言在编译期已拒绝这两种偏离，因此该 companion 是一个带说明的空 installer。
