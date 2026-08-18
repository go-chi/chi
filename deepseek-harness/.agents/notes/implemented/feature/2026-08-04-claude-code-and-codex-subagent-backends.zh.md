# Agent Note: Claude Code 与 Codex subagent 后端

Status: implemented

[English](2026-08-04-claude-code-and-codex-subagent-backends.md) | 中文

## 问题

命名的 [`ctx.subagents`](2026-06-21-subagent-capability-seam.md) 注册表让父 agent（智能体）无需了解子 agent 的运行方式即可委派工作，但 harness 需要通往真实 Codex 与 Claude Code 产品的第一方路径。每条路径都必须向产品交付一项自包含任务，让它在父会话的工作区中执行，返回最终回答或明确的失败或取消结果，并且不留下任何受管的产品进程。

产品集成不得成为任务文本、cwd、取消、结果结算或进程树的第二责任方。因此，所需证据要区分三个事实：无密钥真实产品测试证明官方集成、原生身份验证形态、确定性答案与资源清理；Loader 组合测试证明公开包和文档所示的工具配置无需启动产品即可加载；带密钥 e2e 证明生产提供方与真实产品能够从真实 DeepSeek 服务取得唯一答案。直接发起模型 HTTP 请求或使用产品替身无法取代上述任一产品运行层级；手工挂载插件无法取代 Loader 层级。

## 决策

harness 交付两个同级的一次性提供方包：`codex` 与 `claude-code`。本说明负责它们的产品协议、结果映射和进程生命周期；[生产安装排除决策](../simplification/2026-08-12-production-dsh-excludes-product-subagent-providers.md)负责显式 Profile 安装与 host plane（宿主平面）放置，[产品一次性后台任务决策](2026-08-12-product-subagent-one-shot-background-tasks.md)负责模型可见的调度选择。加载任一提供方都不会启动产品进程，而且每个工具只接受独立文本任务；产品选择仍属于部署配置。

这两个提供方都报告 `inheritsParentContext: false`，不声明任何可选的启动能力，并传递父会话 cwd，但不会复制父级对话。文档所示的工具使用 `backgroundMode: 'one-shot'` 与 `maxDepth: 'provider-managed'`：消费方默认在前台收集结果，也可把同一次运行放入通用 Job 运行时，而递归策略仍由进程外产品负责。每次调用都会创建一个全新的产品进程和一次不可续接的产品对话。`ctx.subagents` 负责具名请求解析与成对生命周期事件；`dsh-tool-subagent` 负责模型可见的调度以及前台与 Job 适配；`ctx.jobs` 和 `dsh-tool-jobs` 负责 Job id、状态、输出、控制、通知与父级 owner 取消；各产品提供方负责原生结果映射，`dsh-subprocess` 则负责凭证清洗、进程树终止以及整棵进程树的退出观测。

```text
fixed tool -> dsh-tool-subagent -> ctx.subagents -> product provider -> product process
  foreground <- final product outcome
  background -> ctx.jobs / dsh-tool-jobs -> Job id / state / notice / controls
  both -> provider disposal -> dsh-subprocess -> whole-tree exit
```

### 归属与生命周期

| 层级 | 责任方 | 职责 | 可观察结果 |
| --- | --- | --- | --- |
| 委派生命周期 | `ctx.subagents` | 解析具名提供方请求，并为已发布的 `SubagentRun` 配对生命周期事件 | 不受支持的上下文或格式错误的输入会在发布运行前报错；启动与终态事件保持成对 |
| 调度与适配 | `dsh-tool-subagent` | 解释 `run_in_background`，选择前台收集或 one-shot Job 登记，并映射共享停止原因 | 前台返回产品结果；后台在登记完成后返回 Job id |
| Job 状态与控制 | `ctx.jobs` 与 `dsh-tool-jobs` | 负责 Job 状态、输出、取消、owner 清理、完成通知与面向模型的控制工具 | 准确父级可以收集、列出或停止后台工作，并收到完成通知 |
| 原生运行与清理 | 产品提供方与 `dsh-subprocess` | 产生一个原生结果、关闭产品协议、请求尽力而为的原生取消，并证明进程树退出 | 前台返回与 Job 结算都会等待幂等资源释放和整棵进程树退出 |

## Codex 提供方

