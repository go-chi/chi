# @deepseek-ai/dsh-code-runtime-worker-thread

[English](README.md) | 中文

这是 [`@deepseek-ai/dsh-code-runtime`](../code-runtime/README.md) seam 的 worker 线程实现：`WorkerThreadCodeRuntime` 会在每次运行中使用一个全新的 Node `worker_threads.Worker`，输入 TypeScript，由宿主侧剥离类型，通过消息端口桥接绑定，输出 `{ value, logs, error? }`。**这是隔离措施，而非安全边界**：其信任立场有意与 bash 等价（参见 [Code Mode Agent Note](../../../.agents/notes/implemented/feature/2026-06-15-code-mode.md) 的 Trust posture 章节），但提供 bash 没有的隔离：独立 isolate、空环境、堆上限与强制终止。

## 配置

```yaml
- id: code-runtime
  name: '@deepseek-ai/dsh-code-runtime-worker-thread'
  config:
    computeMs: 60000              # busy-time budget (measured event-loop active time)
    maxWallMs: 600000             # wall-clock ceiling; never pauses for anything
    maxOutputBytes: 67108864      # combined serialized outer-output cap (64 MiB)
    maxOldGenerationSizeMb: 512   # worker heap cap (resourceLimits)
```

每个字段都会验证并提供默认值；`maxOutputBytes` 必须是至少 4 字节的安全整数，其余字段必须是有限正数，`maxWallMs` 还必须不超过 `2147483647`（Node 的 `setTimeout` 最大延迟），此外没有其他可调项。

## 设计

- **每次运行使用一个全新 worker，不设池化**：程序所在的世界会随 worker 一同终止，不会留下需要记录的跨运行状态，也无法发生状态泄漏；仅凭会话日志即可重建运行。
- **在执行上下文中，由宿主侧剥离类型**：程序会包裹在异步函数外壳中，通过 `node:module` 的 `stripTypeScriptTypes` 剥离类型（只支持可擦除语法；`enum`／namespace 会作为程序 `exception` 被拒绝，且不会启动 worker），再按字节位置切回原内容。之后程序作为 `AsyncFunction` 的函数体执行，因此顶层 `await`／`return` 可用。
- **端口把对端视为不可信**：模型代码能够访问 `parentPort` 并伪造通信，因此任何代码读取入站消息前，系统都会验证其形状并重新构建（`null`、原始值、无效类型和格式错误的载荷会被静默丢弃；伪造的额外字段绝不会被带入）；宿主对每个调用 id 最多响应一次，只将绑定名称解析为自有属性（伪造的 `constructor` 无法沿原型链访问），丢弃结算后的回复，并验证每个绑定 resolve 值与完成值是否为无损 JSON。伪造的 `log`／`done` 消息无法绕过外层上限：宿主会再次验证，并统计每条获准日志以及完成值或诊断。worker 侧命名空间使用 null-prototype 和 `defineProperty`，因此形似 `__proto__` 的绑定名称只是普通键。
- **绑定调用被拒绝时使用的异常类属于请求数据**：可选命名空间描述符会指定构造器全局变量，以及用于接收调用失败的成员名称的自有属性。worker 会创建并注入该真实类，使 `instanceof` 生效，同时无需硬编码 `tools` 或 `ToolCallError`；全局变量无效或冲突的声明会在启动 worker 前失败。失败路径使用模块捕获的错误 intrinsic 与属性定义 intrinsic，以及 null-prototype 描述符，因此模型之后的修改无法把被拒绝的绑定变成 worker 崩溃。
- **两个独立预算，因为对端不可信**：`computeMs` 统计 worker 实际测得的忙碌时间（轮询 `worker.performance.eventLoopUtilization()`）；热循环无法借助待完成的诱饵 dispatch 隐藏，程序等待慢工具时则不累计。`maxWallMs` 为忙碌时间无法观测的情况兜底（例如等待永远不会 resolve 的 promise）。二者最终都会调用 `worker.terminate()`，连同步热循环也能终止；堆溢出会表现为 worker 的 OOM 退出（`kind: 'worker-exit'`）。`maxWallMs` 在加载时会对照 `MAX_TIMER_DELAY_MS` 做范围校验：`setTimeout` 会把更长的延迟限制为 1 ms，仅有正数校验会放行一个在第一个 tick 就到期的上限。`computeMs` 不需要这道上界，因为它对照的是实测占用率，而不是喂给定时器。
- **中间绑定值是完整 JSON**：绑定参数与 resolve 值会接受迭代式无损 JSON 验证。程序执行前，worker 会捕获自己 realm 中的普通容器原型身份，以及只用于外部 realm 的原生函数源码检查，因此构造器槽修改和用户编写的仿冒对象都无法改变容器分类。它还会捕获该 JSON 边界使用的每一个结构与计量 intrinsic，以无原型对象创建属性描述符，并绕过可变集合原型管理私有遍历状态；因此，模型对全局对象、原型方法或 `Object.prototype` 上形似描述符字段的修改，都无法改变验证、wire 传输或字节计量。值会展平为自身嵌套深度有界的前序 wire 值，供 structured clone 使用，并在另一侧迭代式重建。它们没有字节、JavaScript 调用栈或嵌套 structured-clone 深度上限，绝不会进入外层输出账本或模型上下文；上限仍来自提供方／执行器获取限制与进程／worker 内存。
- **日志主动流入一个外层账本**：console／stdout／stderr 文本按产生顺序经端口传输，因此超时或被终止的程序仍会显示已经打印的内容。worker 会精确统计 JSON 字符串的字节数，并在发送完成值和异常诊断前，根据组合预算的剩余量预检；因此，抛出的百万字节 stack 会在 worker 边界变成固定的 `output-limit` 诊断。绕过补丁 stream 槽的原生写入会到达独立于完成端口的 pipe，因此宿主会针对这些字节和不可信伪造通信再次执行账本统计；在物化结果前，结算过程会持续进行有界 pipe 捕获，直到 worker 完成终止。`maxOutputBytes` 统计外层 `logs` 数组加完成值或失败消息载荷的 JSON 序列化；固定的 `CodeRunResult` 字段名、花括号、有界错误 kind 标签，以及后续呈现空白不计入这份可变载荷账本。未超过上限时会返回精确值；有损完成值属于 `invalid-output`，组合溢出属于 `output-limit`，不会用 inspected string 代替。失败会保留能容纳的已捕获前缀，之后按普通外层 `run_code` 落盘策略处理。
- **空环境**：worker 使用 `env: {}` 和 `execArgv: []`，既不会获得环境变量中的凭据（比 spawn 命令的清理环境规则更严格），也不会继承 loader 标志。
- **dispose（资源释放）时等待完全停稳**：清理会使进行中的运行以 `abort` 失败，并会等待每个 worker 退出后再完成。

