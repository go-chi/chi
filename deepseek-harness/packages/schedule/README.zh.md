# schedule/：仅限 Session 内的提醒

[English](README.md) | 中文

Schedule 家族负责管理提醒，其持久状态保存在原 Session 日志中。进程内 owner 只会在该 Session 拥有 live 根 Agent 时等待；cold Session 再次 live 后会恢复逾期工作，但这不意味着存在外部通知渠道。

| 包 | 职责 | ctx 键 |
|---|---|---|
| `schedule/` | 版本化 Schedule 事件与 fold、面向模型的创建／列出／删除工具，以及 live 根 Agent timer owner | 无 |

本包有意不公开 Schedule service 或可变数据库。工具与 runtime 向 Session stream 追加事件；到期工作通过 Agent 的普通 follow-up 队列进入同一对话。

有关持久记录、转换、视图与交付约定，请参阅[仅限 Session 内的 Schedule](../../docs/subsystems/schedule.md)。
