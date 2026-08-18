# @deepseek-ai/dsh-client-ui-directory-picker-native

[English](README.md) | 中文

原生目录选择界面：原生选取交互的浏览器半边。它通过 ui-workspace 的两个 directory-flow 洞（`conversation.hero.workspace.directoryFlow` 与 `sidebar.workspaces.directoryFlow`）装入一个无渲染占位者，每次收到 `open` 请求就用 `ctx.workspaces.pickDirectory()` 驱动本地 Host 的操作系统选择框，然后通过 owner 会话回报恰好一个结果——选中的路径、取消、或失败。系统对话框本身属于 [`dsh-host-directory-picker-native`](../../host/directory-picker-native/README.md)；挂载本包即用一行 cordis.yml 把界面与该后端组合起来，因此没有任何客户端代码按能力种类分支。

两处注册通过嵌套的 `slots.inject()` 作为一个事务性 effect 安装，因为任一声明方条目都可能稍后激活或替换其声明。占位者在每个 `open` 上升沿只武装一次，所以重渲染（包括采纳期间 `busy` 而 `open` 仍为真）都不会再开第二个选择框；owner 撤回 `open` 会为下一次请求重新武装。结果经由 ref 回报，因此答案落到 owner 最新的处理器上，而不是打开选择框时捕获的那一套。卸载（HMR 替换占位者）会整体丢弃该结果：wire 上没有按请求的中止通道，所以 Host 侧的选择框会一直存在到被回答，它的答案无处可落，替换后的实例则在 owner 仍然打开的请求下重新武装。

node 半边是一个空 `apply`：它的存在只为让插件出现在 host 的 cordis.yml 与 Loader 中，浏览器半边经 `exports["./client"]` 出货，并通过 `dsh.client` 清单声明被发现。

## 模型体验

无，因为目录选择器属于浏览器界面；本包中的任何内容都不会进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **无法取消已打开的选择框** —— wire 上没有按请求的中止通道，因此已经出现在 Host 显示器上的选择框无法从浏览器关闭；被丢弃的结果只是被忽略。
- **仅限本地 Host 载体** —— 系统对话框开在运行 Host 的机器上，所以进程内与远程浏览器部署需要改用 `-browse` 组合。平台失败通过 owner 的可重试文件夹对话框呈现。
