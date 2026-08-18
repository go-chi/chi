# @deepseek-ai/dsh-cordis-client-runner

[English](README.md) | 中文

动态双半插件包的浏览器半。host 侧 runner 把每个定义的代码留在进程内存里，并经一条 `cordis/request-run` 事件向打开的页面发问「要不要运行它」；本包回答这个请求、把定义变成活的浏览器插件，并把 `dynamicCordisRunner/retract` 事件变回干净的页面。

## 它做什么

1. **事件订阅** —— 四条公告是转发的 host cordis 事件，所以本包经 `ctx.remote.$on` 消费 `cordis/request-run`、`cordis/request-run-resolved` 与 `dynamicCordisRunner/retract`，而 `$on` 的键面就是 api-remotes 的白名单。
2. **闭包求值** —— 浏览器半的源码作为一个 async 函数体运行，其参数即符号面（`React`、`console`、`styles`、`host`，外加遮蔽 `setTimeout`/`fetch`/`require` 的教学陷阱）。无 JSX、无 TypeScript、不能 import 模块。
3. **guard 门面** —— `apply` 收到的是真 fiber ctx 之上的白名单代理：生命周期动词，加上**返回的 plugin 自己在 `inject` 里声明**的服务（所以要用对象形态 `{ inject: ['slots'], apply(ctx) {} }` 才拿得到服务；裸函数没有声明位，拿不到任何服务）。`slots` 座位分配遮蔽 priority（注册即遮蔽，最新一次运行者胜出）；`theme` 座位把覆盖层的 source 钉成包 id，并把它的 disposer 挂到 fiber 上。
4. **loader entry** —— 加了 guard 的插件被塞进模块表，再经 `loader.create` 挂载，于是动态包与静态包共享同一套激活门控、fiber effect 清理与状态投影。卸载 = 移除 entry + 失效 factory + 撤下样式。
5. **run 编排** —— 一条 `cordis/request-run` 事件问这一页要不要运行某个定义。回答的那一方按顺序把 run 跑完：先 host 半、再取源码、再浏览器半，最后一次回答带上结果。用户按下「运行」本身就是授权，同样走这条编排，只是没有要回答的对象；而纯 host 定义的 run 到 host 半就结束了 —— 这里没有第二半可取、也没有第二半可装。
6. **包内 RPC** —— 包内的 `host.call` 经 `dynamicCordisRunner` Remote namespace（`invoke`）转给它自己的 host 半，三种路由失败码各自变成对应的教学错误。两个方向都只驮 JSON：省略入参会以 `null` 过线（所以 `host.call('listServices')` 合法，handler 收到 `null`），而生成的 codec 拒收的载荷（函数、`undefined`、类实例）会变成一条点明「哪次调用 + 约定是什么」的教学错误，而不是 codec 那个光秃秃的字段名。
7. **渲染期失败回流** —— 槽位注册表的 supervision 接缝（`slots.onEntryError`）对页面上每一次 entry 边界崩溃都会通知；凡属于本 runner 落座过的包，那**一次**观察会分两个出口：一路上行给撰写它的会话（`reportRenderFailure`，给模型看），一路发布到本包 face 上的 `renderFailures`（给面板那一行看）。归属以 component 身份为键，在 guard 的 `register` 代理落座时记下 —— 注册表原样保存 component，所以不需要再维护一份与之同步的 entry 台账。这条通道纯属事后诊断：不驮任何 settle 权威、绝不触碰 run 的最终回答，而且报告本身失败时只吞不抛 —— 不让一次崩溃变成两次。

## 生命周期

装载按 `(id, rev)` 对 live 态收敛：装载这一页已在运行的那个 revision 会**直接从 live 态回答**而不重装（所以被重播的 run 不会看起来没人回答），更新的 revision 顶替旧的，同一 revision 在 retract 之后再装则重新装载。同一定义的操作串行执行。

激活时什么都不装，刷新之后也不恢复 —— 一页只在有人回答了一次 run 请求、或有人在这一页主动要求时，才运行动态包。

## run 界面读什么、调什么

`ctx.dynamicCordisRunner` 就是全部的面:

- `activeRuns` —— 每个定义唯一的在途活动：`awaiting-approval`（要回答的 requestId，加上这次询问的会话、包名与用途）或 `orchestrating`（这次 run 是为哪个会话在跑）。两条臂都带会话，因为归组属于这次 run 而不属于它的阶段；待确认那条还带着询问自己的文字，因为 `cordis_define` 什么都不播 —— 一个请求可以点名上一次注册表读取没覆盖到的定义，那时这条活动就是那一行唯一的来源。界面从它渲染、自己不留副本 —— 这正是控件能活过 remount 的原因。
- `renderFailures` —— **本页**最后一次渲染崩溃，按定义索引（槽位、教学 message、以及这次崩溃是否已把 entry 从格位上摘掉），与 live 集合共用同一条通知通道。它按构造就是「本页当前」：包 stop、被 retract、或重新装载成功时即清空，所以界面可以直接照着渲染。host 那边另存一份「跨页面最后一次」给模型 —— 两份的归属与寿命本来就不同，界面**不要**改成回读 host 那份。
- `lastRunError` —— 本页自己那次尝试为何失败，按定义索引。它比活动活得更久：host 只拆失败请求自己启动的那半，所以一个页面可能看着 host 报告为「在跑」的定义，而自己什么都没装上。
- `approve(requestId)` / `decline(requestId)` / `startUserRun({ agentId, id, hasClientHalf })` —— 两条入口。三者都幂等（按 requestId，用户自发的 run 按定义 id），所以连点两次不会起两次 run。`hasClientHalf` 是必填：纯 host 定义没有源码可取，所以由调用方从它正在操作的注册表行里把这个事实说出来，而不是让编排器从一次失败的取码里反推。可回答的请求必然带浏览器半 —— 纯 host 定义是 host 自己起的，它不会去问页面。
- `subscribe()` / `getSnapshot()` / `isLoaded(id)` —— 这一页装了什么。`isLoaded` 是页面本地的事实，永远不等于 host 说的「在跑」。

