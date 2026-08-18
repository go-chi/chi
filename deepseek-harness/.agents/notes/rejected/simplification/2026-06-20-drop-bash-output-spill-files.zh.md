# Agent Note: 移除 bash 完整输出 spill 文件

Status: rejected — 完整输出恢复是真实的 bash 行为。未来的产物／blob 服务或许能将其泛化，但在替代方案就位前删除 spill 文件会丢失有用的命令输出。

[English](2026-06-20-drop-bash-output-spill-files.md) | 中文

## 问题

`dsh-bash-local` 在内存中保留有界的输出，并将大体量的 stdout/stderr 流写入私有临时 spill 文件。这要求一个私有目录、随机创建仅所有者可访问的文件、关闭失败处理、基于字节偏移的增量读取、有损读取报告、在面向模型的文本中渲染路径，以及清理纪律。当输出被截断时，该工具会告知模型去读取一个本地 spill 路径。

这解决了一个真实问题，但方式狭隘且有泄漏。spill 路径是一项暴露给模型的进程本地文件系统产物，而非具有作用域访问控制、保留策略或 UI 支持的持久化 harness 产物。它还使后台任务的读取变得复杂，因为有损增量读取必须指向一个或两个 spill 文件。

## 提案

保留尾部截断，移除完整输出 spill 文件。bash 结果包含有界的尾部内容加一个明确的截断标记；不输出路径。如果用户需要恢复完整输出，则添加一个通用的产物／blob 服务（具有明确的所有权、清理和 UI 渲染），然后让 bash 将大体量输出附加到该服务。

本提案可以独立于[通用长时间运行工具运行时](../../implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md)落地。如果后台任务保留，`bash_output` 仍应报告输出已被丢弃，但不再提供 spill 路径。

## 验收标准

- `CollectedOutput` 不再携带 spill 路径。
- `OutputCollector` 仅保留有界缓冲区，删除临时文件机制。
- `renderResult()` 报告截断时不包含文件系统路径。
- 测试覆盖尾部截断，不再断言完整输出文件的内容。
- [docs/defensive-patterns.md](../../../../docs/defensive-patterns.md) 中的安全指导不再将私有 spill 文件视为面向模型的接口。

## 放弃的能力

模型或用户无法再从临时文件恢复大体量命令输出中被省略的前缀。在真正的产物服务出现之前，这是可以接受的。当前的 spill 路径为一个生命周期和权限均未经设计的功能引入了过多的专用机制。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
