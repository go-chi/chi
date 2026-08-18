# @deepseek-ai/dsh-session-persistence-jsonl

[English](README.md) | 中文

JSONL 持久会话存储后端：`SessionPersistence` 的一个具体实现（`dsh-session-persistence` seam）。每个会话有一个仅追加的逻辑 JSONL 日志，默认存储为 `.jsonl.zstd`；禁用压缩时使用原始 `.jsonl`。

## 磁盘布局

```
<root>/
  --<normalized-cwd>--/          # readable project directory (or _no-cwd/)
    <encoded-id>/                # session-owned directory
      session.jsonl.zstd         # default: checksummed header frame + append frames
      session.jsonl              # only with compression: 'none'
```

- 第一个逻辑行是不可变的 `SessionHeader`，标记为 `{ type: 'session', version, id, cwd?, createdAt, parentSession?, seedLength?, origin?, delegationDepth, agentPreset? }`。`delegationDepth` 在磁盘上必需，顶层会话为 `0`；缺失或无效值会拒绝日志。`agentPreset` 必须持久化，因为它决定了被恢复会话的工具与提示词——恢复成另一套组装，就会回放模型已无法据以行动的历史。后续每个逻辑行是一条存储记录；`assistant/chunk` 事件绝不丢弃，且 `seq` 在解码日志中保持连续（`events[i].seq === i`）。
- 存储记录是原样 `SessionEvent` JSON，或在 `packChunks` 已启用且连续段符合条件时写入的**打包分片行**（`text-chunks` / `reasoning-chunks` / `tool-call-chunks`；像 header 的 `session` 一样不带斜杠，因此行 tag 不会与事件类型混淆）：一行保存至少 3 个连续同 block `assistant/chunk` delta 事件，`seq0`/`time0` 和各成员的 `dt` 间隔精确重建每个成员的 `seq`/`time`。无损 codec 位于 `@deepseek-ai/dsh-session`（`packChunkRuns`/`decodeStorageRecord`），并使用精确形态 allowlist：任何未识别内容原样存储。读取与布局无关：`load` 始终解码行，因此打包、非打包和混合文件加载结果一致。
- 项目目录保留规范化 cwd 的可读形式，便于导航，并限制在文件系统组件上限内。分隔符替换和截断刻意有损，因此规范化相同的 cwd 字符串共享项目目录；会话 id 仍选择不同会话目录。在不区分大小写的文件系统上，只有文件系统规范化将两种写法解析到同一 transcript（文本记录）时，身份验证才接受备选路径写法。配置根仍由部署控制：可以是项目本地、共享、临时或集中式。[项目会话目录决策](../../../.agents/notes/implemented/architecture/2026-07-24-project-session-directories.md) 记录这项取舍。
- 会话 id 是未验证的带品牌类型的字符串，因此在使用前单射转义为一个安全路径段（无遍历、无冲突）。结果目录保留给其他会话自有产物；发现只读取固定 transcript 文件名。

## 配置

| 键 | 类型 | 说明 |
|---|---|---|
| `root` | `string`（必需） | 所有会话文件的根目录。**无默认值**：`process.cwd()` 默认值会随进程 cwd 变更（bash 调用、子进程）而分散文件。现有根必须是可读目录；缺失根在第一次实体化时创建。 |
| `packChunks` | `boolean`（默认 `true`） | 将符合条件的 delta 分片连续段写为打包行（在真实编程会话上测得逻辑日志约小 60%）。设为 `false` 可用于每事件一行诊断；无论该写入侧开关如何，都能读取打包行。 |
| `compression` | `'zstd' \| 'none'` | 默认 `'zstd'`；`'none'` 保留换行分隔 UTF-8 文本。 |
| `preparedSessionCacheSize` | 正整数（默认 `5`） | 冷历史检查后保留、供恢复复用的未发布会话数量上限。 |
| `writeBatchMaxDelayMs` | 正整数（默认 `200`） | 空闲的活动事件队列收到待写入事件后开启的固定合并窗口。后续事件不会重置窗口；flush 与 teardown 会绕过它。该值不限制事件循环、串行化操作或后端延迟。最大值为 Node 计时器上限 `2_147_483_647` ms。 |

`locate(meta)` 返回已解析项目/会话目录内固定 transcript 的 `{ kind: 'jsonl', path }`。它不执行文件系统 I/O：可以在目录或文件存在前返回目标，现有文件也只包含最近一次 flush 完成的前缀。

## 物理编码

默认产物是独立 [Zstandard frame](../../../.agents/notes/implemented/architecture/2026-07-19-zstandard-jsonl-session-logs.md) 的标准拼接：一个仅包含 header 行的带 checksum frame，后跟每个持久 append 批次一个带 checksum frame。后端使用 Node 内置 Zstandard API 和默认压缩级别，不提供级别开关。列表只读取并验证 header frame。`compression: 'none'` 在原始表示中保留相同逻辑行。

一个根只属于一种编码。启动发现和定向查找会拒绝相反 suffix，错误会命名不兼容产物，并指示调用方选择匹配 mode 或独立根。平铺 `<project>/<id>.jsonl*` 产物也会被拒绝，而不是忽略。不提供迁移、混合根回退或双写。