## 模型体验

### 由模型发起那次 run 的最终回答

#### 模型看到什么

本包自己不贡献任何工具、提示词或上下文；它为一次 `cordis/request-run` 往返发回的回答，是它撰写并到达模型的第一样内容 —— host 把它变成那个被阻塞的 `cordis_run` 的结果。成功时带上已装载的 revision，以及（当浏览器半挂在这一页没有的服务上时）那些服务的名字。失败时带一个 reason：用户拒绝的 `rejected`、`host-half-failed`、或 `client-half-failed`；后者还带上本包自己的文本 —— 出错阶段（`evaluate` / `module-import` / `activate`）加上闭包、guard 或 fiber 的消息。guard 的教学错误（未声明的服务、被遮蔽的浏览器全局、返回值里没有 `apply`）正是经这个字段到达模型的。而装载之后、React 渲染时才发生的崩溃，走下面那条独立的事后通道。

#### token 影响

有条件且有界：每次 run 请求最多一个回答，花在 host 本来就会发出的那个 `cordis_run` 结果里。文本随数据而定（某个定义自己的错误消息），本包跨请求不留存任何东西 —— 一页后续的装载失败是页面本地诊断，在模型侧没有任何承载物。

#### KV cache 影响

只追加。回答只作为「本来就在途的那次请求」的工具结果到达模型、延长历史尾部；本包撰写的内容不会重写或重排更早的请求 token，因此原本可复用的前缀仍然可复用。同一定义的多次运行各自产出各自的结果，而不是替换更早那一个。

### run 落定之后的渲染期失败

#### 模型看到什么

一个装载得干干净净的浏览器半，仍可能在 React 渲染时崩溃，而那次崩溃发生在 run 已经被回答之后 —— 否则模型只会被告知「ok」，永远学不到。凡是本页落座过的包，其 entry 边界的每一次崩溃都会发回 host（`reportRenderFailure`）：点名槽位、说明这次崩溃是否已把 entry 从格位上摘掉（`abdicated`：包的 UI 是没了、而不只是坏了），以及一条写给作者的 message —— 崩溃文本，外加「文本里点到了某个被摘掉的浏览器全局、但文本自己没教」时补上的那句教学：绕过闭包陷阱的 `window.setInterval` 只会崩成 `is not a function`，它自己什么都解释不了。host 每包只留最后一条，经 `cordis_inspect` 透给模型；这条通道上的任何东西都不会进入 run 的最终回答。同一次观察还会落到 `renderFailures` 上给本页界面用 —— 一个观察者、两个出口，因为「跨页面最后一次崩溃（给模型）」与「这一页此刻正在显示什么」是两件寿命不同的事实。

#### token 影响

有条件，且其上界由 host 的留存策略决定、不由这一页决定：每次崩溃一条报告，而 host 每包只留最新一条 —— 所以一个反复崩溃的 entry 对模型的代价是一段话，而不是一张越来越长的清单。报告本身不会自带任何工具结果：模型只在主动去问的时候才为它付费。

#### KV cache 影响

自身没有。报告经 RPC 送出并被存起来，而不是追加进对话；模型是通过自己发起的一次查看读到它的，那次查看与任何工具结果一样只延长尾部。

## 已知限制与欠账

- **被拒绝的回答不会重试。** `resolveRequestRun` 的 ack 不读，所以当 host 拒绝一个陈旧的成功答复（`accepted: false` —— 这一页装载期间定义的 revision 被顶掉了），这一页会保留已装的东西、也不再重新编排。那次请求仍可作答（别的页面作答或调用方取消都能收尾），而顶掉 revision 的那次 stop 会 retract 掉这一页的陈旧装载。重试评估过、延后：竞态窗口只是一次往返内的一次 revision 递增。
- 插件声明了 `remote.dynamic`，因此在 host 侧 namespace 存在之前一直挂起，而不是装载一些永远够不到自己 host 半的包。
- 槽位准入（按部署的允许/拒绝清单）没有载体：下发行声明的是服务，不是目标槽位。
- guard 白名单是 host 侧沙箱门面的手抄孪生；抽取共享规格留待后续。
