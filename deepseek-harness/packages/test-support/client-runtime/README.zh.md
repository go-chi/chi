# @deepseek-ai/dsh-client-test-runtime

[English](README.md) | 中文

面向客户端功能测试的 jsdom slot 测试运行时：真实 Cordis `Context`、生产 `SlotRegistry` 与 web-react 渲染器，围绕带类型的 session/workspace 测试替身组装。功能套件无需逐套件手搭机器即可测遍声明、注册、scope、store、inject、渲染、更新与销毁——且不存在任何生产逻辑的第二份实现。

替身实现的正是功能通过 ctx 获得的对外接口（`TestSessions implements ISessions`、`TestWorkspaces implements IWorkspaces`；每个 fixture session 是 `FixtureSession implements SessionFace`；`stubSettingsScope` 是发布由测试驱动、带写入 spy 的 `SettingsScope`），生产面一旦改形，测试台在编译期即断，而非静默漂移。provide bundle 材料化直接运行生产 `SessionProvideChannel`——与 `SessionRuntime` 共用同一份实现。fixture 灌入的是普通数据：列表行、会话快照（经 `updateSnapshot` 以 immer 补丁改写）、projection 值，以及按 `ISession` 取型的行为桩——spec 调用未打桩的动词时报错自明。带类型的 `provide()` 将已声明服务名的 fake 约束为该服务对外面的 `Partial` 子集。

局部 DOM 快照：`declare(children)` 注册自动 frame，逐 key 的 `<div data-slot>` 包裹层即快照根；`renderSlot(key, owner)` 返回该 slot 的局部视图（container、限定范围的 Testing Library 查询、原位 `update(owner)`）；注册的快照序列化器把 CSS-module 哈希类名折回语义名（`_frame_a1b2c3` → `frame`）保持 `.snap` 只含结构，并把 `<svg>` 内部折叠为 `data-content` 指纹。需要自定义页面 frame 的套件改用 `root.declare(children, Frame)`；`mount(plugin)` 在真实 fiber 上运行并对缺失服务先行报错；`dispose()` 沿单一轴拆除视图、feature fiber、已铸 scope 与持久化 store 状态。

不属于产品插件图（无 `dsh.client`）；feature 包仅以 `devDependencies` 依赖之。

## 模型体验

无；本包是浏览器侧测试基础设施，无一物到达模型请求。

#### KV Cache effect

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

- **仅可经仓内源码别名消费。** spec 通过 tsconfig `paths` 解析到 `src`；构建产物 `lib/` 再导出 `@deepseek-ai/dsh-client-runtime/client`，而该 bundle 是无 Node ESM 导出的浏览器 loader 脚本，故 `lib/index.js` 在纯 Node 下不可导入。所有消费方都是仓内 Vitest 套件；不存在 Node 兼容的运行时入口。
- **会话快照是 fixture 数据，不是重放历史。** `updateSnapshot` 直写快照 store；wire 到快照的运算仍由 runtime 包自身测试与 replay e2e 把守。因此 fixture 可以表达生产投影永不产出的状态。
