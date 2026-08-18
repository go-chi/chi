# Agent Note: 在 Windows 上支持 TUI

Status: implemented
Archived: 2026-08-04

[English](2026-07-20-windows-tui-support.md) | 中文

## 问题

全屏 TUI 将原始输入、ANSI 渲染、终端尺寸变更事件和终端恢复委托给 pi-tui 的 `ProcessTerminal`。该依赖已实现原生 Windows 控制台路径，但仓库的真实进程冒烟测试此前使用 Python 中仅适用于 POSIX 的 `pty` 和 `termios` 模块。若在 Windows 上跳过该测试，这条受支持的产品路径便会缺少针对启动、输入、交互、失败报告和终端恢复的测试覆盖率。

TUI 平台契约必须以交付给用户的运行时为准，而不是取决于某个测试驱动程序的可移植性。只有产品存在不受支持的运行时依赖，或已证实存在语义缺口时，排除某个平台才有依据。

## 决策

[`@deepseek-ai/dsh-tui`](../../../../packages/ui/tui/README.md) 在 Windows、macOS 和 Linux 上均支持交互式终端。产品继续使用 pi-tui 的 `ProcessTerminal`；在 Windows 上，它会在进入原始模式后启用虚拟终端输入，并避开仅适用于 Unix 的 `SIGWINCH` 刷新。DeepSeek Harness 不增加平台拒绝逻辑，也不采用功能受限的 Windows 模式。

真实 Loader 冒烟测试根据宿主选择原生伪终端边界。macOS 和 Linux 继续使用 Python POSIX PTY 驱动，Windows 则使用 `node-pty` 和 ConPTY。两种驱动接收相同的启动命令、环境、终端尺寸、以标记为触发条件的输入动作、超时、预期退出码和输出断言；3 个冒烟场景都会在每个受支持平台上运行。

`node-pty` 是 examples 工作区仅供测试使用的依赖。该依赖经评审的原生安装脚本在 `pnpm-workspace.yaml` 中显式启用；生产 TUI 包（package）不会新增依赖或子进程层。

## 曾考虑的替代方案

- **声明 TUI 不支持 Windows**：不予采纳，因为固定版本的终端运行时已显式实现 Windows 控制台输入，且 harness 没有仅适用于 POSIX 的生产依赖。仅通过文档排除 Windows，等于为迁就测试 harness 的缺口而舍弃现有产品路径。
- **通过 MSYS、Cygwin 或 WSL 运行 POSIX 驱动**：不予采纳，因为这会测试兼容环境，而不是用户实际运行的原生 Windows 控制台路径。
- **在所有宿主上使用 `node-pty`**：不予采纳，因为现有 POSIX 驱动已经为 macOS 和 Linux 提供所需边界；替换该驱动会扩大运行时变更范围，却不会给这两个宿主带来改进。按平台选择驱动，仅在 Windows 上启用 `node-pty` 运行时路径，同时共享同一份场景契约。
- **依赖渲染器单元测试和语义终端快照**：不予采纳，因为模拟终端无法证明 Loader 启动、真实原始输入、进程退出或操作系统边界上的终端恢复。

## 后果

- Windows 产物 lane 执行启动、脚本化交互、配置恢复失败和终端恢复场景，这套测试不会在任何受支持平台上跳过。
- Windows 进程级验证依赖 ConPTY 和固定版本的 `node-pty`；变更该依赖或允许执行的安装脚本时，必须进行原生边界评审。
- 两种 PTY 驱动的内部实现可以不同，但共享的输入和断言会使其可观测 TUI 契约保持一致。
- Windows 支持范围以仓库交付的 Node 和 pi-tui 版本为界；不受支持的旧版 Windows 控制台环境不会获得兼容层。
