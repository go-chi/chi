# schedule/ — Session-local reminders

English | [中文](README.zh.md)

The Schedule family owns reminders whose durable state lives in the original Session log. A process-local owner waits only while that Session has a live root Agent; cold Sessions resume overdue work when they become live again and never imply an external notification channel.

| Package | Role | ctx key |
|---|---|---|
| `schedule/` | Versioned Schedule events and fold, model-facing create/list/delete tools, and a live root-Agent timer owner | — |

The package deliberately exposes no public Schedule service or mutable database. Tools and runtime append to the Session stream; due work enters the same conversation through the Agent's ordinary follow-up queue.

See [Session-local Schedule](../../docs/subsystems/schedule.md) for the durable record, transition, view, and delivery contracts.
