# Agent Note: 由 Bash 支持的 grep 与 glob 发现工具

Status: implemented
Archived: 2026-07-27

[English](2026-07-09-bash-backed-grep-glob-discovery.md) | 中文

## 问题

harness 需要面向模型的 `glob` 和 `grep` 工具，但如果将它们实现为 `ctx.fs` 提供方的方法，就会把本地产品便利功能变成所有文件系统后端都必须实现的契约。本地工作区发现天然适合由进程支持的 `rg` 工作流；远程或虚拟文件系统后端可能公开自己的搜索 API，可能无法共享本地 `ripgrep` 视图，也可能完全不支持发现。文件读取／写入／编辑 seam 尚未证明此需求前，v1 不应要求每个文件系统后端都实现搜索。

搜索输出还受到两层不同的预算约束。工具需要足够多的原始 `rg` 输出，才能计算稳定的逻辑结果；模型则只能收到有界预览，并在格式化结果超出内联预算时获得恢复路径。通用落盘策略只能看到最终工具结果，因此无法恢复搜索工具已经省略的匹配项。搜索工具必须自行负责保留，并尽力落盘格式化结果。

## 决策

`glob` 和 `grep` 是 `@deepseek-ai/dsh-tool-fs-search` 中的条件式面向模型工具，由 bash seam 支持，不会成为新的 `ctx.fs` 提供方方法。加载插件时，该包（package）执行 `command -v rg >/dev/null 2>&1`：先通过 `ctx.bash.resolve(request)` 解析请求，再通过 `ctx.bash.run(spec)` 运行；如果命令以非零状态退出，该包会记录警告，并且既不注册工具，也不注册提示词章节。如果探针无法启动、超时、中止、被终止，或没有产生退出码，插件加载会明确失败，因为这意味着 bash 执行器损坏，而不是可选二进制文件缺失。注册后，执行流程同样依次调用 `ctx.bash.resolve(request)` 与 `ctx.bash.run(spec)`，并使用工具组装的固定 `rg` 命令模板。工具层负责 schema、参数验证、shell 引用、结果解析、结果格式化、保留、格式化结果落盘交接，以及超时声明。bash 执行器负责请求默认值解析与上限控制、子进程执行、进程组终止、环境清理、原始输出捕获，以及在本地、沙箱或远程 bash 实现之间替换后端。

这些工具不使用 `ctx.bash.start()`，也不创建模型可见的后台任务。从 agent loop（智能体循环）的视角看，它们是普通前台工具：只有当 `rg` 命令退出、超时、中止或失败后，工具调用才返回。`defineTool({ timeoutMs })` 声明协作式工具调用预算，`@deepseek-ai/dsh-timeout-policy` 通过 `exec.signal` 强制执行；工具会在 `resolve()`／`run()` 前将该信号转发给 bash 请求。bash 后端自身的超时仍作为第二层安全上限；先触发的中止生效。

这些工具使 `path` 与 Claude Code 的搜索工具保持一致，但将解析绑定到 bash workdir，而不是 `ctx.fs`。工具从 `exec.agent?.session.header.cwd` 派生 bash 请求 workdir，与 `dsh-tool-bash` 和 `dsh-tool-fs` 一致；如果会话没有 cwd，它会省略 `request.workdir`，由 bash 实现通过 `resolve()` 应用其配置的 cwd 或进程 cwd。对于 `grep`，`path` 是可选的 ripgrep 目标，可以是文件或目录；省略时使用已解析的 bash workdir。对于 `glob`，`path` 是可选的目录搜索根；省略时同样使用已解析的 bash workdir。相对 `path` 值基于该 workdir 解析。只要可行，返回路径就会显示为相对于已解析 bash workdir 的形式；只有在共置部署中，bash workdir 与文件系统 `read` 根指向同一个工作区时，这些路径才保证可以继续读取。v1 会记录这项部署要求，但不执行跨服务运行时验证。在形成共享工作区／根契约或提供方专用搜索后端之前，远程或虚拟文件系统搜索保持暂缓。

