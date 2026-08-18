# Agent Note: 自动标题默认开启，恢复时重新推导

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-tui-auto-title-default-on.md) | 中文

> **已被取代**：见[标题归一 Agent Note](../simplification/2026-07-22-tui-titles-from-session-title-service.md)。TUI 本地的 `autoTitle` 生成已移除；标题来自日志承载的 session-title 服务，终端重命名消费 `session/title` 事件。

## Problem

[自动标题 Agent Note](2026-07-21-tui-auto-pane-title.md) 交付时 `autoTitle` 默认关闭，并且在恢复会话中因首条 `user/message` 已入日志而保留静态标题。实际使用中这两个选择都违背了该功能的初衷。让一个 tmux 窗格或终端标签页区别于下一个的，正是每会话各异的描述性窗格标题；默认关闭意味着产品交付了一个几乎无人开启的惰性功能，而恢复时不重新推导，则意味着恢复会话——恰恰是最值得标记的长命会话——退回到共用的静态字符串。用户要求把每会话的描述性名称做成常态体验。

## Decision

- `autoTitle` 默认**开启**（`z.boolean().default(true)`，`resolveTuiConfig` 以 `?? true` 与之对齐）。带有 `llm` 服务与 agent 提供方/模型的部署无需选择性开启即可在每个会话获得模型制作的窗格标题；不具备它们的部署保留静态标题，因此在调用无法运行处，默认开启是惰性的。
- **恢复**会话在挂载时从其已入日志的首条 `user/message` 重新推导标题：`createTuiChat` 在 `agent.session.events` 中扫描首个此类事件，并把其文本喂给同一个一次性的 `generateTitle`。标题从不持久化（会话头不携带标题字段），因此它始终是推导得来，而非恢复而来。
- 一次性门闩现在只是 `titleSettled = !resolved.autoTitle`。此前"恢复即预先结算"的分句已删除：恢复时 `generateTitle` 从已存储的首条消息运行一次随后上闩，因此恢复*之后*到达的消息不会再改标题。全新会话在挂载时没有已存储的 `user/message`，因此恢复扫描是空操作，改由实时的 `session/event` 监听器为首条消息命名。
- [自动标题 Agent Note](2026-07-21-tui-auto-pane-title.md) 的其余一切保持不变：OSC 0 的 `runtime.terminal.setTitle` 路径、模型概括形态（两到五个小写单词、首个非空行、40 字符上限）、从不触碰会话或 transcript（文本记录）的发出后不等待其返回的 `ctx.llm.stream` 调用、关闭时的 `AbortController`，以及每一条失败兜底（空回复、缺 `llm`、缺提供方/模型、仅含空白的提示词）。

## Alternatives considered

**让该功能保持默认关闭。** 否决：这是应用户要求，对[自动标题 Agent Note](2026-07-21-tui-auto-pane-title.md)"默认关闭"决策的直接反转。默认关闭交付的是惰性功能；只有当描述性名称成为常态体验时它才有用。当初促成默认关闭的无密钥回放顾虑，改由在以回放支撑的快照场景中固定 `autoTitle: false` 来处理，而非为每个部署都压制该功能。

**把推导出的标题持久化进会话头。** 否决：会话头没有标题字段，加一个会把终端标签变成会话元数据——正是[自动标题 Agent Note](2026-07-21-tui-auto-pane-title.md)已经对日志支撑的会话标题工作划出的边界。从已存储的首条消息重新推导，代价是恢复时一次无工具调用，并让标签保持为对话的纯函数。

**恢复时从最新消息而非首条消息重新推导。** 否决：标题概括的是会话*关于什么*，而这由其开场请求捕获；一条对话中途的消息会让窗格标签随工作推进而漂移。

## Consequences

- 带可用 `llm` 的全新会话现在默认多花一次无工具的模型调用（此前只在选择性开启时才有）；恢复会话在挂载时花掉一次。不具备 `llm` 或提供方/模型的部署不受影响。
- 以回放支撑的 `examples/tui-agent/tests/tui.snapshot.ts` 必须选择**关闭**：它固定 `autoTitle: false`，因为默认开启的标题请求不在录制轮次之列，而 `installLlmReplay` 对未录制的请求会显式报错。单元 `packages/ui/tui/tests/tui.snapshot.ts` 无需选择关闭——它不挂载 `llm` 服务，因此 `generateTitle` 提前短路，默认值的翻转在那里是惰性的。交互式的 `examples/tui-agent/cordis.yml` 与脚本化 PTY fixture（测试前置数据）已设 `autoTitle: true`，因此无密钥冒烟测试的 OSC 0 断言保持不变。
- `packages/ui/tui/tests/tui.spec.ts` 固定新的默认值：config 默认测试期望 `autoTitle: true`；关闭路径测试现在显式设 `autoTitle: false`；此前的"恢复会话从不触发"测试改写为断言从已存储首条消息重新推导，并断言之后的实时消息不会再改标题。`docs/config-catalog.md` 重新生成为"On by default"。
