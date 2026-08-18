# Agent Note: client 插件装载——普通包、dsh.client 插件与双阶段 boot

Status: implemented

[English](2026-07-23-client-plugin-loading-model.md) | 中文

> 范围：浏览器侧的插件装载机件——什么是插件、代码怎么到达、热重载如何搭在这套模型上。装载链归本篇所有；[Web 客户端架构笔记](2026-07-19-gui-web-client-architecture.md) 在装载问题上以本篇为准，继续拥有 slot、数据对象层与 React 面。

## Problem

host 侧，cordis 插件装载站在 Node 的模块机制之上——require cache 与内部 ESM loader 拥有模块身份与字节。vendored `@cordisjs/plugin-loader` 在这层基座之上实现插件治理与热重载，二者在唯一一道边界相接：`Loader.internal`。

浏览器客户端跑同一套 cordis 插件机制，因此底下需要同样的基座——而浏览器没有 Node 模块系统。

常规前端工程在构建期消化全部依赖：单一 bundle，external 由打包器解决，运行时无物可管。在此之上再做运行时模块管理，正是这里的特殊需求。client 因此拆成两层：上层是经同一份 vendored Loader 的 cordis 插件装载，下层是模块粒度的依赖管理——`dsh-client-modules`。

下层供给四项能力：external（平台清单）、远程到达（同源外部 classic script 加惰性工厂登记）、版本化（内容哈希 rev）、热更新（invalidate/prefetch）。

插件 bundle 独立构建在 Vite 模块图之外。若把响应文本塞进内联 script，浏览器只能看到一次动态源码执行：网络资源、生成 bundle、TypeScript/TSX 源码之间没有标准 sourcemap 链，性能 profile 与 stack 只能落到生成后的 `client.js`；模块系统还要持有整份源码文本，并把同一项到达职责拆成 fetch 与 execute 两道传输边界。

在此之上，client 与 host 插件以一致的方式注册与装载：包声明一次 `dsh.client`，host 把声明扫描进 boot 图，同一套 Loader 语义在两侧治理 entry。

第一代 client loader（`createClientLoader`）把这两层手写进了同一个函数。这一融合留下的是：没有卸载/重载路径（装载一次性，style 标签从不移除）、在三个文件间人肉抄写且早已漂移的依赖清单、一条供跨插件 import 走的模块表后门——既复制了 cordis 的服务机制，又把装载顺序变成正确性约束。下文的结构取代了它。

## Decision

### 两类包；`dsh.client` 即插件，别无他义

什么让一个包成为插件？只有一条规则：**一个包的消费方式一旦是 cordis 依赖注入，它就是插件包；在此之前它是普通包。**代码怎么到达页面不属于分类体系——到达方式由包的类别推得，而不是反过来定义类别。

- **普通包**是模块系统自身所需的绝对基座，加上尚未转成 DI 的库：react 家族、cordis、`@deepseek-ai/dsh-client-modules`（模块系统本身——它永远不可能是插件，因为模块先于一切模块）、web 壳内核，以及——暂时——ui-slots、web-react、ui-primitives。普通包打进壳 bundle、播种进模块表、对 host 图不可见。
- **插件包**是其余一切。每个都携带 `dsh.client` manifest（元数据清单）声明（`{ platform, inject, immediately? }`）和同一种统一形态：共享 tsdown 预设产出 `lib/client.js`，`exports["./client"]` 指向该 bundle。每个都是 host 编写的图里受治理的 entry。当前包括：connection、runtime、ui-theme、i18n、hmr（仅进 dev 图）、ui-layout、ui-sidebar、ui-conversation、ui-model-selector、ui-user-questions、ui-trajectory。

manifest 拥有包的装载约定：它的 `inject` 依赖边，加可选的 `immediately` 预取标记（缺省即 lazy）。负责组合的 app 只拥有名册。

新增一个插件包：声明 `dsh.client`，经共享预设产出 `./client` bundle，把包名加进负责组合的 app 的名册。除此之外无需任何交接。

