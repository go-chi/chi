# @deepseek-ai/dsh-fs

[English](README.md) | 中文

**`FileSystem`**（`ctx.fs`）定义同一个执行世界中的存储原语，包括解析路径、公开规范化进程路径与文件 URI、检查包含关系、完整或流式读取文本、有界读取原始字节、检查／列出元数据、原子写入和应用字面量编辑，但不规定实现方式。两个变更操作都**可选** 接收版本防护，因此 `ctx.fs` 本身就是完整且不受约束的存储 seam。本包还拥有由工具分派、政策插件监听的 `fs/*` 政策事件词汇。

本包拥有四层文件系统栈中的 Service Definition 和提供方约定层；该拆分使每个关注点可以独立演进和替换（见[能力 seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)、[文件系统能力 seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-17-filesystem-capability-seam.md)、[拆分文件系统 seam Agent Note](../../../.agents/notes/implemented/simplification/2026-06-26-fsspec-style-fs-seam.md)和[文件上下文事件门禁 Agent Note](../../../.agents/notes/implemented/architecture/2026-06-26-file-context-as-event-gate.md)）：

| 层 | 包 | 角色 |
|---|---|---|
| 工具/执行器 | `@deepseek-ai/dsh-tool-fs` | 面向模型的 `read`/`write`/`edit` schema、读取窗口和文本渲染；通过 `ctx.fs` 读取/写入/编辑，并分派 `fs/*` 事件 |
| 政策 | `@deepseek-ai/dsh-fs-observation-policy` | 已观察状态、编辑前读取和版本防护的写入/编辑，通过 `fs/*` 事件门禁贡献（无服务） |
| 提供方约定 | `@deepseek-ai/dsh-fs`（本包） | `ctx.fs`：执行世界路径、文本 I/O 与原子变更原语（可选版本防护）；拥有 `fs/*` 事件词汇 |
| 提供方 | `@deepseek-ai/dsh-fs-local` | 宿主文件系统实现 |

`fs-sandbox` 与 `fs-e2b` 实现该接口，无需更改政策层和工具层。

## 服务 API（`ctx.fs`）

后端继承 `FileSystem` 并实现十二个原语。

| 成员 | 语义 |
|---|---|
| `resolve(path, opts?)` | 把路径解析为稳定的 `FsTarget`（不透明 `targetKey`、`displayPath`）。`opts.cwd` 是相对 `path` 解析所依据的基准（调用方提供其会话工作区；绝对路径忽略该值；省略时使用后端默认值），`opts.signal` 则中止后端往返。该方法是异步的，因为远程后端可能需要 I/O。经不同路径到达的同一文件必须产生相同 `targetKey`。 |
| `processPath(target)` | 返回该提供方执行世界中的子进程可以打开的规范化绝对路径。该路径有意与不透明的 `targetKey` 分离。 |
| `fileUrl(target)` | 返回采用执行世界平台语法的规范化 `file:` URI。编码由后端而非宿主进程负责。 |
| `contains(parent, child)` | 在不公开或解析目标 key 的情况下，检查规范化身份相等或后代包含关系。两个目标都来自该提供方。 |
| `stat(target, signal?)` | 返回 `FsInfo` 元数据（`version`、`type`、可选 `size`）；目标不存在时返回 `undefined`。绝不返回内容。 |
| `lstat(path, opts?, signal?)` | 当最后一个路径组件是符号链接时，不跟随该组件，返回 `FsPathInfo` 元数据。该方法采用路径形态，使消费方能在 `resolve` 跟随仓库所有的符号链接进入目标前拒绝它。 |
| `readText(target, signal?)` | 把整个普通文本文件读取为一个解码后的字符串。负责普通文件检查、UTF-8 解码和二进制/NUL 拒绝（`FS_NOT_TEXT`）。 |
| `streamText(target, signal?)` | 为大文件按解码后的分片流式读取相同文本（跨分片 UTF-8 解码仍由此处负责）；需要字节上限的消费方在消费流时执行该上限。 |
| `readBytes(target, signal, maxBytes)` | 把完整普通文件按原始字节读出，不做解码或二进制拒绝。`maxBytes` 为必填，在该 seam 上限制完整内容：已知或读取中发现的超限以 `FS_TOO_LARGE` 失败，而不是截断或无界缓冲。 |
| `listDir(target, signal?)` | 按稳定名称顺序列出直接子项。返回条目名称、条目类型、解析后的子目标和低成本元数据（若可用则包括 `version`/文件 `size`）；绝不读取文件内容。缺失目标抛出 `FS_NOT_FOUND`，非目录抛出 `FS_NOT_DIRECTORY`，权限失败抛出 `FS_PERMISSION_DENIED`，其他后端 I/O 失败抛出 `FS_IO_ERROR`。损坏/消失的子项可以作为无元数据的 `other` 返回；子项权限/I/O 失败会使用相同结构化代码使整个列表失败。 |
| `writeText(target, content, expected?, signal?)` | 原子创建/替换。`expected` 是可选的：省略 ⇒ 无条件创建或覆盖；提供 `FsWriteIntent`（`createIfAbsent`/`replaceIfVersion`）⇒ 添加防护。`createIfAbsent` 必须以不替换的方式发布，使初始探测后抢先创建的文件得到保留。 |
| `editText(target, edit, expected?, signal?)` | 字面量编辑。`expected` 是可选的：省略 ⇒ 无条件编辑当前内容；提供 `{ version }` ⇒ 添加防护，并在匹配之前校验。无论哪种情况，目标缺失都报告 `FS_STALE_VERSION`。应用和写入以原子方式完成，使用同一个变更临界区。 |

