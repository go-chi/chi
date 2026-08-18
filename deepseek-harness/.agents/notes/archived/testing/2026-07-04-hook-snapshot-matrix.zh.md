# Agent Note: 钩子快照矩阵——覆盖两种 bridge 的端到端预期输出测试

Status: implemented
Archived: 2026-07-26

[English](2026-07-04-hook-snapshot-matrix.md) | 中文

## 问题

钩子 bridge——[`dsh-hooks-claude`](../../../../packages/hooks/hooks-claude)（7 个 Claude Code 钩子点）和 [`dsh-hooks-codex`](../../../../packages/hooks/hooks-codex)（5 个 Codex 点）——把外部钩子命令映射到 harness 拦截 seam。它们有深入的单元与覆盖率规格覆盖（每个决策分支、每种 payload dialect，针对 mock seam 驱动），外加一个受密钥门控的 e2e（`hooks.e2e.ts`，实时 `PreToolUse` 阻止）。但完整 transcript（文本记录）快照层——会启动真实 `acp-agent` 子进程、无需密钥重放已记录会话，并将规范化 ACP（Agent Client Protocol）stdout + 重新持久化日志与已提交预期输出进行 diff 的那张网——只覆盖了一个钩子：Claude `UserPromptSubmit` 阻止（`hook-cc-promptsubmit-block`）。

这正是 mock 单元测试在结构上无法替代的层级：它验证的是真实 bridge 将真实钩子进程的结果翻译到真实 seam 决策，再经由自动化线协议和持久化日志检验真实 agent loop（智能体循环）的反应。一个 bridge 翻译或 loop 结构的回归，即使让所有单元测试保持绿色，也会在除那一个钩子点之外的所有点上逃逸；而对于 Codex bridge，ACP 示例甚至没有加载它，因此没有任何 Codex 钩子能端到端触发。

## 决策

实现由两个耦合部分组成：

### 1. ACP 示例同时加载两种钩子 bridge

`examples/acp-agent/cordis.yml` 和 `cordis.snapshot.yml` 现在同时加载 `dsh-hooks-codex` 与 `dsh-hooks-claude`，各自指向自己的配置文件（Claude 用 `./hooks.json`，Codex 用 `./codex-hooks.json`——两种方言无法共用一个文件）。这是一个真正的产品接口变更，而非仅用于测试的接线：交付的 ACP 服务器（以及 `demo:acp` 入口）现在同时携带两种 bridge。

这是安全的，因为配置文件不存在时 bridge 是**静默无操作**的：`apply()` 捕获读取失败、通过 `ctx.logger` 记录日志、不注册任何东西——零监听器、零会话事件。`acp-agent` 应用不附带 stdout logger，因此警告不会到达 ACP JSON-RPC 通道。只需要 Claude 钩子的场景（或真实项目）只提供 `hooks.json`；Codex bridge 找不到 `codex-hooks.json` 便自动消失。这已通过实验验证：在两种 bridge 同时加载的情况下，所有既有快照（均不附带 `codex-hooks.json`）逐字节一致。

同时加载是让快照层能够在产品交付的同一个真实应用上验证每种方言的最低要求。录制（启动 `cordis.yml`）天然加载两者，回放以同样方式继承：`cordis.snapshot.yml` 是 `cordis.yml` 的 include-overlay，只替换 llm 入口（见[单一来源 acp-agent 回放配置](2026-07-04-single-source-acp-replay-config.md)），因此添加到运行时树的 bridge 无需第二次编辑即出现在回放树中。

### 2. 每个钩子点 × 其主要结果各一个快照场景，覆盖两种方言

`examples/acp-agent/tests/snapshots/` 下共 13 个场景，命名为 `hook-<dialect>-<point>-<outcome>`：

