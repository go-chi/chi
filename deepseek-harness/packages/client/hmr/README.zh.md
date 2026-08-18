# @deepseek-ai/dsh-client-hmr

[English](README.md) | 中文

为通过脚本加载的客户端插件提供热重载。web 组合包无条件挂载该行；没有重建 watcher（`pnpm run dev:web`）改写客户端 bundle 时，轮询观察不到变化，链路保持空闲。

浏览器侧订阅系统 SSE（Server-Sent Events）通道（`GET /plugins/events`），每个 `rebuilt` 帧重载一个插件，并通过队列串行执行。每帧的顺序是：`invalidate`、`prefetch`（旧 fiber 仍在服务时加载并注册新组合包）、`registry.delete`（在 fiber dispose（资源释放）之前执行：仅 dispose fiber 会触发 vendored Loader 的 self-dispose 分支，把配置项标为禁用）、排空旧 fiber、删除 `entry.fiber`、移除自身拥有的 `<style data-plugin>` 标签、通过 `entry.refresh()` 重新导入并挂载、通过 `fiber.await()` 直接重新抛出启动失败。依赖方由 Cordis 自身重载：fiber 的激活 epoch 会串联其服务提供方的 uid，因此替换提供方 fiber 会级联所有依赖方，无需客户端图分析。node 侧使用一个 interval 检测重建：从同步基线开始 stat-poll 每个图组合包；新增一行后立即重新计算 hash；缺失行保持 dirty；只广播真实 rev 变更。因此，任何生成组合包的 tsdown watch 进程都能触发 HMR（热模块替换），无需 builder→host 通道。

## 模型体验

无。重载驱动器属于浏览器侧机制；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包（package）既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **重载有意保持粗粒度**：会创建全新的 fiber 和组件；重载插件中的 React 状态会丢失，数据层（连接 fiber、运行时 fiber 和 Session 对象）不受影响。react-refresh 级状态保留与「重新执行组合包会重新运行 factory」冲突，因此有意排除。
- **失败时不回滚**：失败的重载会使配置项处于 FAILED 状态，并在 loader 状态投影中显示；系统不会自动恢复先前组合包。
- **重建帧不会刷新图 rev**：陈旧 rev 无害，因为组合包端点以 no-cache 提供内容；只有重新连接时才会刷新。
