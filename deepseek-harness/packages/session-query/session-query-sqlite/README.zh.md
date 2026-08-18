# @deepseek-ai/dsh-session-query-sqlite

[English](README.md) | 中文

具体 `ctx.sessionQuery` 提供方。`SqliteSessionQueryEngine` 从 Service Definition 包继承精确读取、跟踪和提供方无关的过滤，并使用 SQLite FTS5 实现其两个全文方法。搜索使用实时优先的逻辑会话语料库，并按每个会话中匹配度最高的事件对跨会话结果分组。

## 搜索约定

`searchSessions(request, exec?)` 返回跨语料库的 `SessionSearchHit` 分页结果；`searchEvents(request, exec?)` 返回单个会话内的 `SessionEventSearchHit` 分页结果。查询不得省略，首尾空白会被移除，内部空白会被规范化，并按字面短语处理。引号、`OR`、`NEAR` 和 `*` 等 FTS5 语法被视为数据，而非可执行 MATCH 语法。元数据过滤器是在排名前应用的参数化 SQL 谓词。为使 SQLite FTS5 MATCH 保持在受支持的外层谓词上下文中，跨会话请求最多可编译 14 个组合会话与事件过滤谓词；会话内请求最多可编译 13 个过滤谓词，因为固定目标会话谓词占用一个 slot。每个范围端点编译为一个谓词。请求超过任一谓词预算，或超过 SQLite 可移植的 32,766 总绑定上限（包括固定查询和分页值）时，会在准备语句前以 `SESSION_QUERY_INVALID_FILTER` 失败。

持久表和 TEMP 表之间的相关性排名可直接比较：先按实际 FTS5 高亮匹配 span 数降序，再按已存储文档码点长度升序。事件时间、适用时的会话 id 和 seq 打破其余平局。跨会话结果将所选事件公开为 `bestMatch`；两种范围都从 FTS5 高亮位置派生空白规范化的纯文本，并按 Unicode 码点限制长度。游标是带品牌类型的不透明值，绑定到规范化请求和服务实例，并在相关世代变更时失败。会话内游标可在不相关会话变更后延续使用；跨会话游标则不能。

默认可搜索全部三种表层（`current`、`shadowed` 和 `log-only`）。传入表层过滤器可缩小范围。

## 来源与索引生命周期

该服务需要 `ctx.sessions`，并动态观察可选的 `ctx.sessionPersistence`。一个串行化状态机比较来源限定的轻量持久化快照修订，仅以不修改日志的方式检查新日志或已更改日志，提取共享语义文档，以事务方式对账变更，然后运行查询。会话查询绝不会调用持久化后端会修复崩溃的 `load()`；检查期间接入的活动所有者无法修改其日志，稳定观察重试使结果优先使用实时来源。TEMP 实时行仍会记录持久化可用性，而持久基库会在该活动所有者脱离后刷新。重复查询以及同一存储未发生变化的重新打开操作不会执行完整持久化日志检查；切换存储，或观察到新增、已更改、已删除或经外部 load 修复的来源时，会在下次稳定观察时对账。来源或事务失败不会提交任何内容，下一次搜索会重试。

`openAt: startup` 是默认值：服务激活会导入 `node:sqlite` 并打开句柄；如果索引无效，则会在服务发布前失败。`openAt: first-search` 会将服务以 ACTIVE 状态发布，同时不导入 SQLite 模块也不打开句柄；首批并发搜索共享同一个就绪 promise，在任何搜索前 dispose（资源释放）服务时也不会导入模块或打开句柄。此模式通过把 SQLite 的实验性警告推迟到首次实际搜索，支持需要干净 Node 22 启动输出的组合；它不会抑制届时的警告。无效数据库同样会使首次搜索失败，而不是服务激活失败。`openAt: never` 为该部署关闭全文搜索：`searchSessions` 和 `searchEvents` 在任何请求规范化之前就以 `SESSION_QUERY_SEARCH_DISABLED` 失败，node:sqlite 绝不会被导入或打开，也不运行任何来源观察或对账，而 `ctx.sessionQuery` 上继承的全部精确读取、过滤和跟踪保持可用。

