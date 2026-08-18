# @deepseek-ai/dsh-client-ui-slots

[English](README.md) | 中文

Slot 注册表纯核心、slot 终端设计：SlotMap 声明合并、SlotCore 上唯一的 `register` 组合 API、四 share 组件 props 类型家族、store seat 类型家族，以及 renderer 安装约定。只使用 React 类型；该包不依赖 React，也不依赖 Cordis。

一次 `register({ name, children?, store?, inject?, ...kind }, Component)` 调用会向已声明 slot 贡献一个组件，同时声明子 slot（声明 = 渲染授权 = 运行时规范，三者共用一张表）、store seat 以及注册方的业务表层。组件会在调用点依据 `ComposedProps` 接受类型检查；该类型是四个 share 的交集，每个 share 都从各自的唯一真源派生：

| share | 类型 | 来源 |
|---|---|---|
| 运行时 | `PropsRuntime<K>` | SlotMap 条目：`owner`（父级 renderSlot 调用点）+ 会话标准工具包 + 全局 seat |
| child render | `PropsRenderSlots<S>` | register 调用的 `children` key 集合（静态缩窄的 `renderSlot`） |
| store | `PropsStore<H>` | 已声明 handle：`useStore` selector 钩子 + 移除 draft 的 `actions` |
| business | `I` | 从 `inject` factory 返回值推断 |

chain-kind slot 会反转键控路由：条目自行提名，而不是由分发点选择 `entryKey`。每次注册都携带一个纯 `ChainSelect` selector（另有可选的升序 `priority`，相同值按注册顺序处理）；第一个非 null 返回值选中其条目，并成为组件的 `matched` prop；全部返回 null 时则使用 owner 的 `renderSlotChain` fallback（`ChainRenderOpts`）。

标准工具包接口（`SessionStandardProps`、`GlobalStandardProps`）在这里声明为空，由运行时包合并（与 SlotMap key 相同的 declare-merge 模式）。renderer 会把运行时会话和 Workspace observable source 绑定为 selector 钩子。Inject factory 参数从声明派生（`InjectParams`）：会话 slot 获得 `sessionId`；声明 store 时追加 baked `actions`；没有其他参数，数据访问位于 apply 闭包的 ctx 中。

store 家族（输入 `defineStore` 规范／输出 `StoreHandle<T, A>`）为 store seat 建模：`init` 推断状态 schema；`actions` 是完整的 draft-transform 写入集合；`BakedActions` 移除 draft 参数，成为组件和 inject factory 收到的回调。`defineStore` 值实现位于运行时包（引擎所属位置），并满足这里导出的 `DefineStore` 约定。引擎产物与 renderer host 约定携带裸快照 source（`getSnapshot`／`subscribe`），绝不携带 React 钩子；钩子绑定属于渲染机制，只有 props 约定钩子类型（`SnapshotSelectorHook`）位于这里。

`SlotCore` 在构造时预置 `'root'` slot，并强制执行加载时验证（注册未声明 slot、重复声明子项、在两个 scope 下使用同一个共享 handle、chain 注册缺少 `select`，这些情况都在 register 时抛出）。条目的 disposer 会递归移除其声明的子 slot：账本行、贡献和 store 挂载都会随同一生命周期结束而移除。每个 key 还携带一个 declaration epoch（声明代次），它只在声明与移除时递增；运行时将其用于 [`ctx.slots.inject`](../runtime/README.md#slot-declaration-injection)，且与普通条目版本相互独立。`renderer.ts` 携带安装约定（`SlotRenderer`、`SlotRendererHost`）以及 `StaleAuthorizationError`／`SlotOwnershipError`；实现在 web-react 中，安装则在外壳启动中完成。

## 模型体验

无。slot 注册表属于浏览器侧 UI 接线；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **`isLive` 会线性扫描所有记录**：在 UI 插件的注册规模（数十项）下没有问题；如果账本变得频繁访问，再使用条目→记录反向引用改进。
- **`__renders` 幻象锚点在 `PropsRenderSlots` 上可见**：这是与类型链设计的 `__accepts` 相同且已接受的噪声；泛型方法签名在 key 联合之间比较宽松，因此必须依靠逆变标记强制执行「组件 key 集合 ⊆ children 声明」。
