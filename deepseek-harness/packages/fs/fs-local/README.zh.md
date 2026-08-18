# @deepseek-ai/dsh-fs-local

[English](README.md) | 中文

`ctx.fs` 提供方约定（[`@deepseek-ai/dsh-fs`](../fs)）的**本地文件系统实现**。它使用宿主文件系统支持十二个 `FileSystem` 原语；将其作为插件加载会填充 `ctx.fs`。

```ts ignore-check
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'

await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
// ctx.fs uses the local backend; load @deepseek-ai/dsh-fs-observation-policy for the
// freshness policy gate and @deepseek-ai/dsh-tool-fs to expose read/write/edit.
```

## 行为

- **`resolve(path, opts?)`**：相对 `path` 在调用方提供 `opts.cwd` 时以该值为基准解析（面向模型的工具会传入调用 agent（智能体）的会话 cwd；见[每会话 cwd Agent Note](../../../.agents/notes/implemented/architecture/2026-07-02-fs-per-session-cwd.md)），否则以 `config.cwd` 为基准（默认 `process.cwd()`）；绝对 `path` 会忽略两者。`opts.signal` 会在本地解析前后检查，远程同级后端则可以用它中止往返。`targetKey` 是文件的 `realpath`，因此经符号链接到达同一文件的两个输入路径会共享一个身份，写入/编辑落在链接目标上，同时保留链接。尚不存在的路径在父目录存在时使用 realpath 后的父目录加 basename；只有父目录无法解析时才回退到绝对路径。`displayPath` 是绝对但未经解析的路径。
- **执行世界坐标**：`processPath` 公开目标的规范化宿主路径，`fileUrl` 通过 Node 的平台感知 URL 转换对该路径编码，`contains` 则使用平台路径语义检查身份相等或后代包含关系，消费方无需解析 `targetKey`。
- **`stat` / `lstat`**：返回目标元数据；目标不存在时返回 `undefined`。`stat` 为已解析目标报告 `FsInfo`（`version` 是由 bigint `dev:ino:size:mtimeNs:ctimeNs` 派生的不透明 token，`type` 为 `file`/`directory`/`other`，`size` 以字节计）；路径形态的 `lstat` 不跟随最后一个符号链接，报告 `FsPathInfo`，因此可以返回 `symlink`。两者都会在异步元数据探测前后检查取消，因此异步探测进行期间发生的中止会报告 `FS_ABORTED`，而非陈旧的不存在结果。
- **`readText` / `streamText`**：只支持 UTF-8。`readText` 读取整个文件；`streamText` 按分片解码，因此超大文件无需整体保存在内存中，消费方也可以自行限制保留量。两者都会拒绝无效 UTF-8、包含 NUL 字节的二进制样本（`FS_NOT_TEXT`）以及非普通文件目标。`read` 工具（`@deepseek-ai/dsh-tool-fs`）拥有行窗口逻辑。
- **`readBytes`**：按原始字节读取整个文件，不做解码或二进制拒绝（`read_image` 工具通过附件服务校验内容）。必填的字节上限在任何内容 I/O 之前先按 stat 大小短路；随后的流最多多读一个字节，因此 stat 之后增长的文件仍会以 `FS_TOO_LARGE` 失败，不会无界缓冲。
- **`listDir`**：按稳定的 `name.localeCompare()` 顺序列出一层目录。每个条目携带子项 basename、类型、解析后的子目标（`displayPath` 位于所列目录下，`targetKey` 是 realpath 身份）和低成本 stat 元数据（`version`，普通文件另有 `size`）。它绝不会打开或解码文件内容。缺失目标报告 `FS_NOT_FOUND`，文件/特殊文件目标报告 `FS_NOT_DIRECTORY`，已中止调用报告 `FS_ABORTED`，权限失败报告 `FS_PERMISSION_DENIED`，其他列出或子项元数据 I/O 失败报告 `FS_IO_ERROR`。损坏/消失的子项以无元数据的 `other` 返回，但解析子项时出现权限/I/O 失败会让整个列表以结构化 `FsError` 失败。
- **`writeText`**：原子写入。它会向排他打开的临时文件（`wx`、`0o600`）写入；该文件位于目标旁随机命名的私有暂存目录（`0o700`）内，随后执行 fsync 并发布。现有文件的 mode 会保留，新文件默认为 `0o600`；Windows 上的新文件继承目标目录的 DACL，而替换会在写入前把目标 DACL 复制到空临时文件，并通过 `ReplaceFileW` 发布，使原访问策略得以保留（见 [Windows DACL 保留 Agent Note](../../../.agents/notes/implemented/bug-fix/2026-07-19-windows-atomic-write-dacl-preservation.md)）。`expected` 防护是可选的：省略时无条件创建或覆盖；`createIfAbsent` 通过硬链接把暂存文件发布到目标位置，以实现原子且不替换的发布，因此初始探测后创建的普通文件会被保留，并以 `FS_NOT_OBSERVED` 拒绝本次写入；非普通路径条目也会被保留，并以 `FS_NOT_REGULAR_FILE` 拒绝；`replaceIfVersion` 只在观察到的版本上替换（目标缺失或版本不匹配均为 `FS_STALE_VERSION`）。仅当打开后的旧文件和 UTF-8 替换内容都严格低于 `config.diffBasisMaxBytes`（默认 10 MiB）时，覆写才返回旧文本作为上下文 diff 基础。即使外部写入方在初次探测后替换文件或改变文件大小，文件描述符读取仍会强制执行该上限；否则提供方返回 `before: null`，由展示层使用整文件回退。
- **`editText`**：在同一原语之上依次执行原子的字面量读取、修改和写入，并通过变更锁按目标串行化。`expected` 防护是可选的：提供时，会在字面量匹配之前校验版本（陈旧编辑报告 `FS_STALE_VERSION`，绝不会针对较新内容报告 `FS_EDIT_NOT_FOUND`/`FS_AMBIGUOUS_EDIT`）；省略时，无条件编辑当前内容。无论哪种情况，目标缺失都报告 `FS_STALE_VERSION`。匹配时规范化为 LF，随后恢复文件主要的 CRLF/LF 风格；空 `oldString` / 零匹配报告 `FS_EDIT_NOT_FOUND`，未设置 `replace_all` 的多个匹配则报告 `FS_AMBIGUOUS_EDIT`。

