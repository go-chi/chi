# Agent Note: 自引用 cordis 工具集

Status: implemented

[English](2026-07-08-self-referential-cordis-toolset.md) | 中文

## 问题

本 harness 中的一切都是 cordis 插件，但运行在该插件运行时内部的 agent（智能体）既看不到也碰不到它：它无法枚举周围的服务和事件，无法在会话中途为自己添加新工具，也无法组合自己发明的能力。赋予模型这种能力值得探索——一个能审视并修改自身运行时的自引用 agent——但这同时引发三个正确性问题，本设计的核心正是回答这些问题，而非单纯的「让模型执行代码」机制。

第一，模型编写的注册必须在注册发生时就完成校验：格式错误的工具 schema 必须在注册时失败，而不是等到后续请求尝试将其组装进提示词时才报错。第二，模型编写的代码需要调用它从未见过源码的服务 API——靠猜测方法签名、更糟糕的是猜测返回值结构，会消耗大量盲目试探的步骤。第三，模型挂载的一切都必须完全可释放：模型可以按需释放，普通的插件生命周期在宿主插件重载时也会释放，否则长会话会积累遗留的监听器和工具。

## 决策

该工具集以 [`@deepseek-ai/dsh-tool-cordis`](../../../../packages/extensions/tool-cordis/README.md) 发布，并由 `examples/web-cordis` 演示。它为模型提供三个工具，用于操作当前 DSH 进程中的活跃 Cordis 运行时：检查该运行时、挂载一个仅存于内存的临时插件，再将该插件卸载至完全停稳。

vm 隔离了意外的全局污染，上下文门面隐藏了框架内部细节。但二者都不限制已暴露服务的权限：临时插件可以调用 `ctx.shell` 以宿主执行器的权限运行命令，也能访问真实的文件系统和网络服务。它运行在共享 DSH 运行时中，可能影响同一进程的其他会话。这是一个需要显式启用的开发工具，信任等级与 bash 相当，不是安全边界，也不是产品默认配置。

### 三个工具

| 工具 | 约定 |
|---|---|
| `cordis_inspect` | 当前进程活跃运行时的只读报告，每个 `what` 值对应一个 Markdown 小节（省略 `what` 则输出全部小节）。`plugins` 列出全部存活 fiber，`temporary` 只列 `cordis_mount` 创建的临时插件。精确 `name` 搭配 `what: "api"` 或 `what: "events"` 可收窄到一个带源码文档的目标。 |
| `cordis_mount` | 立即在 `node:vm` 沙箱中把 `code` 作为异步 JavaScript 函数体求值，且不保存到任何位置。返回的插件挂在内部 `cordis-dynamic` 分组下，并用新的进程内 id（`dyn-1`、`dyn-2`……）跟踪。 |
| `cordis_unmount` | 按 id 卸载一个 `cordis_mount` 临时插件，并只在其自有工具、监听器、服务、定时器和其他 effect 完全停稳后返回。它不能删除 Loader、已配置或已安装的插件。 |

`cordis_inspect` 的小节是 `services`（每个已提供的 ctx 服务及所属 fiber）、`plugins`（全部存活插件 fiber）、`tools`（模型可调用的工具）、`temporary`（`cordis_mount` 子集，包含 id、running／pending 状态、提供与等待的服务和生命周期）、`api`（活跃服务签名及其引用类型）和 `events`（harness 事件及分发模式和签名）。临时插件可跨后续轮次保持活跃，并在 `cordis_unmount`、工具集卸载或 DSH 重启后消失；系统绝不会自动恢复它们。宽泛的 `api` 和 `events` 报告省略完整 JSDoc；精确 `name` 返回一个服务或事件及其原始 JSDoc。其他小节不能搭配 name，未知目标会失败，而 API 目标必须处于活跃状态。面向模型的工具描述包含调用时所需的操作规则；[生成的工具目录](../../../../docs/tool-catalog.md)是这些规则的完整呈现。

### 沙箱语义

挂载代码以异步函数体的形式在一个新的 vm realm 中运行。其文档化的 API 将文件、网络、进程和定时器访问引导至 Cordis 服务，使挂载保持可审视和可释放。宿主 realm 的辅助手段仍然使 Node 逃逸成为可能，这与信任姿态一致。`vmTimeoutMs` 仅约束同步执行部分。

沙箱全局变量刻意精简：一个带标签的直写 `console`（在宿主 stdout/stderr 上输出 `[cordis:<id>] …`，这样在挂载调用之后很久才触发的监听器输出仍能落到用户可见的地方）、`harness.defineTool`／`harness.registerTool` 注册对、新 vm 上下文缺少的编码原语（`btoa`／`atob` 作为基于 `Buffer` 的宿主闭包——这是一个明确允许的例外，`Buffer` 本身从不暴露——加上 `TextEncoder`／`TextDecoder`），以及对未暴露的 Node API 设置的可调用陷阱（`require`、`setTimeout`／`setInterval`／`setImmediate`／`clearTimeout`／`clearInterval`、`fetch`），这些陷阱会抛出一条重定向消息指明 cordis 替代方案。只有函数形态的全局变量才设陷阱；`process` 和 `Buffer` 保持 `undefined`，这样 `typeof` 特性探测仍然无害，而不会触发会抛出异常的访问器。

