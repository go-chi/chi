# sandbox/：进程沙箱能力家族

[English](README.md) | 中文

本家族将逐会话限制策略应用于进程执行。它覆盖与宿主共享文件系统和内核的子进程；隔离环境会替换完整的能力实现，而不是在此注册。

| 包 | 职责 | ctx key |
|---|---|---|
| [`sandbox/`](sandbox/README.md) | 定义进程沙箱服务和共享升权词汇 | `ctx.sandbox` |
| [`sandbox-local/`](sandbox-local/README.md) | 提供本地平台限制后端 | 注册到 `ctx.sandbox` |
| [`sandbox-policy/`](sandbox-policy/README.md) | 解析持久的逐会话沙箱策略 | `ctx.sandboxPolicy` |

[沙箱决策](../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)记录了能力边界，[文件系统集成决策](../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md)记录了跨家族策略的使用方式。

子系统参考——模式与强制执行、按调用策略、包装 argv 方言、故障关闭错误——见 [docs/subsystems/sandbox.md](../../docs/subsystems/sandbox.md)；边界与跨家族阶段见[沙箱](../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)与[跨家族 fs 沙箱](../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md) Agent Note。
