# @deepseek-ai/dsh-tool-fs-search

[English](README.md) | 中文

**面向模型的文件系统发现工具**（`glob`、`grep`）由 **打包的 ripgrep 二进制**（`@vscode/ripgrep`）支持，而不是由 `ctx.fs` 提供方方法或系统 `rg` 安装支持。注册是无条件的：二进制随 NPM 依赖一起交付，因此没有加载期可用性探针。每次调用都通过 `ctx.subprocess` seam 以固定 argv 向量 spawn 该二进制（前缀 `--no-config`，使宿主的 `RIPGREP_CONFIG_PATH` 无法向不受约束的 spawn 注入 `--pre` 预处理器；模型控制的值是普通 argv 元素——不存在 shell 层，因此不涉及 shell 引号处理），解析原始 `rg` 输出，并返回相对于工作目录的规范值。本包注入 `tools`、`systemPrompt` 和 `subprocess`，有意**不**注入 `fs`；格式化结果 spill 为可选功能，因此机会性读取 `ctx.spillStore`，调用方式为 `ctx.get()`。

```ts ignore-check
// A deployment chooses how over-cap glob pages are selected.
await ctx.plugin(LocalSubprocessRuntime)                     // @deepseek-ai/dsh-subprocess-local
await ctx.plugin(ToolFsSearch, { sampleOverCapGlobResults: false })
// Optional: a spill backend makes capped results fully recoverable.
await ctx.plugin(LocalSpillStore)                           // @deepseek-ai/dsh-spill-local
```

采用 spawn 支持的原因：本地工作区发现天然是由进程支持的 `rg` 工作流；如果把搜索放到 `ctx.fs` 上，就会迫使每个文件系统后端扩展搜索 API。subprocess seam 负责 spawn 执行、进程树终止、环境清理和有界输出捕获；本包负责 schema、参数校验、argv 构造、解析、保留、格式化结果 spill 和超时声明。工具绝不暴露后台任务——只有在 `rg` 退出、被协作式超时终止、被中止或失败后，调用才会返回。

## 部署要求：无需宿主 rg，但工作目录与文件系统需共置

二进制随包交付，覆盖所有受支持平台（macOS/Linux/Windows，x64/arm64），因此无需宿主 `rg` 安装，工具在每个部署上都注册。返回路径会相对于解析后的工作目录显示（调用方 agent（智能体）有会话 cwd 时使用该 cwd，否则使用 `process.cwd()`）；只有该工作目录与文件系统根目录是同一工作区时，才能用 `read` 继续读取。这项共置要求不附带运行时跨服务校验；远程或虚拟文件系统搜索需等待共享工作区约定或特定提供方的搜索后端。

## 配置

`sampleOverCapGlobResults` 是必填项且没有回退值；部署必须显式选择超过上限时的排序约定。其余配置键是可选的搜索上限，默认值如下。

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `sampleOverCapGlobResults` | 无（必填） | `true` 会在顶层条目之间对超过上限的 `glob` 页面采样；`false` 保留按修改时间排序的前部。格式化 spill 成功时，两种模式都会在该产物中保留完整排序列表。 |
| `globMaxResults` | `100` | 一次 `glob` 调用内联展示的最大路径数（与 Claude Code 的 `GlobTool` 上限相同）。未超过上限的结果保持完整，并按修改时间排序。 |
| `grepMaxMatches` | `250` | 一次 `grep` 调用内联保留的最大平铺匹配数（与 Claude Code 的 `GrepTool` `head_limit` 相同）；后续匹配写入格式化 spill 产物。 |
| `grepMaxLineBytes` | `2000` | 每条匹配行预览的字节上限；截断会保留 UTF-8 边界，并标记为 `(line truncated)`。 |
| `rawOutputMaxBytes` | `20000000` | 搜索将解析的完整原始 `rg` stdout 上限（与 Claude Code 的 ripgrep 原始 buffer 相同）；更大的原始输出以 `SEARCH_RAW_OUTPUT_OVERFLOW` 失败。 |
| `timeoutMs` | `30000` | 附加到两个工具定义上的协作式工具调用预算，由 `@deepseek-ai/dsh-tool-call-timeout-policy` 通过 `exec.signal` 强制执行；subprocess seam 的终止升级提供硬终止。 |
| `graceMs` | `3000` | subprocess seam 在 `timeoutMs` 之外授予的终止升级宽限期须为正值；超过后搜索以 `SEARCH_ABORTED` 失败；该宽限期不得大于 [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md)。 |
| `stderrMaxBytes` | `65536` | `rg` stderr 的诊断尾部预算，经 subprocess seam 的 collect 形态捕获；lossy 读取只保留尾部（标记 `[stderr truncated]`）。 |