该包不注入 `fs`，而是注入 `tools`、`systemPrompt` 和 `bash`；它有意读取 `spillStore` 时使用 `ctx.get('spillStore')`，而不使用静态注入，因为格式化结果落盘是可选功能。现有 `@deepseek-ai/dsh-tool-fs` 部署若只需要 `read`／`write`／`edit`，则无需加载 bash。加载搜索功能的部署则必须让 bash 执行器环境可以使用 `rg`，这些工具才会进入模型可见 schema。

### 包结构

v1 包保持精简。`@deepseek-ai/dsh-tool-fs-search` 内部的源代码布局如下：

```text
src/index.ts
src/glob.ts
src/grep.ts
src/search-core.ts
src/shell-quote.ts
```

`glob.ts` 和 `grep.ts` 各自负责参数验证、命令构造、结果解析、格式化和注册。`shell-quote.ts` 是一个共享辅助模块，因为 shell 引用是两个工具都必须经过的安全边界；`search-core.ts` 是另一个共享模块（实现时对原四文件方案所作的修订）：`SEARCH_*` 错误词汇、bash 运行与原始输出获取、格式化结果落盘交接，以及 workdir 相对显示，在两个工具中完全相同。若在每个工具中重复这套精细管道，正是对称性约定所指出的漏提取问题。命令构造器禁止自行拼凑引用，也不能把未经引用、由模型控制的值直接连接到 shell 命令中。

### Schema 与配置

`glob` 公开精简的发现形状：

```ts
interface GlobArgs {
  pattern: string
  path?: string
}
```

`grep` 公开 OpenCode 风格的最小形状：

```ts
interface GrepArgs {
  pattern: string
  path?: string
  include?: string
}
```

常规预算不会进入面向模型的 schema。`@deepseek-ai/dsh-tool-fs-search` 拥有以下带默认值并经过验证的配置字段：

| 字段 | 默认值 | 作用 |
|---|---:|---|
| `globMaxResults` | `100` | 内联保留的最大路径数；与 Claude Code 的默认 `GlobTool` 结果上限一致。 |
| `grepMaxMatches` | `250` | 内联保留的最大扁平匹配数；与 Claude Code 的默认 `GrepTool` `head_limit` 一致。 |
| `grepMaxLineBytes` | `2000` | 每条匹配行预览保留的最大字节数，通过 `TextRetainer({ kind: 'head', maxBytes: grepMaxLineBytes })` 应用。 |
| `rawOutputMaxBytes` | `20000000` | 工具会解析的完整原始 `rg` stdout 最大字节数；与 Claude Code 的 ripgrep 原始缓冲区一致。 |
| `timeoutMs` | `30000` | 附加到两个工具定义并由 `@deepseek-ai/dsh-timeout-policy` 强制执行的工具调用超时。 |

`globMaxResults` 和 `grepMaxMatches` 使用 `ItemRetainer({ kind: 'head' })`。`grepMaxLineBytes` 针对每条匹配行使用 `TextRetainer({ kind: 'head', maxBytes: grepMaxLineBytes })`，使预览截断保留 UTF-8 边界。这遵循[工具结果保留库](../architecture/2026-07-06-tool-result-retention-library.md)对发现条目的映射：收集完整结果，在内联结果中保留头部条目，并将路径映射、分组和逐行预览放在保留器外部。v1 的 `grep` 不公开 `case_insensitive`、`head_limit`、`offset`、`count`、多行、上下文行、输出模式或文件类型过滤器。模型如需周边上下文，可使用 `read` 读取匹配文件；如需后续结果，则遵循返回的落盘定位符所给出的检索提示。

Claude Code 的数值只是两层预算的参考点，并非面向模型 schema 的先例。其专用搜索工具会缓冲最多 20 MB 的原始 ripgrep 输出用于内部处理；在非 WSL 平台上使用 20 秒 ripgrep 超时，在 WSL 上使用 60 秒，之后才在模型看到结果前应用搜索专用上限：`GrepTool` 默认 `head_limit = 250`，并持久化超过 20,000 个字符的格式化结果；`GlobTool` 默认最多 100 条路径，并持久化超过 100,000 个字符的格式化结果。此 Agent Note 采用同样的原始缓冲区和内联数量默认值，将默认搜索超时设为 30 秒，并通过本 harness 的 `ctx.spillStore.saveText()` 路径恢复格式化结果。

