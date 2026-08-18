# @deepseek-ai/dsh-command-compact

[English](README.md) | 中文

通过 [`ctx.compaction`](../compaction/README.md) 提供面向用户的 `/compact` 压缩（compaction）控制。该插件通过 [`ctx.commands`](../../interaction/commands/README.md) 注册一个全局命令，因此组合中的每个命令适配器都能发现并执行它，无需模型轮次。[排队手动压缩 Agent Note](../../../.agents/notes/implemented/feature/2026-07-30-queued-manual-compaction.md)拥有接纳、锁与持久性决策。

## 命令约定

| 输入 | 结果 |
|---|---|
| `/compact` | 即使未达到自动压力，也摘要一段有效、平衡的较早范围；独立标记对 flush 后，报告被替换的历史项数量与估算 token 数。 |
| `/compact`，但没有可压缩历史 | `No compactable history yet.`：不会写入标记，也不会变更 surface。 |
| `/compact <anything>` | `Usage: /compact (no arguments)`：该命令不接受参数，也不会调用压缩后端。 |

该命令与后端无关，只依赖 `compactNow(agent, signal)`。调用该命令的 agent（智能体）就是操作的确切目标，发起分发的 UI 会通过 seam 转发取消信号。每次完成的调用都会记录执行器所属的纯日志事件对 `command/run` / `command/done`；两者都不进入模型历史。成功时，`command/done.sourceEventSeq` 会指明该事务的 `compaction/summary` 事件，让呈现层无须解析结果文本或假定两行相邻，即可将命令生命周期归并到对应检查点中。

预期的 `ManualCompactionError` 代码会成为稳定的直接错误：

| 代码 | 直接结果 |
|---|---|
| `busy` | `Compaction is unavailable because this process has an active compaction, or the agent is not idle.` |
| `changed` | `The history selected for compaction changed before it could be replaced. The conversation is unchanged; the attempt is recorded in the session log.` |
| `summary` | `Compaction could not produce a useful summary. The conversation is unchanged; the attempt is recorded in the session log.` |
| `commit` | `Compaction did not finish cleanly; some session history may have changed. Inspect the current session state before retrying.` |
| `persistence` | `Compaction finished, but the session could not be saved.` |

busy 结果有意限定在进程范围内：活动的未匹配标记会阻塞，而早于最新 `session/end-seed` 的标记已陈旧，不会阻塞。意外实现故障会拒绝分发。取消仍具有最终决定权；后端会完成必需的闭合／flush 清理，命令内部以 `Compaction cancelled.` 结算，而命令执行器会因取消错误停止等待。插件处置会先注销 `/compact`，再等待所有已开始的处理器结算，因此根级 teardown 不会越过已中止命令的闭合或 flush 边界。

压缩运行期间提交的提示词仍会按 agent 的普通 FIFO 获得接纳，保留相同的身份与唤醒信息。它们仅在压缩的显式持久性检查点和接纳预留释放后启动。空闲注入的上下文不受阻塞：它可以记录在 `compaction/start` 与 `compaction/end` 之间，位置替换会使其在检查点之后保持可见。

## 组合

生产方注入 `commands` 和 `compact`。挂载命令注册表、一个后端与本插件：

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: compaction-basic
  name: '@deepseek-ai/dsh-compaction-basic'
- id: command-compact
  name: '@deepseek-ai/dsh-command-compact'
```

随附 `dsh` 基础配置将它挂载在 `compaction-basic` 旁，Web 客户端提供命令适配器。未组合命令适配器的自动化接口只保留自动压缩。

## 模型体验

### 用户 `/compact` 控制

#### 模型看到什么

斜杠输入与直接结果绝不会进入模型请求。已获接纳的压缩会另外在独立的 `compaction/* { turn: null }` 标记对内，用后端的 user 角色检查点替换一段较早范围。

#### Token 影响

命令生命周期不会增加模型 token。成功压缩会用一份带框架的摘要替换所选范围，从而减少后续请求；摘要生成本身需要一次辅助请求。

#### KV Cache 影响

命令发现与簿记不会影响缓存。已获接纳的 surface 替换会从第一个被遮蔽的历史 token 起使复用失效。

## 已知限制与暂缓事项

- **仅限空闲状态**：当一个轮次或已获接纳的唤醒提示词拥有优先权时，`/compact` 会报告 `busy`；命令本身不会排队。
- **不接受范围或策略参数**：无参数形式使各命令适配器的行为保持稳定。显式范围仍由编程接口 `compactRegion()` 处理。
- **仅限命令适配器**：没有 `ctx.commands` 的接口无法调用该命令，只能依赖自动压力压缩。
