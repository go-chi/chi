# @deepseek-ai/dsh-bash-sandbox

[English](README.md) | 中文

这是使用沙箱能力的 [`@deepseek-ai/dsh-shell`](../shell/) 执行器 seam 的 Service Provider。加载它时，应**用它替代** `@deepseek-ai/dsh-bash-local`，并同时加载 [`ctx.sandbox`](../../sandbox/sandbox/) 提供方（例如 [`@deepseek-ai/dsh-sandbox-local`](../../sandbox/sandbox-local/)）及 [`ctx.sandboxPolicy`](../../sandbox/sandbox-policy/)；默认模式和工作区根目录由后者负责，并与受沙箱约束的文件系统共享这些设置。无需使用替代工具插件；`dsh-tool-bash` 会检测执行器的 `sandboxMode` 能力并添加升权字段。

包根目录导出默认与具名的 `SandboxBashExecutor` 插件及其 `Config`；结果分类 helper 保留在内部。

每条命令的限制方式都是：把本执行器即将 spawn 的精确 `['bash', '-c', command]` argv 交给提供方，并直接 spawn 返回的 argv。使用随附的原生 runner 时，内层 Bash 保留 shell 语义，并且只在 runner 建立约束后才求值 `BASH_ENV`。由哪种平台 runner 执行限制，以及是否有 runner 可用，属于提供方职责；若无可用 runner，则按失败关闭原则拒绝执行并返回结构化 `SANDBOX_UNAVAILABLE` 错误，绝不能静默地无约束运行。本包只负责 bash 侧。

| 模式 | 文件影响 |
|---|---|
| `read-only`（默认） | 任何位置都不可写（在 `/dev` 中只有 `/dev/null` 节点可写，因此 `>/dev/null` 仍可正常工作） |
| `workspace-write` | 只能写入 `workspaceRoot` + `/tmp`（在 bwrap 下为临时目录，在 Landlock 下为宿主 `/tmp`，在 Seatbelt 下为 `/private/tmp` 加每用户临时目录） |
| `danger-full-access` | 不作限制；绝不咨询提供方。前台结果携带 `sandbox: { mode, denied: false }`；后台进程句柄不携带沙箱事实。 |

语义：

- **拒绝是结果事实。** 如果一次失败运行的 stderr 包含所选后端自身的拒绝方言，即提供方在每次包装时加上的特征（bwrap 下的 EROFS 文本、Landlock 下的 EACCES、Seatbelt 下的 EPERM），则结果报告 `ShellRunResult.sandbox.denied: true`（从已收集的 stderr 尾部进行保守分类）。每次受限制运行还会携带执行时模式（`result.sandbox.mode`）与提供方强制执行完整性（`result.sandbox.enforcement`：`full`，或在较旧 Landlock ABI 上为 `partial`）。
- **Runner 路径或 syscall 必须匹配。** 进程启动前，调用方拥有的 workdir 必须经独立验证可用，Node 必须报告 `ENOENT` 或 `EACCES`，并且错误必须符合以下一种形态：`error.path` 等于提供方返回的 `argv[0]`，同时 `syscall` 为 `'spawn'` 或精确的 `'spawn <runner>'`；或者 `error.path` 不存在，同时 `syscall` 为精确的 `'spawn <runner>'`。这样可以识别缺失的 runner、不可执行的 runner，或 shebang 解释器不可用的可执行脚本。没有精确错误路径的裸 `syscall: 'spawn'`、任何其他错误码、无效或不可用的 workdir、资源失败、无关 syscall 或无结构拒绝仍保留本地执行器的命令启动失败语义。前台执行会抛出 `SANDBOX_UNAVAILABLE` 并附带原始 spawn 错误详情，异步后台结算则会标记 `runnerFailed: true` 和 `denied: false`。如果 `SubprocessRuntime` 同步抛出同样能指明 runner 的 `ENOENT`／`EACCES` 形态，后台启动会抛出 `SANDBOX_UNAVAILABLE`；其他同步错误原样传播。进程启动后，先按整行精确匹配排除信息性行，随后规则的可选退出码检查和余下 stderr 中的一行致命诊断必须同时匹配。匹配结果优先于拒绝；前台执行会抛出 `SANDBOX_UNAVAILABLE` 并附带匹配到的致命行，已结算的后台进程则会标记 `process.sandbox.runnerFailed`，Bash 结果生成方通过通用 `job_output` 渲染它。无论走哪条路径，受限制的后台句柄都会保留自身的模式／强制执行事实，并释放每进程计数。
- **部署回退，每次调用策略。** [`ctx.sandboxPolicy`](../../sandbox/sandbox-policy/) 为每次工具调用解析完整的 `SandboxExecutionPolicy`：调用会话提供自身的模式覆盖与不可变 cwd 根目录，部署配置则为无 agent（智能体）调用提供回退。已批准的升权只更改该策略的模式，会话根目录仍然附着其上。`resolve()` 把策略带入 spec，因此来自不同项目的重叠命令会在各自的根目录与模式下运行、分类和报告。能力事实 `ctx.shell.sandboxMode` 报告已配置的默认值，因此工具层只在装载该执行器时才公布升权；静态 bash 工具描述则单独负责拒绝与升权引导。
- **只限制文件影响。** 设计上不限制网络与进程可见性：模式词汇不会声称覆盖后端未强制执行的范围。
- 进程机制（spawn、进程组终止、输出收集／spill、后台句柄、凭证清理）继承自 [`dsh-bash-local`](../bash-local/)；runner 选择位于 [`dsh-sandbox-local`](../../sandbox/sandbox-local/)。