普通包何时升格为插件？升级法则，记录在案让迁移路径保持诚实：**普通包在其消费方改用 cordis DI 之时升格为插件包，绝不提前。**三项升格在排队：ui-slots（现居 runtime 的 slots 机件——SlotRegistry、渲染器约定、root slot）、web-react（渲染器安装移入自己的 `apply`）、ui-primitives（组件经 slot/服务供给之时）。在那之前它们保持普通包身份，符号导出保持普通的静态 import。

四条边规则治理横跨两类包的 import。没有一条依赖任何单包标记：

- **插件 ↔ 插件的值 import 是构建错误。**与两侧的 `immediately` 声明无关——规则不得依赖一个人人可翻转的标记。协作走 cordis inject/服务。`import type` 豁免；类型链分毫未动。这条规则正是 `scopeOf` 是 `SessionRuntime` 方法、`transportError` 住在 `dsh-host-apiproxy` wire 层（它的 `RpcResult` 老家，内联安全）的原因。
- **插件 → 普通包的值 import 外置为 external**，按平台清单判定。清单是壳里的一个常量（`platform.ts`：react 家族、cordis、ui-slots、web-react、ui-primitives），tsdown 预设（external 判定）与 `seed.ts`（模块表预热）都 import 它。一个常量、两个消费方——人肉同步这一漂移缺陷类死透。
- **纯度门禁覆盖每个插件包。**它的三条分支：平台 import 外置为 external；INLINE_SAFE wire 层内联；其余任何 workspace 泄漏即构建错误。正是统一的 bundle 形态让这一覆盖不留死角——每个插件都经同一预设构建，没有包能坐在门禁之外。
- **壳自足。**内核（boot + loading 页）对任何插件包零值 import；其状态 store 为手写。大声失败的呈现不得依赖它所报告失败的那个系统。

### 一套模块系统，一个插件治理器

浏览器复刻 host 侧的分工。`dsh-client-modules`（`ClientModuleSystem`）坐上 host 侧由 Node 内部 ESM loader 占据的模块系统席位；同一份 vendored `@cordisjs/plugin-loader` 在两侧都坐治理席。二者的分界线一句话说尽：**模块系统拥有模块身份与字节——代码怎么到达、怎么登记、怎么变成导出内容；Loader 拥有插件生命周期——插件何时挂载、等待什么、如何拆除。**

`ClientModuleSystem` 是一张 lazy CJS 表。执行 bundle 只**登记**其工厂——bundle 调用 `window.__ModuleLoader__.load({ id, factory })`，此外什么都不发生。模块体的一切副作用（包括 CSS 注入）都住在工厂闭包里，在物化时运行：物化即该 id 的首次 `require`/import，此后记忆化。工厂若 require 一个已登记未物化的同伴，就递归物化它，因此任何地方都不存在排序。被要求 import 一个 id 时，表按固定分支顺序解析：种子词条 → 记忆化的记录 → 静态登记（壳自有模块，如 app-shell）→ 已登记的工厂 → 图行外部 classic script 加载 → 大声抛错。最后这一抛是构建期纯度门禁在运行时的镜像。系统还保管逐模块的簿记——名下 `<style data-plugin>` 标签 id、观测到的 require 边——并暴露 HMR（热模块替换）需要的两个动词：`prefetch(id)`（加载脚本、只登记工厂；并发调用共享同一在途任务）与 `invalidate(id)`（丢弃工厂与记录，下次到达即重新加载）。

vendored Loader 经其 `internal` 约定消费模块系统——唯一调用点是 `tree.import`——并拥有一切 entry 形状的事务：entry 创建、fiber 经 cordis 服务等待的激活（注入的服务未就位即保持 PENDING，服务 provide 时级联激活）、update/refresh、拆除。治理代码按 vendor 政策与 host 侧逐字节相同。浏览器化是壳 vite 配置里的编译期映射：一个 `node:module` stub 别名加若干 `process.*` define，使 `ModuleLoader.fromInternal()` 返回 undefined——这正是留给壳来填的空槽。模块系统挂载为 `ctx.modules`。

