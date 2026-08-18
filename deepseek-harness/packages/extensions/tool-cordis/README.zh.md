# @deepseek-ai/dsh-tool-cordis

[English](README.md) | 中文

自引用 Cordis 工具集：五个面向模型的工具，操作当前 DSH 进程中的实时运行时。注册表、vm 沙箱与浏览器广播属于 [`@deepseek-ai/dsh-cordis-host-runner`](../cordis-host-runner/README.md)（`ctx.dynamic`），本工具集注入它——只装这些工具而不装 runner 的组合永远不会激活它们。沙箱语义、动态包生命周期与组合及既定决策详见[工具集 Agent Note](../../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md)。

## 功能

两组配对动词，外加只读报告。

- `cordis_inspect`：当前进程运行时的只读报告，包括服务、全部存活插件 fiber、已注册工具、本会话的动态包、反射支持的 `api`／`events` 参考，以及浏览器半可以向其贡献 UI 的编译期 `client` 槽面。精确的 `name` 配合 `what: "api"`、`what: "events"` 或 `what: "client"` 可缩窄报告，并附上完整约定。
- `cordis_define`：在语法预检两个半之后登记一个包（`name`、`purpose`，以及 host 半 `code` 和／或浏览器半 `client`）。此时不运行任何东西；用户会在会话里看到它的卡片和一个启动控件。铸出的 `dyn-<n>` 标识同时进入结果 value **与**持久的呈现元数据，卡片正是靠后者在 replay 中寻址运行动词。
- `cordis_run`：在沙箱中求值 host 半，并把浏览器半投递给每个打开的网页。对已在运行的包再次运行不会失败，而是重新投递当前版本——这正是被刷新过的页面把包取回来的方式。
- `cordis_stop`：把 host 半 dispose 到完全停稳，并从各页面撤回浏览器半；定义存续，可以再次运行。
- `cordis_undefine`：必要时先停止该包，再忘掉定义；它的卡片作为一条已卸载记录留在会话里。

面向模型的确切 schema 见[生成的工具目录](../../../docs/tool-catalog.md)。

动态包只存在于共享 DSH 进程内存中。它可跨后续轮次保持活跃，也可能影响同一进程中的其他会话，但会在 `cordis_stop`／`cordis_undefine`、工具集卸载或 DSH 重启后消失。它不会创建插件文件、安装任何包、修改 `cordis.yml` 或个人／项目配置、跨重启存续，也不能自动转为正式插件。若要保留实验结果，应让 agent（智能体）通过常规开发流程实现普通的本地、项目或仓库插件。每个动词都以会话为界：一个包只在定义它的那个会话里可见、可控。

## 信任立场

该沙箱隔离全局变量，但不是安全边界。Node 全局变量不存在，或会重定向到 `ctx.fs`、`ctx.web`、`ctx.bash` 等 Cordis 服务；写入 `globalThis` 的内容保持局部，但 host realm helper 使逃逸成为可能。运行中的 host 半收到不含框架内部机制的 façade，但获准服务仍会影响存活运行时。动态工具 schema 与 annotation 通过迭代式 JSON 克隆和 schema 规范化跨越 realm，因此有效的深层声明受内存而非调用栈限制；含 JSON 不可见 key 的 record，以及子类化或装饰过的 schema array，会在规范化前被拒绝。应当像对待 bash 访问一样对待该工具集；参见[设计与信任立场](../../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md)。

## 配置