`@deepseek-ai/dsh-subagent-codex` 注册固定的 `codex` 提供方，并启动 `codex app-server --stdio`，该命令从 `PATH` 解析。其公开配置仅包含显式的 `env` 覆盖项和须为正有限值的 `disposeGraceMs`，且后者不得大于仓库共享的 `MAX_TIMER_DELAY_MS`。安装、登录、`CODEX_HOME`、模型选择、基础 URL、沙箱、审批策略和产品会话设置仍由 Codex 原生机制或部署环境负责。

发布前，提供方会验证非空的纯文本任务，在父级工作区中启动受管的 app-server，完成 `initialize` → `initialized` 握手，并创建一个 `ephemeral: true` 线程。已发布的运行只拥有一次 `turn/start`；其线程 ID 与轮次 ID 保持私有，绝不会持久化到父会话。

`turn/completed` 是权威的远端终止事实。以最后一条带有 `phase: "final_answer"` 的 `agentMessage` 为准，且选中的消息必须包含非空白文本。若产品没有发出明确的最终阶段，则以最后一条 `phase: null` 的消息作为兼容性回退，该消息也必须包含非空白文本；过程说明绝不会取代上述任一答案。带有 `error.codexErrorInfo: "contextWindowExceeded"` 的失败轮次会成为 `max-tokens`。轮次完成却没有答案、其他任何远端失败或中断轮次、已识别的 app-server 帧中必需字段格式错误、协议关闭、进程提前退出或未知的服务器请求，都会产生 `error`；本版本没有原生的拒绝终止状态，因此不会产生 `refusal`。本地取消在竞态中胜出并保持为 `aborted`。

对于命令与文件审批，无人值守的协议连接会从请求给出的决策选项中选择一项不予批准的决策，并优先选择 `cancel`；稳定的 0.147.0 请求形态没有决策选项列表，因此回退到 `decline`。它不授予该轮次请求的任何权限，不向用户输入请求提供任何答案，并拒绝 MCP elicitation。若请求在无人值守模式下没有合法响应，或是未知服务器请求，此次运行就会失败，而不会等待本提供方没有提供的用户界面。

若启动在发布前失败，提供方会关闭协议连接、终止已获取的进程树并等待其退出，然后拒绝 `start()`。对已发布的运行执行资源释放时，提供方会尽力中断已知轮次、关闭协议连接、结束标准输入、调用共享的逐级终止机制，并等待整棵进程树退出。结果失败与清理失败仍可彼此独立地观察。

Codex 0.147.0 使用 Responses 协议，而 DeepSeek 的公开 OpenAI 兼容端点使用 Chat Completions。因此，带密钥 Codex e2e 会采用一个仅限回环、仅供测试内部使用的桥接层来处理一次不使用工具的随机数请求：真实 Codex 将 Responses 发送到桥接层，桥接层把收到的 Bearer 凭据与提取出的任务转发到固定的 DeepSeek 官方端点，再将真实文本包装进最小化的 Responses SSE（Server-Sent Events）生命周期。该桥接层既不是生产代理，也不能作为 Codex 原生连接 DeepSeek Chat Completions 的证据。

## Claude Code 提供方

`@deepseek-ai/dsh-subagent-claude-code` 注册固定的 `claude-code` 提供方，并调用 `@anthropic-ai/claude-agent-sdk@0.3.220`。每次运行前，提供方经宿主 subprocess 执行世界解析固定名称 `claude`，并把准确路径作为 `pathToClaudeCodeExecutable` 交给 SDK；SDK 因此使用启动 DSH 的原生产品，而不是选择自身的 platform `optionalDependency`。Windows `.cmd` 或 `.bat` 路径会作为带引号、仅供本次 spawn 使用的环境展开值穿过 `cmd.exe /v:off`，因此路径中的百分号、与号和感叹号仍只是数据，且无需改变共享子进程约定。提供方使用官方 `query()` 入口点，并将 SDK 的 `spawnClaudeCodeProcess` 参数、cwd、环境和转发的信号交给 `dsh-subprocess`；其私有 `SpawnedProcess` 适配器只公开 SDK 所需的流、事件、终止和退出事实。