`path` 字段沿用与 Claude Code 相同的区分方式：`grep.path` 是文件或目录形式的 ripgrep 目标，`glob.path` 则是目录搜索根。v1 不为这些工具公开单独的 cwd／workdir 参数。

`include` 是一个正向 glob 过滤器，不是列表，也不是排除语法。系统会预先拒绝逗号分隔或取反的 include 模式，并返回结构化参数错误。shell 命令中使用的每个模型控制值，包括 `pattern`、`path` 和 `include`，都必须经过包私有的 shell 引用辅助模块。

### 执行

`glob` 构建固定的 `rg --files` 命令，并以解析后的目录搜索根为根（提供 `path` 时使用该值，否则使用 bash workdir）：`rg --files --glob <pattern> --sort=modified --no-ignore --hidden`，另加针对 `.git`、`.svn`、`.hg`、`.bzr`、`.jj` 和 `.sl` 的 VCS 元数据排除项。这样既与 Claude Code 的隐藏／忽略文件发现和修改时间排序保持一致，也避免宽泛搜索包含 VCS 内部文件。工具逐行解析路径，只要可行就将结果映射为相对于 bash workdir 的路径，将每条路径推入 `ItemRetainer({ kind: 'head', maxItems: globMaxResults })`；当保留结果达到上限时，它会格式化完整的已排序路径列表，作为落盘产物。

`grep` 构建固定的逐行 `rg --json` 命令，作用于所提供的文件／目录目标（提供 `path` 时使用该值，否则使用 bash workdir），从而无需按冒号拆分，就能解析文件路径、行号和行文本。它消费 `match` 记录，将格式错误的 JSON 或匹配记录视为 `SEARCH_FAILED`；只要可行，就将结果路径映射为相对于 bash workdir 的路径；通过 `grepMaxLineBytes` 应用逐行预览保留，将每个匹配推入 `ItemRetainer({ kind: 'head', maxItems: grepMaxMatches })`，然后只按文件分组内联输出中保留的预览匹配。落盘产物保存完整的格式化匹配列表，而不是只保存省略的尾部，因此检索提示指向模型已经看到的同一逻辑结果。

原始 `rg` stdout 是内部传输细节。工具请求 `stdoutMaxBytes: rawOutputMaxBytes`，并通过 `ctx.bash.resolve()` 解析；只有当执行器在该上限内返回未截断的 stdout 时，工具才解析 `stdout.text`。如果 stdout 超过 `rawOutputMaxBytes`，或者执行器仍返回 `stdout.truncated`，工具会以明确的搜索错误失败，要求模型缩小 `pattern`、`path` 或 `include`。工具绝不向模型公开原始 `rg` 输出或 bash 原始落盘路径。

只有 stdout 是解析源。对于无效模式、注册后运行时 `rg` 消失，以及搜索失败，stderr 作为诊断文本；如果 bash 截断 stderr，工具会使用保留的 stderr 尾部并附加截断说明，不会读取 `stderr.spillPath`。

如果 `ctx.bash.run()` 因工具超时或调用方取消触发而报告 `aborted`，工具会返回结构化失败，而不是假装没有匹配项。如果 bash 自身的超时先触发，工具同样会以明确的超时消息失败。非零 ripgrep 退出语义由工具负责：退出码 0 表示存在匹配并成功；退出码 1 表示没有匹配但成功；无效模式、运行时 `rg` 消失或无法访问搜索 workdir 则表示失败。