无。vm 求值边界（`vmTimeoutMs`）与浏览器确认窗口（`ackTimeoutMs`）属于拥有沙箱与广播的 runner 服务——见 [`@deepseek-ai/dsh-cordis-host-runner`](../cordis-host-runner/README.md#config)。

## 生成的 client 槽目录

`src/client-catalog.ts` 描述浏览器半的座位，由 `scripts/gen-client-catalog.ts` 生成（新鲜度门禁为 `doc-sync` 中的 `pnpm run verify-client-catalog`），数据来自对每一处 `SlotMap` 声明合并与每一个 `slots.register` 调用点的词法扫描。它承载浏览器半唯一能动的那个面——槽键、每个 register 调用的选项、组件会收到的 props、谁已经占着这个座位、以及哪个 owner 挂着这个座位才存在——并且只以纯数据承载：本包始终在 host 侧、不 import 任何 client 模块，跨越两平面的只有这些字符串。生成器宁可高声失败也不吐出一条模型无法照做的条目：槽缺少面向 registrant 的 JSDoc 正文、`kind`／`scope` 不是字面量、owner props 没有任何导出声明、键重复、或注册进了没人声明的槽，都会让门禁变红。owner props 只展开一层——owner 声明本身连它的成员文档,加上其字段所引用的那些形状的名字——而单个槽的整份报告有行数上限:收窄到一个槽的意义是少花上下文,不是多花。

一个槽的教学文案就是它声明处的 JSDoc，所以要改模型读到的内容，改的是声明它的那个包里的约定，而不是这份目录。

## API 报告从哪里来

`cordis_inspect what:"api"`／`what:"events"` 渲染的是 `src/api-catalog.ts`，即工作区 Cordis 声明的生成投影：渲染好的方法签名、源码 JSDoc、带分发模式的 harness 事件，以及这些签名引用到的类型形状——全部由与 `docs/subsystems` 同一次 AST 遍历产出，因此模型读到的数据与渲染出的文档不可能彼此偏离。它是关于**仓库**的编译期事实，所以用 `pnpm run gen-cordis-api` 重新生成、用 `pnpm run verify-cordis-api` 守它的新鲜度。

`src/inspect.ts` 把这份目录与**活的**服务存储取交集：**谁在跑**由存储回答，**每个服务能做什么**由目录回答；目录没覆盖到的活服务会被报成可达但没有签名，而不是被省略。包代码若要在自己源码里用这份清单，就从报告里抄出来——目录是关于仓库的编译期事实，所以对任一个部署而言，抄出来的清单与现读的清单说的是同一件事。

有两项面向模型的判断住在本包里，而不住在产物里，因为反射数据忠于代码，而报告必须有用：

- **只展示可调用的方法。** 非方法成员是状态而不是动词，而它们渲染出来的形式会带上实现体里的初始值；以 symbol 为键的成员是插件之间的内部 seam，包的 façade 刻意无法触达，所以点出其中任何一个，都等于宣传一次根本发不出的调用。
- **只有 host 半够得到的键，才会被点名给模型。** 反射模型覆盖包声明的每一个 `ctx.<key>`，其中包括 launcher 提供的 boot 值（`agent`、`headlessIo` 等）与浏览器半的服务（`connection`）。`src/curation.ts` 会为每一个这样的键归类它的 `reach`——`injectable`、`not-a-service` 或 `other-face`——而只有 `injectable` 的键能进报告：点名一个包够不到的键，就等于宣传一次根本发不出的调用。这份归类是作为每条目录条目上的数据携带的，而不是在渲染时才施加，因此这项排除可以单独测试；同时 `verify-cordis-catalog` 把被归类的集合钉成「文档投影不渲染的键」这个集合本身——新声明一个键会把门禁拦下来，而不是悄悄引诱模型去 `inject` 一个永远不会到来的东西。一个被归类、但确实有存活提供方的键，仍然会被报成在跑且可 inject：服务 store 才是「什么存在」的权威。

生成常量 `INHERITED_CTX_API` 为 `api` 报告收尾，列出框架继承来的 `ctx` 面（`ctx.on`、`ctx.effect`、`ctx.loader`、各 timer 辅助方法）：这些成员本身就是 Context，不是某个服务键；而框架层住在 pinned vendor 包里，位于每一个被分析的契约面之外——所以生成器策展这**一层**，并把它同时渲染进本目录与 `docs/cordis-api/inherited.md`。一个活着、但目录并不描述的服务，会被报成“在跑、且仍可 inject”，而不是报成不存在。宽泛的 `api`／`events` 报告只渲染摘要与签名；精确 `name` 会选择保留的方法／事件 JSDoc，未知或未运行的服务目标会高声失败。

## 渲染

每个工具都渲染 `generic` 卡片（`read`／`execute`／`delete`）；`cordis_define` 以 `rawInput` 携带提交的两个半，并用标签与用途作为卡片标题。presenter 是 args 的纯函数，结果保留默认文本渲染。Web 客户端注册自己的 keyed `cordis_define` 行（`@deepseek-ai/dsh-client-ui-cordis`），从调用参数与结果元数据里取标签、用途和铸出的标识；没有该注册的界面则退回到这张 generic 卡片。

## 导出形式

Namespace 插件：命名导出 `name`／`inject`／`apply`，无默认导出（[docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)）。它注入 `tools` 与 `dynamicCordisRunner`。

## 模型体验

### 工具 schema

#### 模型看到的内容

该插件可见时，会话模型会看到生成的 [`cordis_inspect`、`cordis_define`、`cordis_run`、`cordis_stop` 和 `cordis_undefine` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-cordis)。

#### Token 影响

该工具视图中的每次请求承担固定 schema 成本。

#### KV Cache 影响

只要该工具视图不变，前缀就保持稳定。隐藏这些定义的 scope 或插件生命周期变更，可能使从第一个变化的 schema token 起的复用失效。

### 工具调用历史与结果

#### 模型看到的内容

检查会精确地用 `## <section>` 加换行及取决于数据的正文来拼接选中区段，各区段之间留一个空行；`what: "temporary"` 使用 `## Dynamic Packages` 标题。每一行都会报告标识、标签、用途、存在哪些半、运行状态与版本号、提供和等待的服务、已注册的 host 方法，以及最后一次浏览器半装载上报；空状态说明定义只存在于本进程内存中。宽泛的 API／事件报告省略 JSDoc；`name` 配合 `what: "api"`、`what: "events"` 或 `what: "client"` 返回一个精确目标及其完整约定。`client` 区段每个座位一行，给出其基数、作用域、摘要，以及注册进去是否会替换出厂 UI，随后是跨座位通用的 registrant 纪律；每个座位的 register 选项、owner 与框架 props、可直接运行的示例，只在精确 `name` 时才吐出。define 回答该包已定义、尚未运行，并给出用于运行的标识；run 报告版本号、host 半提供或等待什么，以及是否有页面确认了浏览器半；stop 与 undefine 各以一行确认。每一次拒绝都是携带 runner 教学文案的工具错误。提交的程序保留在 assistant 工具调用历史中。

#### Token 影响

检查输出与提交的包代码取决于数据，并在压缩（compaction）前重复发送；生命周期确认文本很短。`client` 区段的体量由出厂槽数量决定（每座位两行），每座位细节按需索取，因此默认报告随槽面增长，而不是随其文档量增长。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### cordis_run 后的后续请求

#### 模型看到的内容

运行中的包可以注册工具、提示词贡献或监听器，改变其目标 scope 的后续请求；`cordis_stop` 与 `cordis_undefine` 会在完全停稳后移除这些贡献。

#### Token 影响

间接 token 影响等于运行中包的贡献，且只在其进程内生命周期内持续。

#### KV Cache 影响

运行或停止提示词／工具贡献会改变后续请求前缀，并可能使从第一个变化的贡献起的复用失效；运行集合不变时，前缀保持稳定。

## 已知限制与暂缓事项

- **沙箱只用于约束诚实代码，并非安全边界**：可以访问沙箱全局变量上的 host realm helper，因此包代码可以触达 Node；加载该插件时，应当像授予 bash 工具一样慎重（见 § 信任立场）。
- **`ctx` façade 不公开 `effect()`**：包代码无法注册定制 disposer；`on`／`provide`／`tools.register` 是受支持的清理路径。
- **vm 与确认窗口这两个边界属于 runner**：见它的[已知限制](../cordis-host-runner/README.md#known-limitations-and-deferred-work)；async 的 host 半主体可逃出 `vmTimeoutMs`。
