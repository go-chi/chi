# @deepseek-ai/dsh-pwsh-sandbox

[English](README.md) | 中文

沙盒消费型的 [`ctx.shell` 执行器 seam](../shell/) 的 PowerShell 实现：每条命令以 `pwsh -NoLogo -NoProfile -NonInteractive -Command <command>` 运行，**经 `ctx.sandbox` 隔离**，选定模式、强制完整性、拒绝事实都盖在每次结算的结果上。它是 [`@deepseek-ai/dsh-bash-sandbox`](../bash-sandbox/) 的 pwsh 孪生，按 [pwsh 执行器与工具决策](../../../.agents/notes/implemented/feature/2026-08-01-pwsh-tool-and-executor.md) 逐调用镜像——隔离实体本身是平台无关的：Windows 上沙盒 seam 解析到 ACL 受限令牌 runner 链（[`@deepseek-ai/dsh-sandbox-windows-acl`](../../sandbox/sandbox-windows-acl/)），Linux/macOS 上解析到 bwrap/Landlock/Seatbelt。

执行器继承 [`@deepseek-ai/dsh-pwsh-local`](../pwsh-local/) 的进程机制，并消费其 argv 级 seam（`argv()` / `runArgv()` / `startArgv()` / `onProcessDone()`）把精确的 pwsh 调用经 provider 包装。沙盒策略（模式 + 工作区根目录）不是本包的配置：每次调用由 `ctx.sandboxPolicy` 随行（工具层传调用会话解析后的策略；直接调用回退到部署策略）。

## 行为

- `danger-full-access`：命令经本地执行器原样运行；结果携带 `sandbox: { mode, denied: false }`。
- 受限模式（`read-only`、`workspace-write`）：pwsh argv 由 `ctx.sandbox.confine()` 包装；runner 启动失败按 fail-closed 抛 `SANDBOX_UNAVAILABLE`（前台抛错、后台记 `runnerFailed` 事实），被拒绝的写按所选后端的 `denialSignatures` 分类为 `sandbox.denied`。

## 模型体验

### 隔离生效，拒绝以命令失败呈现

#### 模型看到什么

受限命令自身的 stderr（Windows ACL runner 下如 `Access to the path '...' is denied.`）；工具层把分类后的拒绝转成标准权限拒绝面，与 bash 工具完全一致。

#### Token 影响

除命令 stderr 与工具层标准拒绝面外，无额外模型可见文本。

#### KV Cache 影响

无直接影响；拒绝呈现面属于工具层。

## 已知限制与后续工作

- **Windows 上读不受限**（ACL runner 只限写）；读边界文档在 `@deepseek-ai/dsh-sandbox-windows-acl`。
- **Windows workspace-write 的临时权限按每个活跃的会话/工作区对私有**；无 agent（智能体）的调用每次都获得一个新的私有目录。环境临时根目录绝不会被授权，runner 会在 spawn 前将 TMP/TEMP 重写为该私有目录。
- **Windows read-only 不授予任何显式可写根目录，但仍为部分强制执行**，因为受限令牌必须保留 Everyone。DACL 向 Everyone 授予写访问的对象——包括以兼容方式打开的 NUL 设备——仍构成环境权限来源；PowerShell 的 `> $null` 重定向仍可工作，且不会打开 NUL。
