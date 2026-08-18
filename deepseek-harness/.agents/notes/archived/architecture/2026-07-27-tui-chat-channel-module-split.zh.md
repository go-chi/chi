# Agent Note: dsh-tui 聊天通道模块拆分

Status: implemented
Archived: 2026-08-04

[English](2026-07-27-tui-chat-channel-module-split.md) | 中文

## Problem

`packages/ui/tui/src/index.ts` 已超过 2000 行，其中绝大部分是单个 `createTuiChat` 工厂：一个约 1600 行的闭包，持有约四十个可变变量以及同等数量的嵌套闭包。模型选择、ask-user-question 队列、会话恢复都缠绕在这一个作用域里，读者无法在不把整份文件装进脑子的前提下理清任何单一关注点，互不相关的改动也会彼此冲突。此前一轮已把 `src/` 归组为 `components/`、`session/`、`extension/`，但入口文件本身以及散落在顶层的输入相关文件（`autocomplete.ts`、`file-autocomplete.ts`、`skill-invocation.ts`、`xml-tool-output.ts`）未动。

## Decision

聊天通道内聚的子机制从 `createTuiChat` 中抽出，迁入 `src/chat/`，每个都是接收显式依赖包的工厂，而非闭包捕获入口作用域：

- `chat/model-command.ts` — `createModelController`：排队执行的 `/model` 命令、模型加推理力度（reasoning-effort）的选择浮层，以及所选模型上下文窗口的解析。持有供提示行与状态视图读取的上下文窗口缓存。
- `chat/questions.ts` — `createQuestionQueue`：user-interaction provider 以及一次仅一个的 FIFO ask-user-question 浮层。
- `chat/resume.ts` — `createResumeController`：`/resume` 选择器、逐候选摘要读取、交接前预检、终端交接，以及持久化的恢复提示命令。
- `chat/helpers.ts` — 无状态辅助函数（`formatCwd`、`gitBranch`、surface/工具调用派生、会话引用卡片）、`HintEditor`，以及横幅揭示常量。
- `chat/channel.ts` — `ChatChannelDeps`（每个子控制器共享的协作者面）与 `ChannelNotice`（由需要上报结果的控制器混入）。各 `*Deps` 继承它们，使共享面只有一处定义。

`src/` 随之重组，使 `chat/` 汇集所有聊天通道关注点：上述子控制器，加上原来的输入文件与原 `session/` 文件（`timing.ts`、`tokens.ts`）都迁到 `chat/` 之下。`xml-tool-output.ts` 迁到 `components/` 之下。宿主/进程边界接口（`TuiRuntime`、`TuiResumeHost`）迁到 `src/runtime.ts`。拆分后 `src/` 为 `chat/`、`components/`、`extension/`，以及顶层的 `index.ts` / `config.ts` / `prompt.ts` / `runtime.ts` / `invariant.ts`；`index.ts` 从 2067 行降至约 1530 行，现负责构造并接线这三个控制器。

控制器依赖包的约定：稳定的取值型协作者（`ctx`、`resolved`、`palette`、`overlayManager`，以及各控制器自有的服务）一次性解构；通道回调（`appendNotice`、`requestRender`、`isDisposed`、`agentStatus`）保留在 `deps` 上，使控制器始终调用通道当前的实现。`channel.ts` 的 JSDoc 陈述了此规则。

## Alternatives considered

- **接收共享可变上下文对象的自由函数。** 否决：那会把拆分本要消除的四十字段大杂烩，仅换个参数名重新暴露出来。
- **同时抽出状态/计时动画控制器。** 推迟：`runningStatus` 被 `updatePromptValues` 中的提示光标动画直接读取，在此设控制器边界会让其内部状态经 getter 反向泄漏——收益甚微的漏隙缝。它继续内联在 `index.ts` 中。

## Consequences

每个关注点现可独立阅读与测试，共享依赖面只定义一次，而非复制进三个接口。代价：`index.ts` 负责构造这些控制器并穿针引线地传入回调包；模型控制器是 `let` 前向引用（`updatePromptValues` 闭包捕获它，但它要待 `appendNotice`/`overlayManager` 就绪后才构造），因而带一处有正当理由的 `prefer-const` 禁用与一次延后的首帧绘制。

## Testing

行为不变：现有的包测试与 TUI 快照全部无需重录即通过，这正是本次重构的契约。
