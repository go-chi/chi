# 仅限 Session 内的 Schedule

[English](README.md) | 中文

此 overlay 让一个 `dsh web` 进程显式启用 Schedule 提醒，同时不改变交付的默认 Web 组合：

```sh
dsh web --patch examples/web-schedule/cordis.yml
```

当前 overlay 支持使用正整数 `after_seconds`、绝对时间 `at` 目标，或至少 300 秒的固定速率 `every_seconds` 间隔创建提醒。模型通过 `schedule_create`、`schedule_list` 和 `schedule_delete` 管理它们；每个结果都会把交付标为 `session-local`。

浏览器会为每条提示词附加其 IANA 时区。Time-context 会告诉模型，把未明确限定时区的日期和时间解释为该请求的浏览器时区。此假设仅用于自然语言解释：`schedule_create.at` 必须是带 `Z` 或数值偏移量且严格符合 RFC 3339 的日期时间，或是带显式 `UTC` 或 IANA Area/Location 时区的 `{ date, time, time_zone }`。Schedule 不保留或推断 Session 默认时区。夏令时缺口会被拒绝，重叠时段选择第一个时刻；成功创建的记录只保留所得的 UTC 目标。

每条提醒由原 Session 日志拥有。live 根 Agent 会等待到完全 idle，再在该对话中排入一个普通 follow-up 轮次。它绝不会中途引导当前工作，也不会添加独立回执或提醒卡片。关闭进程或让 Session 保持 cold 会停止内存 timer，但不会删除记录；重新打开同一个 Session 会恢复等待并交付逾期提醒。查看 cold 历史不会激活提醒，fork 也不会继承父 Session 的提醒。

Every 提醒始终与其创建时刻对齐。如果提醒逾期，只会呈现最新一个到期发生时点，下一个目标仍保留在原固定速率序列上。同一次 idle 决策中逾期的所有不同 Every 记录会合并为一个 follow-up，每条记录各有一个发生时点；错过的间隔不会形成积压。已到期的一次性提醒会在该批次之前运行。不支持日历表达式和 Cron 表达式。

创建和实际删除操作只有在 Session persistence 确认对应事件前缀后才会确认成功。Schedule 不提供浏览器、操作系统、邮件、短信或其他外部通知。持久 dispatch 会记录 follow-up 已经入队；它不确认模型成功或用户已收到提醒。