无论是否有版本防护，变更都在后端的每目标锁内运行，因此无条件写入/编辑仍是原子的；「无条件」只移除*版本*前置条件，不移除原子性。

## `fs/*` 政策事件

本包声明三个事件（见 [filesystem.md](../../../docs/subsystems/filesystem.md#cordis-surface) 的生成区块），使发出方（`@deepseek-ai/dsh-tool-fs`）和政策监听器（`@deepseek-ai/dsh-fs-observation-policy`）共享词汇，而无需让发出方依赖政策插件。`fs/write-intent` 和 `fs/edit-intent` 是单槽决策 waterfall（瀑布式事件）（监听器完整决策，绝不调用 `next()`）；`fs/observed` 是发后即忘的记录事件，携带 `FsObservation` 可辨识联合：存在并带有版本，或确认缺失。它们只携带 `dsh-fs` 词汇和一个不透明 `object` 参与者，不含面向模型的概念或 agent（智能体）/会话所有者结构。

## 提供方约定，不是政策层

`ctx.fs` 有意接近 fsspec 风格的存储原语，比字节级 `cat`/`open` 高半层，因为它会解码文本并拒绝二进制，使政策层绝不接触原始字节。它负责 UTF-8 解码、二进制拒绝、原子写入和字面量编辑临界区。它**不** 负责行窗口、编号行、渲染 footer 或已观察状态。已观察状态、编辑前读取和版本防护的写入/编辑属于插件（`@deepseek-ai/dsh-fs-observation-policy`）通过提供可选防护而添加的政策，并非提供方行为，因此沙箱化/远程后端不会继承任何面向模型的观察政策。

`editText` 留在该 seam 上，不由政策层通过读取加写入组合，因为版本防护、字面量匹配和原子重写必须处于同一临界区内，才能正确归因错误并实现一方胜出/一方陈旧的并发；远程后端也可以将其实现为原生比较并编辑操作。

## 词汇

`FsTargetKey` / `FsVersion` 是带品牌的不透明 id（见[品牌 id Agent Note](../../../.agents/notes/implemented/architecture/2026-06-20-branded-ids.md)）；消费方不得解析 `targetKey` 或解释 `version`，只有 `displayPath` 用于模型/UI 输出。`FsObservation` 区分 `{ kind: 'present', version }` 与 `{ kind: 'absent' }`，使策略无需执行 I/O 即可分辨未见目标和确认缺失。`FsWriteIntent` 是显式的防护写入意图（`createIfAbsent` 创建缺失目标，并以 `FS_NOT_OBSERVED` 拒绝现有目标；`replaceIfVersion` 只在观察版本上替换，否则为 `FS_STALE_VERSION`）；从 `writeText` 中省略该值就是第三种无条件状态。`FsPathInfo` 是可报告 `symlink` 的不跟随链接元数据形态，区别于目标级 `FsInfo`。失败会抛出 `FsError`（继承 `HarnessError`；见[结构化错误分类 Agent Note](../../../.agents/notes/implemented/architecture/2026-06-11-structured-error-taxonomy.md)），并携带稳定的 `FsErrorCode`（`FS_NOT_FOUND`、`FS_NOT_DIRECTORY`、`FS_NOT_TEXT`、`FS_NOT_REGULAR_FILE`、`FS_TOO_LARGE`、`FS_PERMISSION_DENIED`、`FS_IO_ERROR`、`FS_STALE_VERSION`、`FS_NOT_OBSERVED`、`FS_AMBIGUOUS_EDIT`、`FS_EDIT_NOT_FOUND`、`FS_ABORTED`）；工具注册表公开 `{ name, code }`，并将其附在 `isError` 结果上。完整约定见 `src/types.ts`。

## 模型体验

通过 `dsh-tool-fs` 间接产生影响；该消费方把提供方文本和错误渲染为有界且保留的文件系统工具结果。

#### KV Cache 影响

不会直接使缓存失效；具名消费方负责请求前缀的任何变化。

## 已知限制与延期工作

- **变更操作约定只支持文本**：文本读取和两个变更操作都以 `FS_NOT_TEXT` 拒绝二进制/非 UTF-8 内容；`readBytes` 是唯一的原始字节原语，二进制安全的变更操作仍是[工具 schema Agent Note](../../../.agents/notes/implemented/feature/2026-06-17-filesystem-tool-schemas.md)有意延期的工作。
- **只有十二个原语**：没有删除、重命名/移动、复制或监视；`listDir` 只支持一层，递归、glob、分页和搜索不在范围内，见[目录列出 Agent Note](../../../.agents/notes/archived/architecture/2026-07-03-filesystem-directory-listing-seam.md)。
- **没有 I/O deadline**：该 seam 不启动超时；取消只是每个原语上尽力而为的可选 `AbortSignal`（见有意采用的 [fs 能力族立场](../README.md)）。
- **先解析后操作使远程后端每次工具调用需要两次往返**：折叠或缓存解析由这种后端自行决定。