### 外部脚本到达与源码映射

每个图行的 `url` 交给一个带 `async` 的同源外部 classic `<script src>`。浏览器拥有网络请求与脚本执行；`load` 或 `error` 结算后节点立即移除，避免 HMR 累积失效节点。成功结算还要求图行对应的工厂 id 已出现在模块表中，否则到达失败；登记仍不运行工厂，副作用边界继续落在首次物化。

共享 tsdown 预设为每个插件产出 `client.js.map`，并把第一方源码路径重写成浏览器可识别的仓库形状 `/packages/<group>/<package>/src/...`。内联进 bundle 的其他 workspace 源码同样回到其 `packages/` 归属，依赖包路径保持原样；`sourcesContent` 承载源码，因此 host 只需在 `/plugins/<id>/client.js.map` 供给 map，无需开放源码路由。Vite 壳也产出 sourcemap，使壳代码与图外插件都能从 stack 和性能 profile 回到 TypeScript/TSX。

`rev` 继续作为脚本 URL 的查询参数和内容一致性锚点，bundle 与 map 都以 `no-cache` 供给。外部脚本的 `error` 事件不给响应状态与正文，因此失败诊断只报告 URL；同源 host 供给与构建期写入的 handoff id 是身份边界，`load` 后的工厂存在性检查负责拒绝未登记预期 id 的产物。

### 装载流程，端到端

从 `dsh web` 启动到 UI 出现之间发生了什么？三个阶段：host 组合并供给一张图，壳预取，然后 cordis 编排。

**host 侧——组合这张图。**

1. 负责组合的 app（`apps/cli`）把名册作为普通行放进它的 `cordis.yml` 配置树——client 插件包与每个 host 插件一样是 entry 行，包括无条件挂载的 `client-hmr` 行。名册行 import 失败由 `assertEntriesLoaded` 捕获；fiber reject 的行则由 `assertEntriesActivated` 报告原始 stack（[host boot 决策](2026-07-24-web-config-tree-boot-and-transport-layering.md)）。
2. `dsh-client-modules` 的 node 半（该包是双面的：浏览器半就是模块表）扫描 loader entry 的 package.json `dsh.client` 声明，组合出 `window.__DSH_BOOT__`：`{ rev, entries: [{ id, url, rev, inject?, immediately? }] }`。`inject` 边与 `immediately` 标记都来自 manifest，永不人肉抄写。它会拒绝没有已构建 `./client` bundle 的已声明插件，并把它们的 package/path 行归到一条源码构建要求下；畸形声明字段同样会让激活失败，host 检查会从 FAILED fiber 报告这两类错误。
3. 扫描是单包增量——不存在全量重扫代码路径。每次 cordis `internal/plugin` 发射把该 fiber 的 entry 名标脏（无 entry 的 fiber O(1) 丢弃）；微任务 flush 把每个脏名对账 live loader entries，包元数据（含「非 client 包」的否定结论）按名永久缓存，bundle 重哈希只经 `rebuilt(id)` 可达。激活趟从当前 entries 灌同一脏集合并同步 flush，初扫与稳态共享一条实现。每个 bundle 的内容哈希是其 `rev`（缓存失效 + HMR diff 锚点），行集合哈希进 `graph.rev`，每一行都作为脚本资源供给：`/plugins/<id>/client.js?rev=…`，对应 sourcemap 位于同一路径加 `.map`。图类型单源在 modules 包的 `./client` 出口——webserver 对图一无所知（它是朴素路由注册插件；bundle 路由和 index 渲染 tap 都由 modules 自己注册）。