包根 SDK 接口包含默认/具名 `LocalFileSystem` 类和 `Config`。原始 I/O 位于 `src/fsio.ts`（不依赖 Cordis，单独进行单元测试）；`src/index.ts` 是轻量服务接线。

## 模型体验

通过 [`dsh-tool-fs`](../tool-fs/README.md) 间接产生影响；该消费方把本提供方带行窗口的 UTF-8 内容、变更确认和提供方消息原文渲染为有保留上限的结果，而版本、原子写入机制和目录元数据仍属内部细节。

#### KV Cache 影响

不会直接使缓存失效；具名消费方负责请求前缀的任何变化。

## 已知限制与延期工作

- **`config.cwd` 不是沙箱**：它是解析默认值，而非约束；绝对路径和 `..` 可以逃逸。请使用更严格的 `ctx.fs` 后端或 `tools/execute` waterfall（瀑布式事件）上的权限插件实施约束（见[能力 seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-17-filesystem-capability-seam.md#consequences)）。
- **版本 token 依赖文件系统元数据**：它们组合设备、inode、大小、纳秒级 mtime 和纳秒级 ctime；如果存储层在重写时无法更新其中任何一项事实，仍可能绕过陈旧防护。
- **`editText` 会把整个文件及编辑后的副本保存在内存中**：只有读取路径支持流式处理。
- **低于上限的覆写仍会缓冲上下文基础**：`writeText` 除调用方持有的替换内容外，最多还会保留略低于 `config.diffBasisMaxBytes` 的旧文本；该上限不限制返回的 `after` 值，也不限制展示层的整文件回退。
- **二进制检测不对称**：读取只对前 8192 字节执行 NUL 采样，编辑则扫描整个 buffer，因此 NUL 出现在后部的文件可以读取，但编辑会被拒绝。
- **每目标变更锁仅限进程内**：即使跨进程，带防护的创建仍采用原子且不替换的发布方式；但只有当可选版本防护观察到元数据变化时，系统才能发现其他进程中的替换写入方，且绝不会将其串行化。
- **带防护的创建要求支持硬链接**：拒绝硬链接发布的文件系统或挂载点无法支持 `createIfAbsent`；提供方会使目标保持缺失状态并报告 `FS_IO_ERROR`。
- **提交后清理采用尽力而为语义**：如果移除仅所有者可访问的暂存目录失败，成功发布仍视为成功，并留下私有残留供运维人员后续清理。