持久化 FTS 行位于专用派生数据库中。连接本地 TEMP 表保存实时行，这些行会遮蔽同一会话的持久化基库，并在实时所有者消失后使其重新可见。卸载持久化会隐藏持久行，但不会丢弃缓存；重新挂载会对账缓存。关闭或重新打开数据库会删除全部实时覆盖层，但保留持久行。

该数据库虽可丢弃重建，但 reset 操作受到保护：每个已识别 schema 版本都会在修改 journal mode 前拒绝未知用户表；只有包含派生表的已识别不兼容 schema 才会原地重建。不相关数据库或规范数据库将被拒绝。绝不能将 `path` 指向 session-persistence 数据库。在支持 POSIX 权限模式的文件系统上，缺失的目录和数据库会以仅所有者可访问的方式创建（进程 umask 前为 `0700` 和 `0600`），SQLite 伴随文件继承数据库的权限模式；现有权限模式保持不变。每个派生索引路径在一个进程中只能由一个服务拥有；不支持外部写入者或第二个进程，因为世代和 TEMP 遮蔽状态由连接持有。

## 配置

| 键 | 默认值 | 约定 |
|---|---:|---|
| `path` | 必填 | 专用派生索引 SQLite 路径；支持 `:memory:`。在 POSIX 文件系统上，缺失的文件系统路径会以仅所有者可访问的方式创建。 |
| `openAt` | `startup` | `startup` 会在服务激活完成前打开；`first-search` 把 SQLite 模块与句柄推迟到搜索时再加载和打开；`never` 关闭全文搜索（以类型化的 `SESSION_QUERY_SEARCH_DISABLED` 失败），继承的读取保持可用。 |
| `journalMode` | `wal` | `wal`、`delete`、`truncate` 或 `persist`。 |
| `defaultLimit` | `20` | 请求省略 `limit` 时的分页大小；最多为 `Number.MAX_SAFE_INTEGER - 1`。 |
| `maxLimit` | `100` | 接受的最大请求分页大小；最多为 `Number.MAX_SAFE_INTEGER - 1`。 |
| `snippetChars` | `240` | 按 Unicode 码点计算的最大 snippet 长度。 |
| `readWindowMax` | `50` | `before` 或 `after` 的最大原始事件数，用于继承的 `readEvent()`。 |
| `persistedInspectConcurrency` | `4` | 继承批量读取的最大并发持久化日志检查数；必须是正安全整数。 |

## 分词器与限制

该索引使用 FTS5 `unicode61`。取舍是 token/短语召回而非任意子字符串召回：`AI` 不匹配 token `BRAID`。需要执行字面的空白弹性子字符串扫描时，使用 `ctx.sessionQuery.filterEvents()` 并传入 `text` 子句。查询会拒绝 NUL；文档中的保留高亮标记和 NUL 会在索引前被规范化，使展示标记无法与源文本冲突。

中止信号会停止已排队工作，并原样流经快照枚举和非修改式检查。来源工作一旦开始，串行化状态机会自行等待该后端 promise，即使后端忽略取消，之后也会在启动任何进一步的枚举、检查、对账或查询工作前检查信号。因此，调用方只会在已启动后端工作完全停稳后观察到取消，而后续搜索在该清理尚未完成时无法进入 serializer。Node 的同步 `DatabaseSync` API 无法中断已在 JavaScript 线程上执行的元数据或 MATCH 语句；系统会在这些不可抢占调用前后立即检查信号。

## 模型体验

无。该可信搜索后端只向调用方返回命中，不注册面向模型的提示词、schema、工具或消息。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **无调用方授权**：这是上下文范围内的可信服务；模型工具或 UI 必须强制执行自己的访问策略。
- **同步查询执行**：`DatabaseSync` 在 MATCH 执行期间会阻塞 JavaScript 线程，且无法中断已运行的语句。
- **Token 召回，而非任意子字符串**：`unicode61` tokenizer 不会匹配更大 token 中的子字符串；对字面扫描使用 `filterEvents()`。
- **单一所有者的派生索引**：每个索引路径必须仅归一个进程中的一个服务所有；不支持外部写入者和多进程共享。