搜索失败使用包自有的 `HarnessError` 子类与 `SEARCH_*` 代码，而不使用 `FsErrorCode`，因为这些工具不是 `ctx.fs` 提供方操作。v1 的词汇包括 `SEARCH_INVALID_PATTERN`、`SEARCH_FAILED`、`SEARCH_RAW_OUTPUT_OVERFLOW` 和 `SEARCH_ABORTED`。缺少必填字段、空字符串或不支持的取反／列表式 `include` 值等模型参数验证失败，仍作为普通工具参数错误处理。

### 格式化结果落盘

`ctx.spillStore` 是可选服务，仅用于面向模型的格式化结果。这是代码库中首个工具自有落盘调用模式；此设计有意为之，因为搜索保留属于条目级策略：`globMaxResults` 限制路径数，`grepMaxMatches` 限制匹配数，而工具此时仍持有完整逻辑结果。通用 `dsh-spill-policy` 会在 `tools/post-execute` 阶段限制最终文本字节数；到那时搜索工具已经省略后续路径或匹配，策略无法恢复它们。

当搜索产生的逻辑结果数超过内联上限，且 `ctx.spillStore` 存在时，工具会通过 `saveText()` 保存完整的格式化结果。落盘所有者是调用 agent 的会话头 id（`exec.agent?.session.header.id`）；缺少该所有者时，搜索会保留内联结果，并报告完整结果无法保存。落盘来源是工具执行身份：`{ toolName: exec.name, callId: exec.callId, label: 'result' }`。建议文件名为 `grep-results.txt` 和 `glob-results.txt`；落盘后端仍将它们视为提示，而不是路径。

如果落盘存储不存在、调用没有会话所有者，或保存失败，工具仍返回内联页和页脚，说明完整结果无法保存。格式化结果落盘存储不可用本身绝不能把搜索成功变为 `isError` 结果。

bash 原始输出流与格式化搜索落盘产物是两个不同的产物。原始 `rg` stdout 只会在所请求的 bash stdout 上限内于内存中解析；格式化落盘产物则是 `ctx.spillStore.saveText()` 生成的稳定、面向模型的恢复定位符。

### 结果形状

带有成功格式化落盘的受限 `glob` 结果会返回内联页与落盘通知：

```text
<first N paths>

(Showing N of M paths. Full sorted result stored at: /.../session-abc123/9f8e7d-glob-results.txt. Use read with offset/limit, or grep this path to search within it.)
```

带有成功格式化落盘的受限 `grep` 结果会返回分组后的预览匹配与落盘通知：

```text
Found N of M matches

<file>
Line 12: ...

(Full grep result stored at: /.../session-abc123/9f8e7d-grep-results.txt. Use read with offset/limit, or grep this path to search within it.)
```

如果完整逻辑结果未超过内联上限，系统不会创建格式化落盘产物。如果完整逻辑结果过大但无法格式化落盘，页脚会说明结果已受限，完整结果无法保存。`truncated`／省略计数是预算事实，并不表示搜索不完整；超时、无效正则表达式、运行时 `rg` 消失、无法访问 workdir、原始输出溢出、跳过二进制文件和解析失败，仍属于工具领域的错误或不完整字段。

## 考虑过的替代方案

**将 `glob`／`grep` 放在 `ctx.fs` 上。** v1 不采用：这会迫使每个文件系统后端增加搜索 API，并使本地 ripgrep 行为成为提供方 seam 的一部分。搜索是有用的产品行为，但不像 `readText` 或 `writeText` 那样属于通用文本存储原语。

**直接从 `dsh-fs-local` spawn ripgrep。** 此 Agent Note 的 v1 不采用：直接 spawn 提供最简洁的 argv 边界、stdout／stderr 控制与提前停止控制，但会重复 bash seam 已负责的进程执行事项，包括环境清理、进程组终止、超时传播、沙箱／远程执行器替换，以及有界输出捕获。如果 bash 支持的搜索被证明过于依赖 shell 字符串，或必须支持前台流式输出，该方案仍是合理优化。

