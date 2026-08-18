# 维护 dsh-code-review skill

[English](maintaining-dsh-code-review.md) | 中文

[`dsh-code-review`](../../.agents/skills/dsh-code-review/SKILL.md) skill（技能）由一名指定操作员通过私有的周期维护工具持续更新。本实操手册既是该操作员和接任者的入口，也帮助仓库贡献者理解为何 skill 更新会以小型周期 PR（Pull Request）的形式出现，而不是一次性审计。工作流本身由[人工评审 skill 维护 Agent Note](../../.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md)规定。

## 维护者会收到什么

操作员每天手动调用包装脚本，并使用 2 个 UTC 日的重叠窗口；每周手动恢复运行使用 7 日窗口。工作流会：

1. 选择指定窗口内合并、且合并 commit 可从 `origin/master` 到达的 PR（每天运行默认选择 2 个 UTC 日，每周运行选择 7 日）。合并 commit 无法到达的 PR（例如父分支被 squash 的堆叠分支），或超出 250 个 commit 获取上限的 PR，会记录到 `skipped-pulls.json` 并跳过，不会中止本次运行。
2. 收集合并前带 commit 锚点的人工评审反馈（行内评论和评审提交），然后比较反馈时与最终落地的 PR patch。它不获取 PR 会话评论，因为 GitHub 当前状态无法为这些评论提供可抵抗 force-push 的反馈时基线；它也不会把只存在于目标分支的变更作为采纳证据。
3. 两个独立配置的评审适配器先对每个条目的作者以及更改是否采纳了它进行分类，再根据当前 skill 对双方一致认定已采纳的条目分类。
4. 主适配器起草完整修订版 `SKILL.md`；两个适配器评审同一份 diff；只要仍有阻塞性问题，循环就会继续，直到双方批准。
5. 工具声明成功前，会针对候选版本运行 `pnpm run doc-sync` 和 `pnpm run lint`。

每次运行都把产物保存在操作员的机器上。保存的 diff、候选 `SKILL.md` 和提升 manifest（元数据清单）按时间戳命名，存放在 `~/dsh-code-review-outputs/` 下。manifest 记录源 master commit 与 skill blob、源反馈 ID 和 URL、已落地证据范围、适配器裁决和门禁结果；每个适配器的原始 I/O 留在私有临时目录中，该目录路径会写入通知和 `~/Library/Logs/dsh-code-review-maintainer/` 下的每日日志。维护 worktree 在每次运行后都会恢复为干净状态，避免操作员直接在维护副本中编辑。

## 操作员如何处理候选 diff

某次运行产出候选版本时，macOS 会发出一条带 `dsh-code-review-promote <timestamp>` 提示的通知。

1. **根据 diff 本身作出判断。** 不要因为「评审者已经批准」就直接接受；维护者约定规定由操作员作出最终决定。检查清单是否膨胀、是否有历史叙述、是否根据单次事件作出无依据的外推，以及是否与现有 skill 或权威文档重复。

   ```sh
   ls ~/dsh-code-review-outputs/                         # every candidate ever produced
   less ~/dsh-code-review-outputs/2026-07-16T02-00-00Z.diff
   less ~/dsh-code-review-outputs/2026-07-16T02-00-00Z.SKILL.md
   less ~/dsh-code-review-outputs/2026-07-16T02-00-00Z.manifest.json
   ```

2. **与运行产物交叉核验。** 提升 manifest 会把每条拟议规则映射到源反馈和已落地证据；每个适配器的详细 I/O、共识和采纳证据位于本次运行的私有临时目录中（路径见日志）。至少抽查一个候选项：链接的人工评论是否确实支持新增规则？链接的 PR 是否确实采纳了它？

3. **从三种处理方式中选择一种：**
   - **丢弃。** 删除保存的候选版本。下一次运行会依据届时的当前 skill，重新考虑同一份反馈。

     ```sh
     rm ~/dsh-code-review-outputs/2026-07-16T02-00-00Z.{diff,SKILL.md,manifest.json}
     ```
   - **留待成批处理。** 如果更新很小，可以把候选版本留待与后续版本合并。源 skill 检查仍然适用；如果 `master` 先发生变化，请重新运行分析，或手动 rebase 并重新评审 diff。
   - **提升。** 在仓库的干净 `master` checkout 中运行提升辅助工具。它会刷新 `master`、验证当前 skill 与记录的源 blob 一致、应用保存的 diff，并创建一份 draft PR，其正文列出原始反馈的 URL 或 ID、已落地的 commit 范围、发起这次更改的运行、检查以及操作员编辑。如果 skill 已发生漂移，它会停止而不是覆盖更新后的指导；操作员仍需在 GitHub 上评审 PR，并选择合并或关闭。

     ```sh
     cd ~/path/to/deepseek-harness   # clean master
     dsh-code-review-promote 2026-07-16T02-00-00Z
     ```

4. **不要逐字提交适配器输出。** 提升过程中可以进行小幅编辑，例如收紧措辞、移除只有结合源 PR 上下文才有意义的示例、把规则并入现有规则。这些编辑是预期行为，也保留了工作流所依赖的「评审者判断」。合并前应在该分支上修订这些改动。

## 运行未产出候选版本时

只要每个非空分类阶段都至少产生一个有效的适配器结果，这就是常见情况。工具会在每日日志中记录「无候选版本」，不发送通知（避免提醒疲劳），然后继续。某天没有 skill 更新，说明工作流运行正常，而不是停滞。

## 中断与交接

该机制运行在一台机器上。操作员应随时处理以下中断：

- **错过每日运行。** 2 日重叠窗口会自动覆盖一次漏跑；更长的间隔可通过设置 `DSH_CODE_REVIEW_SINCE=<Nd>` 手动运行包装脚本来恢复。重叠窗口具有幂等性：当前 skill 已包含的指导会被归类为 `covered`，不会再次成为候选项。
- **适配器提供方中断。** 当两个评审命令解析为逐字节相同的可执行文件时，工具会拒绝运行。某个批次的适配器响应未通过 schema 或 ID 校验时，该批次会整体 fail-closed（其中每个条目都标记为不明确），运行则继续；原始输出会保留以便调试。如果任一适配器在某项操作的所有非空批次中都未产生有效结果，本次运行就会失败、写入失败记录并通知操作员；它绝不会把提供方完全中断折叠成「无候选版本」。
- **交接给另一名维护者。** 新建一篇取代当前记录的后续 Agent Note：要么把机制移入仓库，要么记录新操作员的私有设置。不要暗中转交工具；Agent Note 的风险章节已把「单维护者关键人风险」列为交接必须记录决策的原因。

## 操作员的私有设置位于何处

工具源代码、评审适配器、提供方凭据和调度器属于操作员的私有基础设施，按设计位于本仓库之外（参见 Agent Note 的「机制位于何处」章节）。本实操手册和 Agent Note 描述的是**工作流保证什么**；这些保证**如何**实现则属于私有基础设施问题。如果你是新操作员，应以 Agent Note 的 `## Proposal` 各节作为实现依据。