## 工具

| 工具 | 参数 | 行为 |
|---|---|---|
| `glob` | `pattern`、`path?` | 运行 `rg --files --glob <pattern> --sort=modified --no-ignore --hidden`，并排除 VCS 元数据（`.git`、`.svn`、`.hg`、`.bzr`、`.jj`、`.sl`）。`path` 是可选的**目录**搜索根；省略时使用解析后的工作目录。每行返回一个**文件**路径；`rg --files` 从不输出目录条目。pattern 保留 ripgrep 语义：不含 `/` 时匹配任意深度的基名，因此 `*` 匹配整棵树。完整结果保持按修改时间排序；超过上限时的呈现方式遵循 `sampleOverCapGlobResults`。 |
| `grep` | `pattern`、`path?`、`include?` | 按行解析 `rg --json`，避免按冒号拆分的歧义。`pattern` 是 ripgrep 正则表达式；`path` 是可选的**文件或目录**目标；`include` 是一个正向 glob 过滤器，前置拒绝逗号分隔列表或否定值（`!…`），但允许 `*.{ts,tsx}` 等花括号交替。返回按文件分组、形如 `Line N: <preview>` 的匹配。 |

常规预算不进入面向模型的 schema（没有 `head_limit`/`offset`/`case_insensitive`/输出模式）：模型需要周边上下文时，用 `read` 读取匹配文件；需要后续结果时，遵循返回的 spill locator 检索提示。

## 两类预算、两类产物

原始 `rg` stdout 与 stderr 是内部传输细节。每次搜索从 subprocess seam 请求 collect 模式预算——`rawOutputMaxBytes` 内的完整 stdout 与 `stderrMaxBytes` 的诊断尾部——两条流都不产生 spill 文件（工具从不读取原始 spill 路径）。如果 seam 仍报告 lossy stdout 读取，搜索会以 `SEARCH_RAW_OUTPUT_OVERFLOW` 失败，并要求模型缩小查询；lossy stderr 读取只把诊断摘录标记为 `[stderr truncated]`。成功的 `glob` 在 `{ root, paths }` 中保留所显示的搜索根及所有已取得路径；启用采样时，借助 `root`，Native 渲染器能以显式的相对或绝对搜索路径为根，按该根下的条目分组，而不是按其工作目录前缀分组。`grep` 保留所有已取得的 `{ path, lineNumber, line }`，并将其存入 `{ matches }`。内联条目和每行预览上限只应用于 Native 渲染器。直接接口调用的逻辑结果超过内联上限时，后置策略会尽力通过 `ctx.spillStore.saveText()` 保存完整格式化预览，并只把呈现替换为配置指定的页面与 locator。嵌套 Code 分派会跳过 spill，因为其完整规范值不会进入模型上下文。spill 缺失/失败时保留内联页面，并报告完整结果无法保存，绝不会成为 `isError`。

## 错误

搜索失败会携带由本包定义的 `SearchError`（`HarnessError` 子类），并以 `{ name, code }` 的形式呈现在 `isError` 结果上：`SEARCH_INVALID_PATTERN`（ripgrep 拒绝正则/glob）、`SEARCH_FAILED`（`rg` 启动失败、目标不可访问、信号终止、`--json` 输出格式错误）、`SEARCH_RAW_OUTPUT_OVERFLOW`（原始输出超过 `rawOutputMaxBytes`，或在请求 stdout 捕获预算后仍 lossy）和 `SEARCH_ABORTED`（协作式工具超时或调用方取消）。ripgrep 的退出语义由工具负责处理：退出 0 表示成功且有结果，退出 1 表示成功的空搜索（`No files found` / `No matches found`），只有其他退出值表示失败。模型参数错误（空白 pattern、列表值 `include`）仍是普通工具参数错误。

## 模型体验

### 系统提示词

#### 模型看到的内容

该插件注册作用域内的每个请求都包含下方独立注册的 glob 与 grep 指导。agent 作用域的工具限制可以隐藏任一 schema，而不移除其提示词段。

