# dsh-agent-tool-presentation

[English](README.md) | 中文

[agent preset](../../preset/agent-presets/README.md) 用来声明「模型看到的工具是哪一种形态」的那一行：`native`（全部 schema）、`code`（只有 `run_code` 加一份生成的 TypeScript SDK）或 `both`。

## 为什么是一行插件，而不是把注册表搬下来

工具注册表搬不进 preset。它的消费者全在宿主平面——[`dsh-agent-loop`](../agent-loop/README.md) 读它的调度器，[`dsh-apiproxy`](../../host/apiproxy/README.md) 读它的 presenter 来渲染工具卡，每个工具插件都往里注册——而一个服务只有在**所有**消费者一起下沉时才能下沉。

preset 能拥有的是这份注册表的**呈现方式**。`ctx.tools.presentAs()` 只为正在挂载的那个 agent 声明，于是一个 Code Mode 会话可以和多个 native 会话同进程并存，各自看到各自的清单。[`dsh-tools`](../tools/README.md) 那一行上的 `mode` 仍然是默认值，供未作声明的 agent 使用。

## 它做什么

`native` 立即生效。code 类模式则等待 `ctx.codeRuntime`——这是一个宿主平面服务（[`dsh-code-runtime-worker-thread`](../../code-runtime/code-runtime-worker-thread/README.md)）：若某个 preset 在未组装运行时的部署上选择 Code Mode，本行就停在 pending，`dsh-agent-presets` 会指名此 id 拒绝挂载。另一种做法——先乐观应用——会把失败推迟到该会话的第一次请求，那时操作者对 preset 和组装都已无从下手。

`mode` 是必填而非有默认值：不带这一行的 preset 本来就会拿到部署默认值，省略它等于这一行白组装了。

一个 agent 只声明一次呈现方式。同一份组装里的第二次声明会被拒绝而不是合并：对「模型看到哪种形态」给出两个答案是矛盾，不是覆盖。

## 模型体验

间接生效，取决于它在 `dsh-tools` 中选择的投影：`code` 呈现 `run_code`、一份生成的 SDK 段，以及「只有 `run_code` 可被直接调用」这条规则，`native` 呈现每个工具的 schema。该选择同时决定了**什么可以执行**：在 `code` 下，注册表会把模型直呼其他任何工具名解析为 `UNKNOWN_TOOL`，因此这一行正是让「通告面」与「可调用面」对每个被它覆盖的 agent 保持一致的东西（[执行器塌缩 note](../../../.agents/notes/implemented/bug-fix/2026-08-07-code-mode-executor-collapse.md)）。

#### KV Cache effect

没有直接的失效影响；呈现方式在 agent 组装时即固定，因此其请求前缀在该会话的整个生命周期内保持稳定。

## 已知限制与暂缓事项

- **运行时仍在宿主平面** —— preset 可以选择 Code Mode，却无法自带它所需的 TypeScript 运行时；未组装运行时的部署也就无法组装任何 code 模式的 preset。
