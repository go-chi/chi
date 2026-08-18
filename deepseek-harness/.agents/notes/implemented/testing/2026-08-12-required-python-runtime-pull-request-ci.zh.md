# Agent Note: 必需的 Python 运行时拉取请求验证

Status: implemented

[English](2026-08-12-required-python-runtime-pull-request-ci.md) | 中文

## 问题

普通拉取请求 CI 会针对 fake 运行时对端执行完整的 Python SDK pytest 套件，而 Node 快照使用不同的客户端与预期输出。真实 Python 客户端、打包后的 JSON-RPC 可执行文件、exe 专用快照、发布形态 wheel 包与干净安装只在可选的单文件可执行程序工作流或 Python 发布工作流中汇合。因此，运行时事件或闭包发生变化后，陈旧的 Python 投影或损坏的 wheel 包路径仍可能合并，直到后续有人构建 Python 发布候选版本时才失败。

## 决策

每个拉取请求都在 [CI](../../../../.github/workflows/ci.yml) 中运行必需的 `python-runtime` 作业。该作业不使用路径过滤，调用共享的[单文件可执行程序构建器](../../../../.github/workflows/build-exe-for-python-sdk.yml)构建 `node24-linux-x64`，并参与 `all checks passed`。被调用的工作流会构建真实可执行文件，运行全部无密钥 Python 完整轮次和直接二进制场景（包括两份检入的快照），构建 SDK 与运行时 wheel 包，将二者安装进干净的虚拟环境，检查可执行文件与原生 addon 的 GLIBC 依赖，并在 manylinux 2.28 容器中运行已安装的 wheel 包。

必需作业与 [Python 发布工作流](../process/2026-08-11-python-publication-workflow.md)共用同一构建器。其并发键包含调用方工作流，因此同一 ref 上的必需 CI 与显式完整发布验证不会互相取消。完整的 linux-x64、linux-arm64 和 macos-arm64 矩阵仍属于发布验证：平台无关的运行时、SDK 与快照行为只需要一个阻断合并的原生载体，而架构相关的可执行文件、addon、wheel 包标签与部署目标行为在发布前仍需要全部发布目标验证。

进阶 exe 快照会在比较前规范化不透明的会话、消息、subagent 和工作流运行标识符。因此，新增的持久化工作流事件会改变经过审阅的预期输出，但不会把随机运行标识符写入其中。极简场景的[模型可见快照](2026-08-13-python-minimal-model-visible-snapshot.md)覆盖了这份快照所占位化的已组装系统提示词、工具 schema 与消息列表。

## 曾考虑的替代方案

**每个拉取请求都运行完整原生矩阵。** 这会在三个作业中重复平台无关的完整轮次与快照行为，并让每项改动都消耗 ARM64 Linux 和 macOS 容量。Python 发布工作流在需要全部三个产物的环节保留这部分证据。

**针对开发用 Node 载体运行快照。** 这可以捕获协议与事件投影漂移，但不能证明 pkg 组装、部署后的运行时闭包、原生 addon 暂存、wheel 包构建、精确依赖版本与干净安装。必需的 Linux exe 路径直接覆盖发布路径。

**通过路径过滤或标签选择该作业。** Python 行为依赖 `python/` 之外共享的 agent、会话、工作流、subagent、插件加载与打包代码。不完整的依赖过滤会再次造成延迟发现，标签则会让证据保持可选。

## 后果

每个拉取请求都会承担一次标准托管 Linux exe 与 wheel 包构建，`all checks passed` 也会等待该作业。这使第一方 Python 分发成为合并时约定，并复用发布实现，而不维护一条更小的替代流水线。

单一必需架构无法检测 macOS 或 Linux ARM64 打包回归。发布前仍必须执行显式完整发布验证，并由该验证负责这些平台特定结果。