**通过 `ctx.bash.start()` 实现流式提前停止。** 不采用：`start()` 会创建模型可见的后台任务语义，包括 task id、所有者 token、`bash_output`、`bash_kill`、完成通知，并且没有内置超时。`grep` 需要前台工具结果，而不是后台 bash 工作流。如果将来必须流式搜索，正确的抽象是在 bash／进程 seam 上增加前台流式进程句柄，而不是借用公开后台任务 API。

**向模型公开 bash 原始落盘路径。** 不采用：bash 原始落盘路径包含原始 `rg` stdout（对于 grep 即 `rg --json` 记录），并非稳定的格式化搜索结果。搜索只把原始 stdout 当作内部传输；模型恢复使用通过 `ctx.spillStore.saveText()` 保存的格式化结果。

**先为 bash 输出规范化增加 `spillStore.saveFile()`。** 此 Agent Note 的 v1 不采用：未来规范化 bash 时，`saveFile()` 可以帮助将现有执行器落盘文件移动到会话范围的落盘存储，但搜索只需在生成面向模型的产物前，在内存中获取有界的原始 `rg` stdout。`saveText()` 足以保存格式化搜索结果。

**依赖通用 `dsh-spill-policy`。** 不采用：通用 post-execute 落盘只能看到最终工具结果。如果 `grep`／`glob` 内联返回第一页，通用策略无法恢复省略的结果。搜索工具必须在返回有界的面向模型文本前，自行保存完整的格式化结果。

**公开 Claude Code 的完整 `GrepTool` schema。** v1 不采用：`output_mode`、上下文标志、多行、`head_limit`、`offset`、`case_insensitive` 和类型过滤器会使面向模型的接口变成 ripgrep 包装层。本 harness 将常规预算与续传机制保留在部署策略和落盘产物中。

**保留提前停止搜索，并省略格式化落盘产物。** 此提案不采用：提前停止效率更高，却不给模型检查后续结果的路径。所选 v1 优先保证结果可恢复性与实现简洁性，并以 `timeoutMs`、`rawOutputMaxBytes`、bash 后端上限和格式化落盘产物作为安全后备。

**先扩展 bash seam，增加原始输出读取器。** 不采用：可移植的 `readRawOutput(ref, maxBytes)` API 会增加引用生命周期、权限和后端存储语义。逐次运行的 `stdoutMaxBytes` 请求是更窄的 seam：搜索要么在 `rawOutputMaxBytes` 内收到完整 stdout，要么明确失败。

**始终注册，只有执行时才报告缺少 `rg`。** 不采用：模型可见工具 schema 是部署能够尝试该能力的承诺。如果 bash 执行器在加载时找不到 ripgrep，更安全的接口是完全没有 `glob`／`grep` 工具或提示词指引。对于注册后发生环境变化的情况，执行时的 `rg` 缺失分类仍作为防御性回退。

## 测试

- 测试覆盖注册时 `rg` 探测（探测成功会注册两个工具和提示词章节；非零探测会跳过工具与提示词章节并发出警告；基础设施探测失败会拒绝插件加载），证明中止的 `exec.signal` 会到达 bash 后端（通过同一引用的 spec 断言和 `SEARCH_ABORTED` 结果），并覆盖命令构造／引用（恶意模式、带空格路径、以短横线开头的值、引号、换行、glob 元字符：既有单元断言，也针对每个恶意值执行真实 `bash -c` 往返）、将 `grep.path` 用作文件与目录目标、将 `glob.path` 用作目录搜索根、无效模式处理、无匹配、格式错误的 `rg --json` 输出、匹配行预览截断、原始输出溢出、超时／中止、格式化落盘成功／失败、包自有 `SEARCH_*` 错误代码，以及无后台任务不变量。
- 直接覆盖第一方工具自有落盘先例：落盘后端存在、落盘后端缺失、`saveText()` 失败，以及缺少落盘所有者。
- 该包通过真实 Loader 路径覆盖命名空间插件的导出形状（`name`、`inject`、`Config` 和 `apply`，且没有默认导出）。
- 真实执行器集成测试（`dsh-bash-local` + 真实 `rg`）验证外部世界：恶意模式保持惰性、逐会话 cwd 解析、VCS 元数据排除、按修改时间排序，以及真实 ripgrep stderr 分类。如果测试进程的 PATH 中没有 `rg`，该测试会自行跳过（这是与无密钥 e2e 跳过相似的 CI 兼容措施）；伪执行器测试覆盖注册和执行时缺少 `rg`，并由逐文件 100% 覆盖率门禁兜底。
- transcript 可见落盘通知仍有快照缺口：此功能合入时记录了缺口说明，没有快照。快照层会回放 acp-agent 树；在其中加入搜索插件会改变组装的系统提示词，必须使用真实密钥重新录制每一份预期输出，而实现环境没有密钥。落盘通知的确切 transcript 文本由单元测试固定（`formatGlobOutput`／`formatGrepOutput` 以及通过注册表执行的落盘测试）；下一次拥有密钥的会话应把插件接入 acp-agent 树，并运行一次 `test:snapshot:record`。

