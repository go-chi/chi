# subprocess/：子进程能力家族

[English](README.md) | 中文

这里集中提供一个执行世界的共享进程基底：可执行文件查找、具有原始或收集式 stdio 的完全明确指定的受管子进程树，以及一项底层终端进程原语，负责 PTY 分配、前台进程组和提供方仍可观察到的会话成员清理。命令默认值补全、shell 语义、时限、协议分帧、就绪状态与呈现留在消费方：[bash 执行器](../shell/README.md)、[LSP 主机](../lsp/README.md)、[PTY shell 后端](../terminal/README.md)与 [ACP（Agent Client Protocol）subagent 后端](../subagent/README.md)。参见 [subprocess seam Agent Note](../../.agents/notes/implemented/architecture/2026-07-26-subprocess-seam.md)。

| 包 | ctx 键 | 角色 |
|---|---|---|
| [`subprocess`](subprocess/README.md)（`@deepseek-ai/dsh-subprocess`） | `ctx.subprocess` | Service Definition：可执行文件查找、普通受管 spawn、终端进程原语、句柄生命周期，以及共享的环境／输出词汇 |
| [`subprocess-local`](subprocess-local/README.md)（`@deepseek-ai/dsh-subprocess-local`） | 无 | 本地 Service Provider：detached 进程树、有界收集／spill、`node-pty`、前台／会话检查、进程树信号发送，以及先终止再等待退出的 dispose（资源释放） |

即使消费方重载，进程生命周期仍由服务负责管理；消费方负责定义进程的含义（一条 bash 命令、未来的非 shell 运行器），以及决定塑造该进程的每一项默认值。

子系统参考——spawn spec、输出读取器、结果、`DSH_*` 环境——见 [docs/subsystems/subprocess.md](../../docs/subsystems/subprocess.md)；seam 决定见 [subprocess seam Agent Note](../../.agents/notes/implemented/architecture/2026-07-26-subprocess-seam.md)。