##### 启用 `sampleOverCapGlobResults: true` 时的 Glob 指导

```markdown
Use the glob tool — not shell find — to discover files by path pattern. A pattern with no "/" matches basenames at any depth, so "*" matches every file in the tree rather than its top level. Results are files only, never directories, and include hidden and ignored files: a result that fits comes back in modification-time order, while a larger one is sampled across top-level entries, so it spans the tree instead of one subtree.
```

##### 启用 `sampleOverCapGlobResults: false` 时的 Glob 指导

```markdown
Use the glob tool — not shell find — to discover files by path pattern. A pattern with no "/" matches basenames at any depth, so "*" matches every file in the tree rather than its top level. Results are files only, never directories, and include hidden and ignored files: a result that fits comes back in modification-time order, while a larger one keeps the modification-time-ordered head.
```

##### Grep 指导

```markdown
Use the grep tool — not shell grep or rg — to search file contents. Use read on a matched file when you need surrounding context.
```

#### Token 影响

工具注册期间每个请求有固定的指导成本；必填的采样选择决定采用哪一个 glob 变体。

#### KV Cache 影响

插件作用域、采样选择与指导文本不变时前缀稳定。激活、dispose（资源释放）或改变选择可能使该提示词段的复用失效。

### 工具 schema

#### 模型看到的内容

glob 描述声明了配置的超过上限排序方式。生成的 [`glob` 和 `grep` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-fs-search) 使用 `sampleOverCapGlobResults: true`；工具无条件注册。

#### Token 影响

工具可见时每个请求有固定的 schema 成本。

#### KV Cache 影响

工具可见性与定义不变时前缀稳定。注册生命周期或作用域限制可能从第一个改变的 schema token 起使复用失效。

### 结果与 spill 提示

#### 模型看到的内容

`glob` 每行返回一个路径；`grep` 在每个路径下分组展示 `Line <line>: <preview>` 匹配。空搜索返回 `No files found` 或 `No matches found`。达到上限的结果以省略计数结尾，并附 spill locator 与后端检索提示，或说明完整结果无法保存。启用 `sampleOverCapGlobResults: true` 时，超过上限的 `glob` 页面按实际搜索根正下方的条目轮转取路径，页脚说明采样依据及其覆盖的顶层条目数；无法覆盖全部条目时，页脚提示模型收窄 `path`。`false` 时页面是按修改时间排序的前部，并保留普通的上限结果页脚。未超过上限的结果原样呈现；扁平采样的结果也保留普通页脚，因为其采样等于按修改时间排序的前部。spill 产物始终持有按修改时间排序的完整列表。

#### Token 影响

内联路径与匹配受 `globMaxResults`、`grepMaxMatches` 与 `grepMaxLineBytes` 约束；调用及其保留结果在压缩（compaction）前留在历史中。

#### KV Cache 影响

仅追加；新可见内容跟在可复用请求前缀之后，不会使既有 KV Cache 条目失效。

### 工具错误

#### 模型看到的内容

失败被规范化为 `Error: <message>`，并携带结构化 `SEARCH_INVALID_PATTERN`、`SEARCH_FAILED`、`SEARCH_RAW_OUTPUT_OVERFLOW` 或 `SEARCH_ABORTED` 元数据供调用方使用。

#### Token 影响

只有失败的调用会增加这些保留 token。

#### KV Cache 影响

仅追加；新可见内容跟在可复用请求前缀之后，不会使既有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **搜索与文件访问没有共享工作区证明**——只有当工作目录与文件系统根目录指向同一工作区时，返回路径才可继续读取；本包不执行运行时跨服务校验。
- **打包二进制固定在依赖版本上**——`@vscode/ripgrep` 覆盖其随附的平台（macOS/Linux/Windows，x64/arm64）；不支持的平台或损坏的安装会以 `SEARCH_FAILED` 使调用失败。远程或虚拟文件系统需要共置的工作区或另一个搜索消费方。
- **schema 只暴露一个有界页面**——偏移分页、大小写开关、替代输出模式与提供方支撑的发现仍不在本包范围内；达到上限的完整输出需要 spill 后端。
- **启用采样时仅按搜索根正下方的第一段路径分组**——超过上限的 `glob` 页面在这些顶层条目之间平衡，因此集中在更深处的结果（一棵均匀树里某个繁忙目录）在该层级之下仍会呈现不均；递归平衡被延期。
