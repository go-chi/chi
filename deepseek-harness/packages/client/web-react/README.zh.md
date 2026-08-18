# @deepseek-ai/dsh-client-web-react

[English](README.md) | 中文

slot 终端设计的外壳侧 React 胶水：createSlotRenderer（外壳安装到运行时 SlotRegistry 的 SlotRenderer 实现）、SessionProvider（由框架接入的 render prop，也作为标准 seat 注入到声明会话 scope 子 slot 的配置项）、bindSnapshotSelector（唯一的钩子构造器：主机与引擎只传递裸 observable source；每个钩子在此绑定，并按 source 缓存）、useInvoke。链式 slot outlet 在渲染时按链顺序运行已注册 selector，只挂载被选中的配置项，其 select 返回值以 `matched` 加入 props；`renderSlotChain` 绑定与 `renderSlot` 一样按配置项缓存。快照 store 引擎与 defineStore 位于运行时；业务插件只依赖 ui-slots 类型，绝不依赖该包。

## 模型体验

无。ctx↔React 机制完全在浏览器中运行；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **persist 中间件会损坏原始值状态 store**：保存时它会对状态执行对象展开，因此 `SnapshotStore<string>` 往返后会变成字符映射；引擎改为自行实现持久化（见 `attachPersistence`）。
- **`UseSession` 有意保持宽泛（`object` 快照）**：依赖方向（runtime → web-react，绝不反向）使真实 `ConversationSnapshot` 类型不可访问；会话 slot 消费方在其边界处缩窄一次。
- **`renderSlot` 是唯一的渲染形式**：没有 Suspense 集成或逐配置项惰性加载。