该 seam 只报告拒绝：拒绝是一项结果事实，本执行器绝不自行协商权限。批准问题位于工具层（`dsh-tool-bash`），由它设置本包所遵守的模式覆盖值。

```yaml
- id: sandbox
  name: '@deepseek-ai/dsh-sandbox-local'
- id: sandbox-policy
  name: '@deepseek-ai/dsh-sandbox-policy'
  config:
    mode: read-only
    workspaceRoot: !!js process.cwd() # fallback for calls without a session cwd
- id: bash
  name: '@deepseek-ai/dsh-bash-sandbox'
```

## 模型体验

### 间接的 Bash 工具 schema

#### 模型看到的内容

基线是生成的 [`dsh-tool-bash` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-bash)。通过公布表明启用隔离的 `sandboxMode` 能力，此后端会为 `bash` 增加 `sandbox_permissions`，其 enum 为 `workspace-write` | `danger-full-access`，并增加 `justification`。策略归属方会另行贡献当前且不区分具体能力的 `sandbox:policy` 上下文。

#### Token 影响

在 `bash` 可见的请求上，schema 固定增加少量内容，另有一条由 `dsh-sandbox-policy` 负责的当前策略子句。

#### KV Cache 影响

常驻策略变化会在保留的历史之后追加一份由归属方渲染的完整上下文快照，并使既有 system/history 前缀保持逐字节不变。更改执行器能力会改变 `bash` schema。

### 间接的 Bash 工具结果

#### 模型看到的内容

在普通有界输出之后，被拒绝的调用会精确追加 `[sandbox: file access denied under <mode> mode]`。当升权可用时，接下来精确追加 `[sandbox: escalation available — retry this exact command once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]`。已结算的后台 runner 失败则追加 `[sandbox: the sandbox runner itself failed under <mode> mode — the command did not run; this is a sandbox problem, not a command failure]`。

#### Token 影响

除普通输出外，正常允许的运行不会增加 token。拒绝或失败会增加上述有条件标记，并保留到上下文压缩（context compaction）。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### 间接的 Bash 工具错误

#### 模型看到的内容

如果没有 runner 能强制执行受限模式，前台调用会传播 [`SANDBOX_UNAVAILABLE` 错误](../../sandbox/sandbox/README.md#confinement-error-indirectly)；该错误由 `dsh-sandbox` 定义。判定为 runner 失败的 spawn 错误会以原始 spawn 错误作为详细信息；如果拒绝没有通过 `ENOENT`／`EACCES` 的 `path` 或 `syscall` 证据指明 `argv[0]`，它仍是普通的命令启动错误。已结算的 runner 失败则以匹配到的致命 stderr 行作为详细信息，并保留原始 stderr 收集结果。如果追加了 `Runner failure: <detail>`，它就是权威诊断；前面的后端安装文本只是通用的 `SANDBOX_UNAVAILABLE` 前缀。

#### Token 影响

该次调用会在相应条件下显示错误文本，该文本会保留在历史记录中直到上下文压缩。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **限制只覆盖文件影响**：网络访问与进程可见性不变，因此这些模式不是通用安全沙箱。
- **拒绝从失败命令的 stderr 推断**：后端特征使该推断可跨平台使用，但包含相同后端特征的应用错误可能被分类为拒绝，也可能遗漏未出现在保留尾部中的拒绝。
- **异步观测到的后台 runner 失败没有即时错误通道**：它记录在已结算进程上，并在调用方使用 `job_output` 读取通用任务时呈现；`SubprocessRuntime` 同步抛出的错误包含 runner 路径时，则会使 `start()` 立即失败。
- **`danger-full-access` 有意绕过 `ctx.sandbox`**：它是显式无约束模式，不是更宽的沙箱 profile。