为什么名册是 yml 行而不是扫描？因为哪些插件组合进一次部署是组合决策，不是包属性——一个在仓库中声明了 dsh.client 的包，不代表这次部署要挂载它，扫描发现无从替人做这个决定；node 半只扫描配置树实际挂载了的东西。

**第一阶段——模块面。**壳在图之上建起模块系统，然后并行预取每个 `immediately` 行。预取即加载外部脚本，只登记工厂。单行预取失败在这里被吞下：第二阶段 import 时会重试加载并拥有那次大声失败，因此一个坏行藏不住其他行。`immediately` 是预取标记——不是屏障，不是身份。包声明它，注册表把它带进图行。基础设施插件（connection、runtime、ui-theme、i18n，外加 hmr）声明它；UI 插件则径直按需到达。

**第二阶段——插件面。**

1. 内核挂载 vendored Loader，在任何 entry 存在之前就把模块系统注入为 `internal`。顺序有讲究：`tree.import` 的裸 import 兜底分支在浏览器里绝不能跑到。
2. 它为图中每一行创建 entry，外加 app-shell 伪行。装配 entry 是内核自己追加的壳自有代码——向模块系统静态登记，绝不进 host 图——因此与其余一切共乘同一套 entry 生命周期与状态覆盖。
3. 创建顺序不携带任何语义；fiber 经服务等待激活。
4. `settled` = 每个 entry 已创建 + `loader.await()` 完全停稳 + 一次全 ACTIVE 扫描。扫描列出每个 import 失败、FAILED 或 PENDING 的 fiber 及其缺失的服务。它存在的理由：cordis 的 inject 等待没有超时——这次扫描就是大声失败的兜底线。
5. loading 页的启动状态是经 `internal/status` 对真实 fiber 状态的投影。settled 翻转即一次性切换到真实 UI。

### 热重载：一个驱动插件，自行监视的 bundle

热重载是一项组合决策：web 组合包无条件挂载 `client-hmr` 行（一个常规的插件包），其 node 半带来 bundle 监视与 SSE（Server-Sent Events）通道；没有重建 watcher 改写客户端 bundle 时链路保持空闲。不应暴露它的组合可以禁用该行。

重建好的 bundle 怎么变成重载信号？hmr 的 node 半自己观察——没有构建器来通知它。它从 `ctx.clientModules.clientPath(id)` 读取图上各行的 bundle 路径，由 HMR 自持的单个定时器对当前图上的每一行做 stat 轮询。新增图行时，顺序固定为先同步取得 stat 基线，再立即调用 `clientModuleHost.rebuilt(id)`：在模块 host 算出图哈希之后、取得基线之前发生的写入会被这次立即重哈希捕获；取得基线之后发生的写入则会留下 stat 差异，供下一次轮询捕获。这避开了 `fs.watchFile`：它以异步首次 stat 建立基线，可能把构造期间的重建静默吸收进基线。监视集合的成员随 `onGraphChanged` 更新；消失的行撤下监视，轮询时缺失的 bundle 则让对应行保持标脏状态，文件重现时即使元数据相同也强制重哈希。mtime/size 变化或行处于标脏状态时，`clientModuleHost.rebuilt(id)` 是重哈希的唯一入口；当 `rev` 真的变了，node 半才在 `GET /plugins/events` 上广播 `rebuilt` 帧——这是一条系统级 SSE 通道，连接即发全量图，变更时发 `rebuilt` 帧，仅供呈现的 wire，永不进会话日志。轮询是刻意选择：inotify 在 weka 网络挂载上不触发，构建侧监视器需要 `--poll` 也是同一原因；轮询间隔是一个经校验的配置字段（默认 500ms），dispose（资源释放）会清掉那一个定时器。重建 bundle 则是任意一个 tsdown watch 进程的事——`scripts/dev-web.ts` 仍作为 watch 构建入口保留，其包清单在启动时扫描 `packages/*/*/package.json` 按 dsh.client 发现——构建器与 host 共享零协议。写一半的 bundle 被撕裂读取会自愈：写入完成期间 stat 持续变化，下一个轮询节拍会再次重哈希并广播最终的 rev。