挂载代码通过三道控制跨越 vm 边界。双 realm `instanceof` 同时识别宿主和 vm 对象。`harness.defineTool` 在宿主 realm 中重建输出 schema／投影器，将工具体返回值快照为宿主自有的 JSON，并让注册表在观测前强制执行[规范工具输出约定](../architecture/2026-07-20-canonical-tool-output-contract.md)。挂载的插件接收的是一个白名单上下文门面，而非原始或透传的 `Context`；框架内部机制和以上下文为值的返回会被拒绝。服务读取需要声明 `inject`，保留 Cordis 的激活与卸载语义。`ctx.tools.get` 仅暴露 schema 视图，因此挂载代码无法绕过 `ToolRuntime.execute` 直接调用定义。

边界将无歧义的 JSON Schema 形式规范化为 `ParameterSchemaSpec`，同时保留 `integer`、原始对象开放性和 required 数组。直接使用 DSL 的对象节点必须声明 `additionalProperties`；无效词汇会报错并给出可接受的替代方案。解析错误、TypeScript 错误、缺少 return、Node API 误用和重复工具名等错误信息包含相关源码行或纠正性约定，不叙述实现内部细节。

### 内部分组与临时插件生命周期

每个临时插件都是工具插件下方内部 `cordis-dynamic` 分组的子节点，因此普通的 fiber 释放即可处理工具集重载和卸载。`cordis_mount` 会等待 settlement；启动失败时在返回错误前释放 fiber。已 settle 但处于 pending 状态的插件仍然可见，并列出其缺失的注入。`cordis_unmount` 等待插件 fiber 的释放完成。

临时 Plugin 只存在于进程内存中。它不会创建 Plugin 文件、安装 package、修改 `cordis.yml` 或个人／项目配置、跨重启存续，也不存在自动保存、转正式或安装路径。若要保留实验结果，应让 Agent 通过常规开发流程实现普通的项目 Plugin 或可安装的 profile 组合包。

### 通过 provide／inject 实现跨挂载组合

挂载之间通过普通的 cordis 服务语义相互关联，以各自的 id 作为生命周期句柄：挂载 A 调用 `ctx.provide('foo', value)`，挂载 B 声明 `inject: ['foo']` 并在 `foo` 存在的瞬间激活；如果 B 先挂载，它保持 pending 状态并列出缺失的服务；卸载 A 使 B 回到 pending（其注册被撤销），之后重新 provide 会通过一个新的沙箱门面重新运行 B 的 `apply`；重复 provide 会明确报错并指出拥有该服务的 fiber。一个 realm 注意事项：由挂载 provide 的服务值是 vm realm 对象——从任何地方调用其方法都能工作，但消费方不得假设它具有宿主原型。

### 生成的 API 目录

`cordis_inspect` 从生成的目录提供 API 和事件数据，而非维护一份重复的表格。生成器复用 Cordis 目录的 AST 扫描，输出服务摘要、签名、原始服务方法与事件 JSDoc、事件模式、引用的类型声明以及继承的上下文 API。有歧义的类型名被省略，过大的声明被标记为截断。

新鲜度像所有生成产物一样受门禁约束：`pnpm run verify-cordis-api`（在 `doc-sync` 中）在内存中重新生成并在有任何 diff 时失败，因此 JSDoc 或公开签名变更如果不重新生成模型读取的目录就无法合入。运行时 inspect 工具将目录与活跃运行时取交集而非直接转储：宽泛报告把有目录条目的活跃服务渲染为摘要 + 签名，把没有目录条目的活跃服务（挂载提供的）渲染为名称 + 所属 fiber，简要列出有目录条目但无活跃提供方的服务，再附上引用的类型结构。精确名称报告渲染一个活跃服务或事件，并把原始 JSDoc 紧靠在每个签名之前；让该细节按需出现，避免探索性列表承担其 token 成本。

### 配置、渲染与可观测性

该插件暴露一个配置字段，由 schemastery 校验并记录在[配置目录](../../../../docs/config-catalog.md)中：`vmTimeoutMs`（默认 5000），代码同步求值部分的毫秒上限。当前面向模型的名称是 `cordis_inspect`、`cordis_mount` 和 `cordis_unmount`；内部 `cordis-dynamic` 分组名和 `dyn-` id 前缀仍是结构性词汇。三个工具均按[工具实操手册](../../../../docs/cookbook/adding-a-tool.md)渲染为 `generic` 卡片：inspect 为 `read`，mount 为携带代码 `rawInput` 的 `execute`，unmount 为 `delete`。Web 对话行保留这些通用机制，同时为各工具设置操作标题 `Inspect`、`Mount temporary Plugin` 和 `Unmount temporary Plugin` 以及统一的 Cordis 强调色；mount 行仍使用共用的 JavaScript 展开视图和语法高亮。

