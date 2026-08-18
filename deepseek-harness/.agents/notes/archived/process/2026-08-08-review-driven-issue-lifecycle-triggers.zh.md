# Agent Note: 由评审驱动的 Issue 生命周期触发器

Status: implemented
Archived: 2026-08-10

[English](2026-08-08-review-driven-issue-lifecycle-triggers.md) | 中文

## 问题

Issue 生命周期工作流会在每个已订阅的仓库事件发生后读取当前 PR（Pull Request），并将解决型 Issue 的状态向前推进到 `In progress` 或 `In review`。解决型草稿 PR 已通过其 `opened` 事件进入 `In progress`。在请求评审人或评审人提交评审之前，把该草稿转为可评审状态不会产生新的生命周期结果；但订阅 `ready_for_review` 仍会启动另一个托管作业，并创建另一个 GitHub App token。

草稿转为可评审状态的自动化通常会在片刻后提交评审。在这一事件序列中，转为可评审状态的作业无法推进 Issue，而要观察到 `In review` 阶段，仍必须运行评审作业。

## 决策

[Issue 生命周期](../../../../.github/workflows/issue-lifecycle.yml)不订阅 `pull_request.ready_for_review`。它保留 `pull_request.review_requested` 和 `pull_request_review.submitted`，因此无论是请求评审人还是提交评审，都可以将解决型 Issue 推进至 `In review`。处理程序仍会获取实时 PR，而不是根据触发事件的载荷推导阶段。

[Issue 政策](../../../../.github/workflows/issue-policy.yml)仍订阅 `ready_for_review`。该工作流负责在由人类发起的 PR 进入评审时执行必需检查；移除生命周期触发器不会削弱政策执行。

工作流测试会解析这两个文件，并固定这种划分。生命周期政策测试另行固定以下行为：草稿及开放状态的解决型 PR 会进入 `In progress`，评审请求或已提交评审则会使其进入 `In review`。

## 考虑过的替代方案

- **保留两个事件并取消正在进行的工作流运行**：不予采纳，因为并发控制可以丢弃待处理的工作流运行，却无法把两个 webhook 载荷合并为一次执行。取消较早的状态变更操作也会使正确性依赖事件到达顺序；而已经完成的转为可评审状态作业仍会产生完整的运行器初始化开销。
- **移除已提交评审事件**：不予采纳，因为评审可能在没有明确评审请求的情况下直接提交。在这条路径中，`pull_request_review.submitted` 是唯一能让系统观察到进入 `In review` 这一状态转换的仓库事件。
- **让每个 PR 事件都先经过防抖分派器再处理**：不予采纳，因为新增一条队列或一个定时工作流会引入延迟和控制平面状态，只为消除一个不携带生命周期信息的触发器。

## 后果

草稿转为可评审状态后，不再启动 Issue 生命周期工作。解决型 Issue 会保持在更早的 PR 事件所设定的 `In progress`，直到请求或提交评审；届时，一次由评审驱动的工作流运行即可将其推进至 `In review`。必需的 Issue 政策检查仍会在转为可评审状态的边界运行。

如果未来某个生命周期阶段依赖可评审状态本身，相关变更必须恢复该触发器，并更新工作流测试和本决策。在此之前，省略 `ready_for_review` 可使常见的先转为可评审状态、再提交评审这一序列少启动一次托管工作流运行，而不会遗漏状态转换。
