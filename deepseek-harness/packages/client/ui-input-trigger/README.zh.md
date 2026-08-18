# @deepseek-ai/dsh-client-ui-input-trigger

[English](README.md) | 中文

输入触发流水线插件：光标处的 `/` 与 `@` 检测（词边界 + guard tier 规则）、分组候选菜单，以及把 pick 路由到已注册 source。`ctx.inputTriggers` 拥有 source roster，并按会话 scope（`sessionOf`）各解析一个 `InputTriggerController`；对话接线层在 controller 上驱动 `track`／`arbitrate`／`onSpace`／`adjudicate`。同一个 controller 还暴露 `toggleSource`，供 chrome launcher 在一段合成 selection span 上只打开一个已注册 source；所得候选仍走通常的菜单、键盘仲裁、pick callback 与 scoped 输入改写。source 每次调用收到一个 `ClientSessionContext` 投影——会话始终由 agent（智能体）支撑，因此投影只含会话身份。source 在它能触达的每个会话 controller 中都会被预热：scope 创建时 roster 中已有的 source 会在 controller 构造期间预热，晚于此注册的 source 由注册动作本身预热进每个仍存续的 controller。`lexicon` 名录在预热后仍会变化的 source 实现 `subscribeLexicon(session, listener)`；controller 每收到通知就重拉，并把聚合结果经其 `lexicon` 快照 store 发布。流水线与命令无关：空格／回车裁决按注册序轮询可选的 `matchSpace`／`matchEnter` 钩子，第一个非 undefined 的应答胜出。

分层：`src/core/` 是纯内核——`detectTrigger`、`menuReduce`／`seedGroups`／`MENU_CLOSED`、`exactMatch`，零 React／DOM／cordis；`src/client/service.ts` 是壳层，把内核接到菜单快照 store、逐 hit 候选拉取（以 generation 把关、后继请求经 `AbortSignal` 取代旧请求、失败的 source 静默丢弃并留一条 console 记录）和三条 pick 路径上。`src/types.ts` 与两个 `contract.ts` 文件是冻结的跨包约定；变更需经主线程仲裁。

MenuView 把菜单 store 渲染进 `conversation.input.overlay` slot（列表类，会话 scope），菜单关闭期间渲染 null。键入式 trigger 会 seed 为该 trigger 注册的所有 source；程序化 launcher 只 seed 所请求的 source，并在菜单关闭或重新开始键入式 tracking 前，通过 controller 的 `launcher` 快照 store 发布该 source 名称。分组按可选的 `InputTriggerSource.order` 排序（越小越靠前，默认 0，同值保持注册序），组标题行经 `inputTriggers.menu` locale 命名空间本地化（未知 source 显示其原名）；列表高度受限于 composer 上方的可用空间，指针落在菜单与所在 composer 卡片之外即关闭菜单。该 slot 由 ui-conversation 的组合器条目拥有（锚点、children 声明、生命周期）；其 SlotMap 类型合并放在本包的 `src/client/slots.ts`，因为依赖方向（ui-conversation → ui-input-trigger）不允许反向的类型导入。combobox 模式：焦点始终留在 textarea，行在 mousedown 时完成 pick，高亮由 `aria-activedescendant` 承载。

`/client` 导出接口是插件主体（`apply`／`inject`）、`InputTriggerService`、`MenuViewInjected` 与约定类型。MenuView 本身是内部实现——slot 注册以闭包持有它。

## 模型体验

无。触发流水线只是浏览器呈现——pick 产出 `CommandClaim`／`ReferenceInsert` 数据，其模型可见后果（宿主命令执行；插入的引用文本随普通提示词发送）由负责消费这些数据的宿主包与输入状态机包负责。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **只有全局 source 层**：会话 scope 的 source 注册（逐会话遮蔽、类 ScopedLayers 机制）已有设计但未启用；台账记录着触发条件（出现真实的逐会话 source 需求）。
- **`InputTriggerCandidate.icon` 以文本渲染**：MenuView 把该字符串原样放进图标位；与设计系统图标枚举（iconFile 五变体家族）的接入将在该枚举交付后完成。
- **overlay 的 SlotMap 合并归属与 slot 所有权分离**：唯一的 `conversation.input.overlay` 合并放在本包，而 ui-conversation 负责其锚点、children 声明和生命周期，因为依赖方向是 ui-conversation → ui-input-trigger。