## 未构建与已构建的 worker 入口

源代码模式通过 Node 原生类型剥离加载只包含可擦除语法的 `src/worker.ts`。其传递运行时闭包只包含 Node 内置模块和相对源模块，因此全新 checkout 绝不需要兄弟工作区包尚未构建的 `lib/` 导出。worker 本地和会话自有的 JSON 边界都会在消息端口两侧展平并重建已验证值，使应用嵌套永远不会进入 structured clone。构建模式会把兄弟文件 `lib/worker.cjs` 作为文件系统路径传入，因为 pkg 的虚拟文件系统（VFS）Worker hook 要求 CommonJS；同一路径也可在普通 Node 下使用。对这个已发布入口路径进行测试的仓库级要求由[测试策略](../../../docs/testing.md)规定。

SDK 对外提供默认及具名导出的 `WorkerThreadCodeRuntime` 类，以及 `Config`。运行所用的 `./worker` 子路径仅作为打包后的 spawn 入口存在；wire 协议与启动辅助模块是源代码私有的实现细节。

## 模型体验

通过 [`dsh-tools`](../../core/tools/README.md) 中的 Code Mode 间接提供；如果外层值能容纳则原样渲染，否则返回明确的 `invalid-output`／`output-limit` 失败。只有外层 `run_code` 结果进入模型上下文并使用普通落盘策略；绑定通信与中间值始终只存在于执行环境中。

#### KV Cache 影响

不会直接失效；由上述消费方负责请求前缀变更。

## 已知限制与暂缓事项

- **程序派生的 OS 进程在程序终止后仍会存活**：`worker.terminate()` 只结束线程，比 bash-local 的进程组终止更弱；在容器后端出现前，孤儿进程清理属于部署职责。
- **类型剥离依赖 Node 的实验性 `stripTypeScriptTypes` API**：如依赖的行为发生变化，amaro 或 sucrase 是已经点名的直接替代品。
- **`computeMs` 到期最多可能超过一个轮询间隔**：系统每 25 ms 采样一次忙碌时间（内部常量，有意不做成配置）。
- **程序获得一个含 5 个方法的 `console` shim**（`log`／`info`／`warn`／`error`／`debug`）：有意不提供 Node 的完整 console 接口。
- **中间绑定值没有字节上限**：程序可以用永远不会成为外层输出的值耗尽进程或 worker 内存。
- **默认 64 MiB 是拒绝边界，不是可恢复存储**：外层落盘只能保存发生 `output-limit` 后返回的有界日志和诊断；在运行时上限之外被拒绝的字节永远不会到达落盘层。