## 后果

- `glob` 和 `grep` 是 `@deepseek-ai/dsh-tool-fs-search` 中的条件式面向模型工具，不是 `ctx.fs` 提供方方法，也不属于现有 `@deepseek-ai/dsh-tool-fs` 根插件。只有 bash 执行器能找到 `rg` 时才会注册；该包注入 `tools`、`systemPrompt` 和 `bash`，不注入 `fs`，并使 `ctx.spillStore` 保持可选，读取时使用 `ctx.get('spillStore')`。
- Schema 严格为 `glob(pattern, path?)` 和 `grep(pattern, path?, include?)`；搜索上限与超时是带默认值并经过验证的 Config 字段（`globMaxResults`、`grepMaxMatches`、`grepMaxLineBytes`、`rawOutputMaxBytes`、`timeoutMs`）。
- 工具通过 `ctx.bash.resolve(request)` → `ctx.bash.run(spec)` 执行，转发 `exec.signal`，绝不调用 `ctx.bash.start()`，也绝不公开 bash task id。如果存在 `exec.agent?.session.header.cwd`，bash 请求 workdir 来自该值；解析后的 `spec.workdir` 决定执行与相对路径显示。
- 工具向 bash seam 请求 `stdoutMaxBytes: rawOutputMaxBytes`，只解析上限内未截断的 stdout，并将超限或仍被截断的原始输出视为明确的搜索失败；绝不向模型公开原始 `rg` 输出。
- 只要可用，过大的完整格式化结果会通过 `ctx.spillStore.saveText()` 保存，而内联结果保持有界；落盘失败、后端缺失或所有者缺失时，系统保留内联结果并报告未保存的剩余内容，绝不会返回 `isError`。
- 包 README、生成的配置目录与导出 JSDoc 会记录 Config 字段和 `SEARCH_*` 代码；tui-agent 示例会提供条件式工具插件（acp-agent 树等待完成上述快照重新录制）；fs 组 README 会记录 `rg` 可用性以及 bash／文件系统共置部署要求。

## 风险

在宽泛模式下，完整运行的 `grep` 可能比提前停止搜索更慢。v1 为了简化实现并恢复完整结果而接受这项成本，同时通过工具超时、bash 超时、`rawOutputMaxBytes` 和输出上限加以约束。如果实际运行过慢，仍可采用直接 ripgrep 或前台流式替代方案。

Shell 命令构造是最尖锐的安全边界。`ctx.bash` 接受命令字符串而不是 argv 向量，因此实现必须集中处理 shell 引用，并测试恶意模式、带空格路径、以短横线开头的模式、引号、换行和 glob 元字符。

v1 假设 bash 与文件系统共置部署。如果 bash 搜索一个工作区，而 `read` 工具基于另一个根解析路径，返回路径可能无法继续读取。该包会记录这项要求，但不在运行时验证。

落盘定位符由后端负责。当前本地后端返回本地文件系统路径，适用于 `read`／`grep` 能打开这些文件的部署；远程或工作区受限部署可以使用另一种后端，让其定位符和检索提示指向受支持的检索机制。