浏览器侧，驱动插件每帧重载一个插件，串行执行：

1. `invalidate`——丢弃陈旧的工厂与记录。工厂还活着会让下一步变成 no-op。
2. `prefetch`——加载外部脚本并登记新工厂，旧 fiber 此刻仍在服役。
3. `registry.delete`——先于任何 fiber 操作。裸做 fiber dispose 会触发 vendored Loader 的自 dispose 分支，把 entry 永久停用。
4. 排空旧 fiber 的各 disposer。
5. 移除名下的 `<style data-plugin>` 标签。
6. `entry.refresh()`——重新 import，物化新工厂。CSS 在这里重新注入，沿用同一批稳定标签 id。
7. `fiber.await()`——让失败大声重抛。

每个插件都共享同一套语义；`immediately` 行的重载与 lazy 行分毫不差。依赖级联不花一行 client 代码：fiber 的激活纪元串接着它各服务提供方的 uid，因此换掉提供方的 fiber，每个依赖方都会经 cordis 本身重新装载。重载 connection 或 runtime 会级联整个 UI——正确，虽然重。

支持边界，如实陈述。重载粒度刻意做粗：全新 fiber、全新组件、React 状态丢失、数据层不动——react-refresh 级的状态保留与「重执行 bundle 即重跑工厂」相冲突，属刻意不做。普通包（react 家族、壳内核、尚未升格的库）不是 entry：改它们意味着壳重建加整页刷新。v1 不做回滚：import 失败让 entry 失去 fiber，下一个 rebuilt 帧从头重试；apply 失败留下 FAILED fiber 交给状态投影；两者都大声记录。自我重载可行——在途的重载在旧 bundle 的闭包里跑完，新的 apply 再开一条新 SSE 通道——但空窗期到达的帧会丢失，下次重建会再次通知。一处已知的仅限 dev 竞态：rebuilt 帧与仍在途的 boot 到达重叠时共享那次到达的任务，可能物化重建前的字节；下一帧自愈。

## 包盘点（现状 → 长期）

| 包 | 角色 | 现状 | 长期 |
|---|---|---|---|
| react 家族 / cordis | 平台单例 | 打进壳，已播种 | 永为普通包（绝对基座） |
| vendored `@cordisjs/plugin-loader` | entry 治理（两侧同一份代码） | 编译期浏览器化，内核挂载 | 不动（vendor 政策） |
| `dsh-client-modules` | client 模块系统 | lazy CJS 模块表；双阶段 boot | 永为普通包（模块先于模块） |
| `dsh-client-web` | 壳内核 + AppRoot + app-shell 装配 | 自足（手写状态 store，零插件值 import） | 持续缩小 |
| `dsh-client-ui-slots` | slot 注册表核心 | 普通包，已播种 | 升格为插件；接收 runtime 的 slots 机件 |
| `dsh-client-web-react` | ctx↔React 胶水 | 普通包，已播种 | 升格为插件；渲染器安装移入其 apply |
| `dsh-client-ui-primitives` | 基础组件 | 普通包，已播种 | 升格为插件（组件经 slot/服务供给） |
| `dsh-client-connection` | wire 层 | 插件（dsh.client + bundle），声明 `immediately` | 传输替换（Electron IPC 载体） |
| `dsh-client-runtime` | 会话对象层 + slots 服务 + store 引擎 | 插件，声明 `immediately` | 持续缩向纯会话对象层 |
| `dsh-client-ui-theme` | 主题 token/服务 | 插件，声明 `immediately`，外加 `./styles/*` 源码通道 | Theme Registry（另行裁定） |
| `dsh-client-i18n` | I18nService | 插件，声明 `immediately` | 按部署组合语言包 |
| `dsh-client-hmr` | 热重载驱动 | 插件，声明 `immediately` | 回滚；重连握手 |
| ui-layout / ui-sidebar / ui-conversation / ui-trajectory | UI 功能 | 插件，按需到达 | conversation 域拆分；trajectory 真实现 |

