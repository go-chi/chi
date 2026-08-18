# `@deepseek-ai/dsh-loader-smoke`

[English](README.md) | 中文

用于测试通过 Cordis Loader 启动应用和 `cordis.yml` 的共享子进程 harness。`resolveExampleLaunch` 选择本地 `src` mode（tsx 和根 tsconfig 路径）或 CI `lib` mode（普通 Node 和包导出）；选择依据为显式 mode 或 `DSH_EXAMPLE_MODE`。

`runLoaderSmoke` 接受可执行文件路径和配置路径、可选的完整可执行文件参数、环境变量覆盖、标准输入、运行前准备和清理前检查。它负责隔离工作目录、DSH 主目录、诊断、截止时间、终止、EOF 和清理；进程以零状态退出后返回两个流，失败时则返回拒绝并附带两个流。

`runFixtureTurn` 通过恰好一个已配置的根 agent（智能体）驱动一项任务，在该任务进入持久收件箱后转发规范事件，刷写会话，并返回最终 assistant 文本和累计用量。示例本地 driver 继续负责配置、渲染和断言。

这是支持层测试基础设施，而非产品 API。

## 模型体验

无，因为测试 harness 仅提交调用方测试的普通用户任务，并将提示词和工具组装交由已加载的树负责。

#### KV Cache 影响

除已加载树本身的影响外，无其他影响；该 helper 既不更改请求前缀，也不跨运行保留状态。

## 已知限制与暂缓事项

- **构建模式需要事先构建**：配置还必须能够通过 `examples/node_modules` 向上解析每个命名包。
- **捕获的 stdout 和 stderr 仅受 execa 默认 100 MB `maxBuffer` 约束**：失控子进程会在该上限处被终止，而不是在冒烟测试自选的预算处。
- **超时只终止直接子进程**：有故障的 fixture（测试前置数据）spawn 的进程树可能比冒烟测试存活更久，需要外部清理。