公开配置包含与 Codex 兄弟提供方相同、由部署方负责的两个值：显式的 `env` 覆盖项，以及须为正有限值且不得大于仓库共享 `MAX_TIMER_DELAY_MS` 的 `disposeGraceMs`。每次运行都会创建自己的 `AbortController`，设置 `persistSession: false` 并禁用 `AskUserQuestion`。提供方故意省略 `settingSources`，因此 SDK 会相对于父会话 cwd 读取宿主机常规的用户、项目和本地 Claude 设置。它既不复制也不过滤这些设置，也不会创建或修改登录状态。提供方不设置 `canUseTool`、elicitation 或对话回调，因此无人值守交互会经 SDK 失败，而不会等待本提供方不负责的用户界面。

只有在 SDK `Query` 与受管的活动 CLI 句柄都已存在后，提供方才会发布运行。它会消费完整的 SDK 流；只有 `result` 消息具有 `subtype: "success"`、`is_error: false` 和非空白 `result`，且迭代器随后正常结束时，运行才会完成。所有 SDK 错误子类型、标记为错误的成功消息、结果缺失、迭代器失败、协议失败或进程失败都会成为 `error`。SDK 的轮次、预算和结构化输出限制不表示 token 窗口耗尽，而且 SDK 没有原生的拒绝终止状态，因此本提供方不会产生 `max-tokens` 或 `refusal`。本地取消会胜出并成为 `aborted`。

启动回滚和已发布运行的资源释放都会关闭 SDK query、中止该次运行的控制器、调用共享的进程树终止机制，并等待整棵进程树退出。`Query.close()` 表达优雅的协议关闭意图，但不能取代子进程责任方的退出证明。Query 关闭失败、进程失败和清理失败仍可彼此独立地观察。

带密钥 Claude Code e2e 直接使用官方 DeepSeek Claude Code 约定：仅在运行时提供的 DeepSeek 密钥会映射为 `ANTHROPIC_AUTH_TOKEN`，固定的官方基础 URL 会追加 `/anthropic`，主模型与 subagent 模型变量会选择文档所示的 DeepSeek 模型。该测试会启动生产提供方与真实 SDK 和 CLI，要求一个随机数作为完整答案，不会把任何凭据持久化到设置中，并等待所有受管句柄退出。

## 分发与证据

每个产品都负责覆盖所有分支的包测试、一项必跑的无密钥真实产品测试、一项 Loader 组合 e2e 和一项带密钥 DeepSeek e2e。无密钥产品层级使用被测的确切官方发行版、非空的伪产品密钥、隔离的临时工作区与产品主目录，以及能返回固定答案的回环模型。产品请求缺失、身份验证错误、任务文本被改动、答案不完全一致、真实产品被跳过或受管句柄仍存活，都会使这项必跑测试失败。Loader 层级会启动 README 所示的显式 Profile 配置，在同一个上下文中验证两个固定一次性工具会与通用 Job 控制工具一起公开可选后台调度，而且不会启动任何产品进程。带密钥层级会使用仅在运行时提供的密钥启动同一生产提供方与真实产品，要求从固定的 DeepSeek 官方服务取得唯一随机数，并再次证明完全停稳；仅当本地操作者未提供密钥时才会自行跳过，而受信任的 CI 会预检该 secret。

Codex 证据锁定 `@openai/codex@0.147.0` 与 `codex-cli 0.147.0`。其真实产品测试会观测确切的 Bearer 密钥、原始任务、逐字节完全一致的最终回答、不会产生文件副作用的无人值守命令拒绝、本地取消以及整棵进程树退出。生产环境仍提供 `codex`，并通过 `PATH` 解析。

带密钥 Codex e2e 会注册生产提供方，启动同样的真实 app-server，并通过上述测试专用桥接层请求一个随机数。该测试固定外部端点与模型，不存储任何凭据或请求载荷，要求上游恰好完成一次响应，将去除首尾空白后的产品答案与该随机数逐字节比较，并等待所有受管句柄退出。

Claude Code 证据锁定 Agent SDK 0.3.220，并使用 SDK 按平台分发的 Claude Code 2.1.220 CLI 作为确定性兼容性 fixture（测试前置数据），且该 fixture 经生产环境所用的同一原生可执行文件解析路径运行。其真实产品测试会观测确切的 `x-api-key`、原始任务、逐字节完全一致的最终回答、继承的临时宿主设置标记、进程失败、本地取消、整棵进程树退出，以及位于同时含百分号、与号和感叹号路径中的真实 Windows batch shim。这项证据证明官方 SDK/CLI 集成路径，而不证明它与每个独立安装的产品版本兼容。Loader 与随附 profile 证据会按名称解析两个产品包且不启动产品，provider 测试则证明 SDK 收到由宿主 `PATH` 解析出的可执行文件。