- **手工编写、无模型轮次**（无密钥、无 sidecar——派生的回放脚本为空；比对的是携带 `hook/*` 事件的 `rejected` 轮次）：`hook-cc-promptsubmit-block`、`hook-codex-promptsubmit-block`。
- **对真实 API 录制、录制期间钩子活跃**（模型对决策的反应是捕获的 transcript 的一部分，此后无密钥回放）：`hook-{cc,codex}-promptsubmit-context`（allow + additionalContext 折叠）、`hook-cc-pretool-deny` / `hook-codex-pretool-block`（deny → `isError` 工具结果）、`hook-cc-pretool-ask`（ask → 降级为 deny 并附带 approval-required 原因）、`hook-{cc,codex}-posttool-block`（阻止并附带反馈）、`hook-{cc,codex}-posttool-context`（accept + additionalContext）、`hook-{cc,codex}-stop-continue`（阻塞性 Stop 钩子通过 steering（中途引导）强制多走一步）。

每个钩子命令只输出固定字面量字符串（无时间戳/pid/`$RANDOM`/cwd 回显）；快照规范化器擦除 `hook/result` 携带的唯一不稳定字段（`durationMs`）。`Stop` 场景通过标记文件（`.stop_fired`）自限，使 force-continue 不会循环——`stop_hook_active` 循环守卫仍是 bridge 的一个 `TODO`，因此无条件的 Stop 钩子会在每一步都 force-continue。

`PostToolUse` 阻止场景会在其证明的机制处自行限制。Claude 钩子在首次拒绝后持久化一个 workspace 标记，因此允许一次恢复调用；Codex 提示词发起一次调用并报告注入结果。每份预期输出固定一次遭阻止调用，不会重复阻止/重试循环。

### 三个钩子点被有意排除在快照之外

在构建矩阵过程中发现，记录于此是因为这些遗漏是决策而非疏忽：

- **`SessionStart` 和 `SubagentStart`** 通过脱离且尽力而为的 `void runPoint(...).then(agent.inject())` 注入上下文，没有轮次绑定。由此产生的 `context/message` 会与它应先于的工作（首次模型请求 / 子项的第一个轮次）竞速，并落在不确定的日志位置。记录的预期输出甚至无法在自己的重放中复现——对两者执行 10 次重放稳定性检查，结果均为 10/10 次失败。它们继续留在 bridge 的单元覆盖率中，那里会直接驱动 seam 而不存在时序竞速。（如果注入未来改为绑定轮次且具备确定性——`TODO(session-start-gating)` 所指方向——它们就能接受快照测试。）
- **`SubagentStop`** 只观察：其 `subagent/end` handler 不传递轮次（因此没有 `hook/*` 日志事件），也不执行注入。它不会向 transcript 写入任何内容，因此预期输出会与无钩子运行逐字节相同，永远无法证明失败——一道咬不住问题的守卫。它继续由单元覆盖率负责（`bridge.spec.ts` 已断言仅观察调用）。

因此，该矩阵覆盖了所有具有确定性、可观测 transcript 足迹的钩子点，涵盖两种方言。

## 后果

- 现在，两种 dialect 中每个具有可观察 transcript 的 bridge seam 映射，都在真实应用的完整 transcript 层受到守护——包括此前完全没有端到端覆盖的 Codex bridge。记录的预期输出捕获模型对遭拒绝/遭阻止/强制继续轮次的真实反应，而手工编写的 transcript 只能猜测这种反应。
- `UserPromptSubmit` 阻止场景无需密钥即可编写（没有模型轮次）；其余场景从已记录 fixture（测试前置数据）无需密钥重放。`pnpm run test:snapshot:record` 从实时 API 重新生成记录式 fixture，并像所有记录场景一样在缺少密钥时自行跳过。
- 证明会变红的准则仍成立：篡改钩子配置输出（例如改变拒绝理由）会让相应场景在重放时变红——钩子进程在重放期间真实运行（只有模型被重放），因此预期输出守护的是实际钩子→seam→循环路径，而非其 mock。
- `acp-agent` 演示现在加载了一个通常会无操作的 Codex bridge（典型项目中没有 `codex-hooks.json`），这正是预期的柔性失败行为，而非代价。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
