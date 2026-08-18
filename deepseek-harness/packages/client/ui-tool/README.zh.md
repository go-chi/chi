# @deepseek-ai/dsh-client-ui-tool

[English](README.md) | 中文

Client 工具展示插件。`ui-conversation` 通过 `conversation.chat.node` 的匹配 key 分发每个已排序的 `tool-call` Conversation Node；本包渲染其中的 root 及其 Code Dispatch 子调用，并把每个原子调用通过 keyed slot `tool.call.toolview` 分发。没有注册的工具名称使用通用卡片。

业务 UI 包只注册 wire 工具名称和原子视图，不配对会话事件、不重建 transcript（文本记录），也不拥有 root/subcall 拓扑。运行时仍对 call/result 配对、生命周期和递归 `subCalls` 投影拥有最终决定权；conversation view 仍对 ChatFlow 位置拥有最终决定权。

## 渲染约定

`ToolCallTree` 接收一个已经包含递归 `subCalls` 的 root `ToolCallBlock`、selection 状态、会话 `cwd`，以及用于打开文件和检查调用的 Host 回调。它递归遍历标准调用块，让 root 与任意深度的 child 经过同一条原子分发路径，不订阅独立的 parent-to-children map。

每个 root 和 child 包装层都保留 `data-chat-anchor-key="call:<id>"` 与 `data-chat-call-id` DOM 约定，供分页和 selection 使用。

本包还通过 `ToolDetails` 填充 `conversation.details.tool`。行 renderer 与详情 renderer 共用同一组面向 `terminal`、`read`、`diff`、`search` 和 `web` render intent 的纯 card model。未知的 intent 标签和格式错误的 wire card 数据都会回退为压平的工具结果文本。

通用行把已知工具名称归类为 search、read、shell、write、edit、code 或 generic 变体。运行中、成功、失败和中断状态只来自冻结的 call/result slice。只有用户调用 Host 打开文件回调时，文件路径才相对会话 `cwd` 解析；展示代码不读取会话服务。

## 原子工具视图

拥有该视图的业务包将其 wire 工具名称注册进 `tool.call.toolview`：

```ts ignore-check
ctx.slots.inject('tool.call.toolview', () =>
  ctx.slots.register({
    name: 'tool.call.toolview',
    key: '<wire tool name>',
  }, BusinessToolRow))
```

owner 载荷为 `ToolCallOwnerProps`：`callId`、`toolName`、冻结的 `block`、可选 `cwd`，以及普通的 `openFile`、`inspect` 回调。注册项会收到常规的会话 slot 运行时共享数据，但不会收到 React node、运行时服务或 root/subcall 知识。

本包当前拥有 generic fallback，以及 shell/pwsh、read、write/edit、grep/glob、web、todo、question 和 Code Dispatch 的内置展示。`ui-skill` 展示了业务包自行拥有的 `skill` 注册项。

各类卡片的上限与 fallback 规则仍由对应的 [terminal](../../../.agents/notes/implemented/feature/2026-07-28-web-terminal-card.md)、[diff](../../../.agents/notes/implemented/feature/2026-07-30-web-diff-card.md)、[read](../../../.agents/notes/implemented/feature/2026-07-30-web-read-card-frontend.md)、[search](../../../.agents/notes/implemented/feature/2026-07-30-web-search-card.md) 和 [web](../../../.agents/notes/implemented/feature/2026-07-30-web-result-card-frontend.md) Agent Note 负责。

## 模型体验

无，因为本包只渲染已经记录的工具调用和结果，不改变模型请求、工具执行或会话事件。

#### KV Cache 影响

无。本包只负责 Client 展示。

## 已知限制与后续工作

- Host 不把 `run_code` 暴露为 Code Mode 程序 binding，因此生产事件只产生一层分发；递归的运行时/UI 约定支持嵌套。
- 第一方工具视图集中在本包，可以通过 keyed slot 独立迁移到各自所属的业务包。
- 工具文案复用 `ui-conversation` locale namespace。