## 持久性与崩溃语义

- **绑定存储身份。** 查找要求可读项目目录中只有一个匹配会话目录，然后验证 header id 等于请求 id，且 header id/cwd 派生所选 transcript 路径。列表应用同一路径检查，并拒绝重复 id。身份失败发生在修复或 append 前。
- **延迟实体化。**`create(meta)` 不写入；第一次 `append` 将编码 header 和第一批写入临时文件并执行 `fsync`。POSIX 通过硬链接无覆盖发布，并对父目录 `fsync`。Windows 通过 `MoveFileExW(..., MOVEFILE_WRITE_THROUGH)` 无覆盖发布，并通过同一 write-through pattern 创建缺失目录。已创建但从未 append 的会话不留下磁盘内容，不在 `list` 中。
- **仅追加。** 已 flush 事件绝不重写。后续原始批次 append 行；压缩批次 append 一个 frame。两条路径都执行 `fsync`，并在捕获到写入或同步失败时回滚到之前字节长度。
- **崩溃恢复：保留有效尾部工作。**`load` 验证每个完整压缩 frame，并扫描解压 JSONL。最后 frame 结构不完整时，读取器保留其完整解码记录，从 frame 开头截断，并使用共享[持久化约定](../../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md) 需要的合成工具、步骤和轮次 closer 重新编码这些记录。原始 mode 从第一个不完整行截断。已经存在却没有完整 header frame 的压缩工件、完整 frame 中的 checksum/解压失败，或位于最后已提交的 `turn/end` 处或之前的缺陷都属于损坏，会被拒绝。
- **非修改式检查。**`inspect()` 返回不可变、平衡的逻辑视图，并可在内存中合成恢复 closer，但不会截断不完整尾部或更改轻量修订。
- **连续 seq。**`append` 拒绝第一个 `seq` 不继续已存储日志的批次，并拒绝无法 JSON 序列化的 `event.data`，同时命名违规事件类型。
- **轻量修订。**`listSnapshots(signal?)` 使用 device、inode、size 和纳秒时间戳标识日志，避免解析完整日志；该标识会在 append、修复、替换或存储变更后改变。完整前缀读取要求读取字节前后的身份一致，`readStoredRevision()` 使用同一身份校验保留的 preparation，而不加载日志。快照列表通过产物发现原样转发该信号，并在每个 `stat` 前后检查取消；由于文件系统 `stat` 不可中断，取消会等待活动调用完成，然后在不启动另一次调用的情况下拒绝。

## 写入路径

插件将冻结的会话事件复制到每个活动会话各自的 controller。第一个待处理事件会开启配置的固定批处理窗口，后续事件会加入但不会重置截止时间。窗口到期后会启动一次持久化追加；该次写入期间接纳的事件会形成另一个独立有界的后续批次。`session/flush` 会取消等待并排空当前与待处理批次。每会话游标防止恢复后的会话重新 append 已存储事件，插件加载时会为活动会话设置初始状态。所属后端实例串行化单会话操作；dispose（资源释放）会在拆卸前排空每个保留的 controller。每个逻辑事件都会保留：批处理只让单个压缩帧或一次原始 JSONL fsync 承载更多记录。

## 模型体验

### 恢复的对话历史

#### 模型看到的内容

JSONL 存储不会向当前请求提供提示词或 schema。加载会恢复已存储的表层历史，并保留之前的请求 header 用于重建；新 loop 组合当前 envelope。恢复会用 `TOOL_NOT_STARTED` 平衡没有已持久化调用的 assistant 请求；已持久化调用无结果时则变为 `TOOL_OUTCOME_UNKNOWN`，它要求模型只重试只读或幂等工作，并验证可能的副作用或询问用户。原始 `assistant/chunk` 记录不会重复生成消息。

#### Token 影响

当前请求不会新增 token。恢复后的 agent（智能体）会因保留的历史、当前 envelope，以及每个中断调用中以引用形式加入的修复结果文本而消耗 token。

#### KV Cache 影响

JSONL 存储不修改实时请求前缀。只有重建历史、当前 envelope 和模型路由匹配时，恢复 loop 才能重用提供方缓存；崩溃修复结果仅追加。

## 已知限制与暂缓事项

- **只加载已配置编码和当前 `SESSION_FORMAT_VERSION`（v0）**：更改压缩需要独立/全新根，或选择遗留原始 mode；预发布格式没有迁移。
- **平铺文件存储布局不加载**：加载前使用独立根，或将预发布产物移入项目/会话目录布局。
- **压缩文件不能直接按行读取**：使用后端加载；或在写入新根前选择 `compression: 'none'`，以便外部行 reader 使用。
- **不删除会话文件**：日志在 `root` 下累积，直到外部移除（seam 无删除接口）。
- **每会话一个活动 writer**：append 和修复只在所属后端实例内协调。在所有者完成完全停稳的 dispose 前，其他后端实例或进程不得写入同一会话；初始同 id 发布仍通过 POSIX 无覆盖硬链接或 Windows 无替换 write-through rename 保持冲突安全。
- **POSIX 实体化需要硬链接支持**：第一次 append 使用 `link()`，使同 id 竞态失败，而不覆盖已提交日志；Windows 使用无替换 write-through rename。