「模型可见 ⟺ 已记录」成立，且无需新的会话事件类型：mount 与 unmount 通过已记录的 `tool/call`／`tool/result` 对可见，当步骤之间的 schema 发生变化时，系统发出的完整 request header 会记录工具集的任何变化。临时插件属于进程内存，而非会话状态：恢复持久化会话只会重建对话历史，绝不会重新创建它们。

## 曾考虑的替代方案

**用结构化的逐能力注册工具替代 `cordis_mount`。** 最具吸引力的替代方案是一个带有显式 `name`／`description`／`parameters`／`code` 字段的 `cordis_register_tool`（以及配套工具 `cordis_register_listener`、`cordis_register_service`……），而非单一的「挂载一个插件」原语。否决原因：它唯一的真正优势——对最常见的单一场景免去插件样板代码——不足以抵偿其代价，而单一的 mount 原语能一次性覆盖所有能力。

| 维度 | 结构化逐能力工具 | 单一 `cordis_mount` |
|---|---|---|
| schema 正确性 | `parameters` 仍然是模型编写的 JSON，需要统一 schema 校验，只是提前了一步 | 同样的校验在沙箱边界运行，同样的指导性错误信息 |
| 代码字段 | `execute` 函数体仍然是 vm 中模型编写的 JS；realm 和服务调用的正确性问题不变 | 一个沙箱、一条规范化路径、一处受保护的注册 |
| 能力覆盖面 | 仅限工具；监听器、服务、`inject` 关系各需另一个结构化工具——API 无限增长 | 一套词汇（cordis 插件）覆盖当前和未来的所有效果 |
| 跨挂载组合 | 在工具注册载荷中无法表达 | 原生 `provide`／`inject`，普通的 cordis 语义 |
| 可审视性 | 注册的东西无法在插件列表中显示为插件 | 模型挂载的正是 `cordis_inspect` 渲染的 |
| 模型易用性 | 对最常见的单一场景有优势（无插件样板） | 通过 mount 描述中的规范示例加边界错误信息教会正确调用来缓解 |

因此正确性投入放在能一次性为所有能力带来回报的地方：通过 `cordis_inspect` 呈现的生成 API 目录，以及沙箱边界校验（其错误信息教会正确的调用方式）。结构化注册工具日后仍可作为语法糖添加，由它合成 mount 代码；本设计不排斥这一可能。

**在工具中手工维护服务／事件参考。** inspect 工具的第一版携带了一份手写的服务方法签名表。它被生成的 `api-catalog.ts` 取代，因为手写表在签名变化的瞬间就会与 JSDoc 脱节且没有门禁约束这种漂移，而生成产物的新鲜度由文档使用的同一套 AST 检查。

**新增 `cordis/mount` 会话事件。** 一个持久事件记录每次挂载的源码和名称，有明确先例（`hook/invoked`、`compaction/start`）。v1 中予以否决：挂载和卸载已经作为 `tool/call`／`tool/result` 对可见，工具集变化已经作为完整的变更 request header 被记录，因此专用事件只会重复记录。如果审计用例需要在工具调用之外取得挂载的源码和名称，日后仍可添加。

**加固的／能力受限的沙箱。** 对 Node 内置模块设陷阱并向挂载代码提供白名单门面而非原始上下文，可能暗示意图是为安全而沙箱化。这里明确不是：陷阱和门面收窄的是挂载代码所见的 *API*——将其引导至 cordis 服务、远离易泄漏的 Node 内置模块和框架内部——目的是正确性和封堵未受保护的上下文逃逸，但门面暴露的能力（`ctx.shell`、`ctx.fs`、`ctx.web`）触及真实运行时，因此它不是安全边界。真正的安全边界（独立进程、权限提示）超出了一个开发／显式启用工具集的范围，且会与其核心目的——将活跃运行时交给模型——相冲突。

## 后果

该工具集是刻意的显式启用设计，具有完整权限的 `ctx`，因此部署方采用它的意识程度应与 bash 工具相当。以下几个事实由工具描述直接告知模型：一个 waterfall（瀑布式事件）监听器（如 `tools/pre-execute`）如果不调用 `next()` 就返回，会短路整条链，因此一个挂载的监听器可以阻止 agent 自身的工具分发（[waterfall 语义](../../../../docs/cordis-primer.md#cordis-waterfall-semantics)）；挂载代码在当前轮次的工具调用内运行，因此 await 任何只在该轮次结束后才 resolve 的东西会导致死锁；`vmTimeoutMs` 仅约束同步执行；挂载不会在会话恢复后存活。
