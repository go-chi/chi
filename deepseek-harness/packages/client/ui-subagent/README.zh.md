# @deepseek-ai/dsh-client-ui-subagent

[English](README.md) | 中文

Web subagent 功能 owner：向 `conversation.session.header.actions` 贡献可懒加载展开的目录树，向会话编辑器链贡献按原因区分的只读替代呈现，并保留注册到 `ctx.inputTriggers` 的既有 `@` 引用 source。

页头操作通过标准 `useSessions` 钩子读取 `subagentsByParent` 与会话摘要。非空直接目录到达后，其触发器会统计仅含 subagent 的完整后代谱系，在普通 fork 处停止，并在任一计入统计的后代处于 `running` 时显示活动仍在进行。紧凑树仍以直接目录为权威依据：可继续和 one-shot 行会显示 mode、`running`／`inactive` 活动状态和由日志支撑的可选 title，尾随列则在上行显示提供方的持久化 token 用量总计，在下行显示活跃轮次耗时。token 用量总计为四个互不重叠的 `tokenUsage` 桶之和。视觉耗时在不足一天时精确到秒，达到一天后则最多使用两个相邻单位——天／小时、近似月份／天或近似年份／月份——而悬停信息与无障碍名称会保留精确的天／小时／分钟／秒数值。耗时会累加已完成的 `subagentTiming` 轮次，仅在运行中 child 存在未结束轮次时每秒递增一次，并在 child 变为 inactive 后冻结；被中断的未结束轮次以其同一切面的 `active.through` 为上界，绝不使用更新的会话元数据。没有 label 的 one-shot 行会回退到其会话 id，而损坏、不受支持或不可用的行仍保持可读但禁用。每个健康行的 `hasChildren` 提示会在交互前决定是否显示展开控件，因此已知叶子节点从不显示箭头；每层目录仅在其中至少一个健康行是分支时才预留展开列，使完全不含分支的层级能从最前面的状态标记开始。展开分支时，会立即为每个已知直接后代预留一行禁用的加载行，随后再用该 child 的权威目录懒加载结果替换这些占位行。每个可见分支都会上报给运行时，使成员帧只在树正被消费的位置触发去抖动刷新。选择任意深度的条目都会使用该行的确切地址 `{parentSessionId, childSessionId, mode}` 调用 `SessionRuntime.openSubagent()`。组件局部状态负责树的可见性、已展开分支、键盘焦点与运行中耗时时钟。ArrowRight／ArrowLeft 展开和折叠分支；ArrowUp／ArrowDown、Home、End 与 Escape 用于导航或关闭树；关闭后焦点返回触发器。样式只使用 token。

one-shot child 始终选用只读编辑器，并将 transcript（文本记录）说明为已完成的执行记录。可继续 child 仅在其确切 parent 不可用且 child 未在运行时选用只读编辑器，并以文案说明恢复路径；此类 child 仍在运行期间，selector 会让位给普通编辑器——其输入区与 Send 操作被禁用，但独立的 Stop 保持可用，停止后只读替代恢复。确切 parent 存活时，可继续 child 保留普通输入 chrome，其会话通过 `subagent.prompt` 路由提示词：child 运行期间输入和 Send 保持可用，因为每条后续消息都会进入 child 的 FIFO inbox，而独立的 Stop 经由 `subagent.interrupt` 路由。本包绝不接收宿主上下文，也不调用面向模型的工具。目录与编辑器行为由 [Web subagent 对话 Agent Note](../../../.agents/notes/implemented/feature/2026-07-27-web-subagent-conversations.md) 与[当前轮次中断 Agent Note](../../../.agents/notes/implemented/feature/2026-08-06-continuable-subagent-interrupt.md) 规定。

普通侧边栏会省略带 subagent origin 的会话行，因此 parent 页头目录是它们的导航入口。普通 fork 仍保留在侧边栏中。

`@` source 仍然刻意保持独立且惰性。候选是从 `ctx.sessions.list` 零 RPC 得到的运行中 child；pick 会插入字面文本 `@label `，codec 投影为 `@label`。它不参与命令裁决，也不会把 label 解析成继续执行地址。

## 模型体验

### 用户提示词中的 subagent label 文本

#### 模型看到的内容

只有旧有 `@` 引用 source 会影响模型输入：pick 的候选以字面文本 `@label` 进入普通用户消息，没有专用内容块或宿主侧解析。浏览目录、导航 child 与查看持久化 transcript 都不会添加提示词 section；已接收的继续交互内容会经宿主 subagent 适配器成为普通 FIFO 用户消息。

#### Token 影响

有条件且仅追加：字面 `@label` 或用户后续消息只会向对应的新用户消息增加 token。目录与 transcript 操作增加零模型 token。

#### KV Cache 影响

仅追加。本包绝不改写更早的请求 token。

## 已知限制与暂缓事项

- **目录没有持久化结果**：活动状态与计时无法区分完成、失败或取消，且 UI 不公开 Activation 身份；停止能力仅限编辑器上针对运行中可继续 child 的当前轮次 Stop。
- **`@` 引用仍是显示标题文本**：重复或改名后的 label 会有歧义，因此它们刻意不获得继续执行语义。