## Consequences

wire 两侧跑着同一份治理实现；浏览器特有层只包含一套模块系统和一个重载插件。插件包只有一种形态，纯度门禁因此覆盖全部插件。依赖边与启动档位都与其所有者——manifest——同住，负责组合的 app 只握名册。各漂移缺陷类被结构性关死：共享清单人肉同步、装载顺序耦合、跨插件 import、名册/档位双重记账。浏览器原生脚本装载使插件网络资源、生成 bundle 与 TypeScript/TSX 源码保持标准映射，模块系统也只保留一个可替换的 `loadBundle` 钩子。

接受的代价：vendored Loader 在浏览器里背着闲置机件（EntryTree 持久化是 no-op，分组/隔离未用）；开发期每次修改插件都要付一次 bundle 重建加 fiber 重挂；图中 `inject` 行仅是信息性说明——激活的真相在服务层——因此不匹配会在 settled 扫描时浮出，而不是在图校验时被拦下；三个尚未升格的库在各自的 DI 转换落地之前保持静态 import 导出；每个 bundle 多出一份 sourcemap 产物，外部脚本失败也只能给出粗粒度的 URL 诊断，不能像显式 fetch 那样报告 HTTP 状态。

名册：住在 web 组合包的配置树里（`packages/bundle/web-app/cordis.patch.yml`）；`mountWebPlugins` 与 `CLIENT_PACKAGES` 常量已消失，重组一次部署等于换 yml/overlay。图的组合器从 webserver 侧的注册表迁进 `dsh-client-modules` 的 node 半（该包按本 note 的升级法则升格为双面——其消费方现经 cordis DI 到达），传输拆分同轮落地：webserver 变为朴素路由注册插件，`/api/*` 绑定迁到 connection 的 node 半、走升格后的 `api-gateway` 插件（`dsh-host-apiproxy` 提供 `ctx.apiProxy`），dev 的 bundle 监视与 SSE（Server-Sent Events）通道迁到 hmr 的 node 半。

## Alternatives considered

| Rejected | One-line reason |
|---|---|
| 两轴分类体系（entry × 到达），基础设施包不带 dsh.client | 抹掉了 manifest 依赖边（inject 泄漏给组合方）、把插件形态拆成两种、让纯度门禁对一半插件失明 |
| 继续把手写 loader 演化成治理器 | 重新实现 vendored Loader 已拥有的 entry/fiber 生命周期；HMR 将与 host 侧毫无共享骨架 |
| 在浏览器复用 `@cordisjs/plugin-hmr` | 约 80% 在解决浏览器没有的问题（fs 监听、深度图着色、Node 的双缓存）；只按形状抄用其重载骨架 |
| 模块联邦（module federation） | 独立构建的远端 bundle 恰是 vite 联邦不支持的形态 |
| import map | 早已排除；DI require 表是终局机制 |
| 现在就彻底 ctx 化（react 与库全走服务，不设模块表） | 模块轴上的极端形态；搁置——升级法则让包一次一个地走向它 |
| 冻结表 + 到达即实例化 | 要求按到达时刻排序；lazy CJS 登记让递归 `require` 自行定序，且与朴素拉取器的阶段拆分相合 |
| fetch 响应文本后注入内联 `<script>` | 模块系统必须缓冲整份源码并维护 fetch/execute 两条路径；动态源码执行也切断浏览器网络资源、sourcemap 与 profile 的原生关联 |
| 构建器推送重建通道（编排器在 `onSuccess` 里 POST `/plugins/rebuilt`） | 把重载耦合到一个钦定的构建器进程和第二套 wire 协议；webserver 本就握有每个 bundle 路径，stat 轮询（每次 stat 变化即重哈希）已兜住当年为推送辩护的撕裂写竞态 |
