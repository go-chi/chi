# @deepseek-ai/dsh-plan-mode

[English](README.md) | 中文

按 agent（智能体）分别记录到日志的 plan 协作状态，提供由部署方配置的引导内容、用于直接进入的 `/plan [message]` 命令、用于直接退出的 `/plan off` 命令，以及经用户评审的 `exit_plan_mode` 退出方式。Plan mode 是软引导；沙箱模式和批准策略各自强制执行限制，且不读写 plan 状态。

## 持久状态

`plan/mode`（`{ active: boolean }`）是一个仅存在于日志中、每次以完整值替换的 `SessionEventMap` 成员。`foldPlanMode(events)` 返回最后记录的值，如果没有则返回 `false`，因此恢复、fork 和压缩（compaction）都能直接从会话日志恢复 plan 状态。UI 通过 `session/event` 观察已提交的切换。

`ctx.planMode.set(agent, active)` 会在 agent 空闲时立即追加独立的 `plan/mode` 事件，因为下一个提示词之前不会运行轮内 pre-step。agent 运行时，该方法会保留待生效选择，直到下一个被接受的轮内 pre-step。返回值区分 `committed`、`queued`、表示反转的 `cancelled` 和 `noop`。`get(agent)` 返回 `{ active, pending? }`，将用于组装当前步骤的日志状态与用户的轮中选择分开。初始与续步 pre-step 都会应用待生效选择；同一步骤的请求恢复重试会复用已冻结的 assembly，并将该选择保留到下一个被接受的轮内 pre-step。当最后记录的请求头描述了另一状态时，用户选择的变更会贡献一条插件来源的 `user/message` 通知（两条提交路径皆然）。

## 模型与人类交互

激活时，`plan:policy` 会渲染已配置的 `section`。插件始终注册 `exit_plan_mode`，使工具 schema 在转换期间保持稳定；其 execute 路径只接受已激活的 plan mode，且只有通过 `ctx.userQuestions` 获得用户明确批准后才退出。

评审问题声明 `plan-review` 呈现意图，并指名 `Approve` 为表示批准的标签，因此有能力的 UI 会把计划呈现为一次决定而非通用问题；两种情况下该工具读到的回答完全相同。放弃审阅——用户关闭请求，转而发言——会如实报告给模型，要求它留在 plan mode 中等待那条消息；其余每一种评审失败都保留 seam 自身的消息。

组合 `ctx.commands` 时，该包会注册 `/plan [message]`，并将参数恰好为 `off` 的情况保留给直接退出。不带参数的 `/plan` 会启用 plan mode；任何其他非空参数都会先启用 plan mode，再通过 `agent.steer()` 提交，因此它会在 plan 引导下成为下一步骤的常规已记录用户消息。`/plan off` 会选择停用状态，不发送模型输入；它还可以在启用 plan mode 的待处理选择由轮内 pre-step 追加之前将其取消。

Web 客户端使用该插件提供的 `/plan` 命令；其他入口可以直接驱动同一服务，无需定义第二套 mode 词汇。

## 会话投影

当组合挂载 `ctx.sessionProjections`（[`@deepseek-ai/dsh-session-projection`](../../session/session-projection/README.md)）时，本包会在一个注入的子插件中注册 `plan` 投影单元。该单元折叠两类事件：名为 `plan` 且携带已记录 `args` 的 `command/run` 记录会设置目标状态（`off` → 未激活，其余 → 激活），`plan/mode` 会提交已记录状态并清除该目标；其他任何事件都返回同一个状态引用。`view` 推导 `{ active, pending }`，其中 `pending` 仅在尚未落实的选择与已记录状态不同时为 true。该值完全由日志回放得出，因此 host 重启、其他标签页和冷读都能仅凭日志恢复它。`/plan` 处理器会在任何可能失败的路径之前调用 `set()`，因此处理器失败时不会留下缺少对应 plan 选择的已记录命令。key 由 `src/types.ts` 通过声明合并加入 `SessionProjectionMap`：host 消费方经 `./types` 获取，client 聚合经 `./client` 获取。框架负责驱动该单元，载体通过历史尾页和 `session/projection` 推送帧提供其值。未挂载注册表的组合不受影响。

## 配置

```yaml
- id: plan-mode
  name: '@deepseek-ai/dsh-plan-mode'
  config:
    section: |
      You are in plan mode. Explore and design before presenting the complete
      plan through exit_plan_mode.
```

`section` 必填且非空。出现未知键时，插件会加载失败。该包不接受任意命名的 mode、工具过滤器、沙箱设置或批准策略。

设计：[plan 专用协作状态](../../../.agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md)。

## 模型体验

### Plan 策略系统提示词

#### 模型所见内容

Plan mode 激活时，模型会在提示词顺序 50 处看到部署方提供的原样 `section` 文本；未激活 mode 不贡献文本。

##### 配置示例

```markdown
You are in plan mode. Explore and design before presenting the complete plan through exit_plan_mode.
```

#### Token 影响

未激活 mode 不增加 token；mode 激活时，每个请求都会加入已配置的段落。

#### KV Cache 影响

该段在 plan mode 内稳定，但进入或退出会从顺序 50 开始改变系统提示词。

### 人类命令

#### 模型所见内容

`/plan`、`/plan off` 及其终端结果留在模型历史之外。除恰好为 `off` 以外的非空后缀会在选择 plan mode 后，通过 `agent.steer()` 成为一个已去除首尾空白的用户文本块。plan mode 已激活时，选择 `/plan off` 只会在最后一个请求头描述了 plan mode 的情况下追加标准的已记录用户切换通知；取消待生效进入不会贡献通知，因为没有请求观测到它。

#### Token 影响

可选消息的历史 token 成本与单独提交该文本相同；不带参数的 `/plan` 和 `/plan off` 不增加 token。一次带有切换通知的已激活状态退出会追加一条简短且会保留的通知。

#### KV Cache 影响

用户块是仅追加的对话增长。进入或退出 plan mode 会改变更早的策略段；退出转换的记录通知会追加在可复用请求前缀之后。

### 退出工具 schema 与评审交互

#### 模型所见内容

[`exit_plan_mode` schema](../../../docs/tool-catalog.md#deepseek-aidsh-plan-mode) 在两种状态下均可用；在 plan mode 外执行会失败，而 plan mode 内经批准的评审会返回规范的 `{ approved: true }` 值，并渲染既有的确认文本。拒绝仍是携带评审反馈的失败调用，放弃审阅则是一次指明用户接手的失败调用。

#### Token 影响

稳定 schema 的成本取决于 ToolRuntime mode，每次传入的 plan 参数和评审结果都会保留在对话历史中。

#### KV Cache 影响

mode 转换不改变工具目录；plan 参数与评审结果按常规方式扩展对话。

## 已知限制与暂缓事项

- Plan mode 只进行引导，而不强制执行；需要强制限制的部署必须分别配置沙箱与批准控制。
- 如果进程在另一个被接受的轮内 pre-step 之前退出，某轮最后一个被接受的 pre-step 之后作出的选择会丢失，因此 UI 必须重新应用它。
- Fork 的 agent 会继承已记录的 plan 状态，新 spawn 的 agent 则从未激活状态开始；不存在创建时 plan 选项。
- 由另一个 agent 所有的存活子级无法打开 `exit_plan_mode` 审阅。该调用失败时会提示子级在最终结果中包含尚未解决的决策；仅有持久化 fork 谱系并不会阻止恢复为运行时根的会话打开该审阅。
- 只有 Web UI 具备专用的 `plan-review` 渲染器；其他交互提供方可以通过通用选项流程呈现同一请求。
