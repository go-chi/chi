# @deepseek-ai/dsh-lsp-stdio

[English](README.md) | 中文

`ctx.lsp` 的**通用 stdio 语言服务器后端**。一个插件实例接受一张命名服务器表，并逐配置项注册一个隔离的提供方。它通过 `ctx.fs` 读取，并通过 `ctx.subprocess` 启动，因此服务器与源文件始终位于已挂载的执行世界中。这是通用主机，而不是语言服务器目录或安装器：部署需要显式配置命令与映射，预设应放在 `cordis.yml` overlay 中。

Namespace 插件（`name`／`inject`／`Config`／`apply`，无默认导出）。

## 功能

- 在注册前解析每项服务器局部设置；无效映射或注册冲突会回滚较早配置项，因此加载失败不会留下提供方路由。
- 每个 `(server id, canonical workspace target)` 惰性 single-flight 一个服务器进程。服务器仍存活时返回的错误不会触发重试；如果选中的池化传输在只读查询之前或期间发生故障，提供方会等待其 dispose（资源释放）完成，并在新进程上重试该查询一次。
- 每次查询都使用兼容性优先的**临时打开**序列：通过 `ctx.fs` 流式读取源文件，同时解析并限制其字节数；随后执行 `textDocument/didOpen`（版本 1、完整文本）、所请求操作，再执行位于 `finally` 中的 `textDocument/didClose`。写入 `didOpen` 失败或取消时，会在池复用该实例前将其终止。文档在每次调用后关闭，因此第一版不需要 `didChange`、内容 cache 或文档 LRU。
- 通过一条逐 Workspace、可中止的队列，串行执行每个源读取／打开／查询／关闭生命周期，因此排队调用只会在轮到自身时读取当前源；不同 Workspace 并行运行。提供方 dispose 会中止文件系统与协议工作，等待尚未进入队列的 Workspace 查找完成，随后排空每条队列与每个服务器。
- 协议 shutdown 失败后，经由子进程 seam 终止服务器后代树（POSIX 进程组信号；Windows `taskkill /T /F`）。树终止的投递结果与所有进程组信号一样被就地吸收，不向外抛出（投递与服务器退出存在竞态）；服务器是否完全停稳，由句柄的进程树存活等待确认，而非由这次终止自身的结果确认。
- 通过 `ctx.subprocess` 解析服务器可执行文件、cwd、进程和协议流；`initialize.processId` 为 `null`，因为另一台机器或 PID namespace 不得监视 harness 进程。
- 使用 `ctx.fs` 提供的规范化包含关系、文件 URI 与流式文本验证，但不发出 `fs/observed`：只有 LSP 结果对模型可见，因此查询不满足先读后写策略。

## 配置

`servers` 记录的 key 是在 `ctx.lsp` 上保留的稳定提供方 id；每个值具有以下形状：

| 服务器 key | 默认值 | 含义 |
|---|---|---|
| `command` | （必填） | 要 spawn 的可执行文件：绝对路径，或在加载时从子进程 PATH 解析。不使用 shell 启动。 |
| `args` | `[]` | 传给可执行文件的参数。 |
| `env` | `{}` | 合并到已清理 credential 的环境之上的额外 env（匹配 `KEY`／`PASSWORD`／`SECRET`／`TOKEN` 的变量不会转发）；显式 `DSH_*` 条目在 seam 清除环境中同名值之后合并。 |
| `extensionToLanguage` | （必填） | 小写、以点开头的扩展名 → LSP language id（例如 `{ '.ts': 'typescript' }`）。 |
| `initializationOptions` | `null` | 转发给服务器的静态 `initialize` 选项。 |
| `configuration` | `null` | 每个 `workspace/configuration` 配置项的静态答案。 |
| `maxMessageBytes` | `16000000` | 从服务器接受的单条 framed 消息最大大小。 |
| `maxStderrBytes` | `1000000` | 为诊断保留的 stderr 尾部最大大小。 |
| `maxDocumentBytes` | `4000000` | 该主机可打开的源文件大小上限。 |
| `shutdownTimeoutMs` | `5000` | 升级前用于优雅 `shutdown`／`exit` 的预算。 |
| `killGraceMs` | `2000` | 请求取消及 SIGTERM→SIGKILL 升级的宽限期。 |

`servers` 必须至少包含一个配置项，每个 id 都必须非空。定时器预算必须是正整数，且不超过 Node 的 `2_147_483_647` ms 定时器上限。所有可执行文件都会在清理 credential 后于加载时解析；后面的坏配置项会阻止所有提供方注册。进程在第一次匹配查询时惰性启动。

## 协议行为

初始化会声明 `general.positionEncodings: ['utf-16']`、`workspace: { workspaceFolders: true, configuration: true }`、`textDocument.hover.contentFormat: ['markdown', 'plaintext']`，以及定义与实现使用的 `linkSupport: true`，且不进行动态注册。服务器返回的能力具有最终决定权：不受支持的操作，或缺少临时打开／关闭的同步方式，会使查询失败。服务器省略 `positionEncoding` 时默认为 `utf-16`；其他值都属于协议错误。客户端通过静态配置回答 `workspace/configuration`，接受生命周期记账请求，并拒绝 `workspace/applyEdit`：它绝不应用编辑或运行命令。导航直接映射 `Location`，并从 `LocationLink` 的 `targetUri` + `targetSelectionRange` 映射；hover 规范化会取得有效的 `MarkupContent.value`，保留 string `MarkedString`，把带 language tag 的值渲染为围栏代码，并用一个空行连接数组。缺失结果、格式错误的范围或位置，以及格式错误的 hover 编码，都会以结构化 `LSP_MALFORMED_RESPONSE` 错误的形式失败。

## 安全边界

提供方信任其配置的服务器，不提供任何沙箱隔离。它把规范化身份、包含关系、普通文件流式读取、UTF-8 验证和文件 URI 编码委托给 `ctx.fs`；并在服务器启动前拒绝缺失、非普通文件、非 UTF-8、过大，或规范化后位于 Workspace 外部的查询源。包含关系在打开流之前评估，不承诺在并发路径替换期间保持稳定句柄身份。结果位置可以在外部，但外部路径不能成为查询源。部署必须挂载描述同一执行世界的文件系统与进程管理提供方；分裂世界组合无效。

## 模型体验

通过 `dsh-tool-lsp` 间接影响；该工具呈现此提供方的规范化结果，该主机自身不贡献提示词或 schema。

#### KV Cache 影响

不会直接失效；请求前缀变更由 `dsh-tool-lsp` 负责。

## 已知限制与暂缓事项

- **不提供隔离策略**：本包（package）信任所配置的服务器，不对其进程实施沙箱；受限部署必须提供适当的进程／文件系统提供方，或使用同一执行世界的沙箱包装层。
- **临时打开兼容性下限**：同步能力省略打开／关闭（或声明 `None`）的服务器不受支持，即使关闭文档查询能够工作；固定的 TypeScript e2e 只建立一项兼容性下限，不代表跨语言承诺。
- **逐服务器／Workspace 串行化延迟**：共享同一个服务器与 Workspace 的并行 agent（智能体）会在一个进程后排队；长生命周期 Workspace 进程会占用内存直到 dispose。
- **被强制杀死的 harness 会遗留语言服务器**：`initialize.processId: null` 取消了服务器侧的客户端 PID 监视，因此服务器只能由服务的优雅 dispose 清理；被 SIGKILL 的 harness 会让它们继续运行，直到自行退出。