带密钥 Claude Code e2e 仅在提供方的内存环境中映射密钥与固定的官方端点，把模型变量设为文档所示的 `deepseek-v4-pro[1m]` 与 `deepseek-v4-flash`，并实际经过生产提供方、官方 SDK 与真实 CLI。它将去除首尾空白后的结果与一个随机数比较，并证明整棵进程树退出，且测试不会直接调用 Messages API。

项目所有者的分发授权范围限定为官方 `@anthropic-ai/claude-agent-sdk` 身份，以及每个 SDK 版本通过 `optionalDependencies` 声明的官方 Claude Code CLI 与平台载荷。[`THIRD_PARTY_NOTICES.md`](../../../../THIRD_PARTY_NOTICES.md) 会推导并披露当前载荷集合，但不会将其声明条款重新归类为宽松条款。版本、许可证字段和载荷集合发生变化时，仍须经过常规的依赖、锁文件、兼容性、条款和声明评审；无关的非宽松运行时包继续以默认拒绝方式失败。

## 曾考虑的替代方案

**直接模型 HTTP、`codex exec` 或手写的 Claude CLI 协议。** 这些路径会绕过产品的官方可扩展集成接口，无法证明原生配置、工具、审批、结果语义或资源清理。每个提供方都改用相应的官方产品集成。

**共享产品进程辅助包。** 现有 subagent 与子进程 seam 已负责围绕任务、结果、环境和进程树的全部共享职责。新辅助包无法删除任一私有产品适配器，只会造成责任重复，因此每个适配器都会直接调用现有 seam。

**面向模型的产品选择器。** 产品可用性和身份验证属于部署事实。两个固定工具使各自的 schema 与提供方绑定保持明确，也避免在通用服务中添加动态选择状态。

**以产品替身作为强制证据。** 替身可以穷尽覆盖私有协议分支，但无法证明包导出、官方发行版、身份验证或真实进程行为。强制证据会驱动每个官方产品连接回环模型 fixture。

**由插件管理登录、产品主目录、模型、设置或权限。** 这些选择会在每个产品的原生配置之外建立另一套权威来源，并将一次性提供方扩张为账户管理功能。提供方只公开显式环境覆盖项和清理宽限期；无人值守交互会以默认拒绝方式失败。

**续接、进度、产品原生后台状态和共享父级上下文。** 提供方载荷仍是一项自包含任务的一个最终回答。通用 Job 层可以额外提供 id、状态、通知、收集与取消结果，但产品会话、恢复、后续交互、中间消息、父级 transcript（文本记录）传递、结构化输出和提供方专属后台状态都需要独立的用户约定，当前实现不会预先构建这些功能。

## 后果

用户通过官方产品集成支持的两个稳定一次性工具进行委派。显式 Profile 安装与 host plane 提供方放置由[生产安装排除决策](../simplification/2026-08-12-production-dsh-excludes-product-subagent-providers.md)负责；按 Preset 暴露工具以及默认前台且可选通用 Job 的调度方式由[产品一次性后台任务决策](2026-08-12-product-subagent-one-shot-background-tasks.md)负责。本说明规定的提供方生命周期会保留原生设置与行为，而共享服务继续独占作业结算与进程树完全停稳的责任。

每次委派都要承担新建产品进程和独立模型上下文的开销。到达父级的产品载荷仍只有最终文本；后台调度还会额外公开通用 Job id、状态、完成通知以及收集或取消结果。产品原生配置使行为取决于部署环境中安装的产品、账户状态和工作区设置。带密钥 e2e 运行还会消耗外部 API 配额，并依赖 DeepSeek 官方端点；对协议、失败、取消与审批的确定性覆盖仍由无密钥层级承担。提供方不会恢复会话、以流式方式传送进度、接受新的人工交互、回滚工具或文件副作用，也不会施加按实际经过时间触发的超时。

兼容性由包级单元测试覆盖率、无密钥真实产品回环测试、带密钥 DeepSeek 随机数测试、公开 Loader 组合、已构建包与 NodeNext 消费方检查、生成的文档与声明以及仓库 CI 矩阵共同锁定。更改受支持的产品基线或 DeepSeek 端点／模型基线时必须刷新这些事实；生产环境不会另行执行运行时版本探测。
