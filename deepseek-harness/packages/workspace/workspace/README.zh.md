# @deepseek-ai/dsh-workspace

[English](README.md) | 中文

DeepSeek Harness 的 Workspace 实体注册表（`ctx.workspaceRegistry`）：通过领域数据形式存储持久 workspace 记录、稳定 workspace 顺序和按新到旧排列的候选会话索引。消费方看到 `Workspace` 接口；实体实现保持包私有。

实体／存储理由见[领域 Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)；仅使用头部的引导初始化和 GUI 排序见 [Workspace UI 产品流 Agent Note](../../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.md)。

## 结构

- `ctx.workspaceRegistry.create(path, title?)`：规范化 `path` 时使用 `fs.realpath`，拒绝不存在或非目录的路径，每个规范路径最多创建一条记录，并将新记录前置到持久 workspace 顺序。对同一路径重复调用会返回现有 workspace，且不改变其标题；不同路径可以共用显示标题。
- `ctx.workspaceRegistry.get(id)`/`list()`/`resolveByPath(path)`：由缓存提供的查找。`list()` 为同步操作，并遵循持久注册表顺序；`resolveByPath` 为异步操作，因为它采用相同的 `realpath` 规范化方式，并会拒绝缺失路径，而不是创建路径。
- `ctx.workspaceRegistry.insertBefore(id, before?)`：在持久注册表顺序内移动一个已注册 Workspace，语义类似 DOM 的 insertBefore：插到锚点之前，省略锚点则追加到末尾。来源或锚点不在注册表中时拒绝且不写入；以自身为锚点或移动到当前位置时直接完成且不写入。返回的 id 列表是完整的已提交顺序。
- `ctx.workspaceRegistry.delete(id)`：只移除 Workspace 注册记录、对应的持久顺序条目及会话归属记录。未知 id 返回 `false`，成功移除记录则返回 `true`。目录、用户文件、活跃会话和持久化会话日志绝不受影响，因此相关会话会进入 Ungrouped。表写入失败时会恢复原顺序和此前发布的实体。
- `Workspace.attachSession(id)`：对照 workspace 路径验证实时或已持久化的会话头 cwd，并将新 id 前置。未知会话、缺失／无法解析／非目录的 cwd 值和不匹配情况都会在不写入的前提下被拒绝。`detachSession` 只移除候选索引条目。
- `Workspace.insertSessionBefore(id, before?)`：在手动顺序内移动一个已记账的会话，语义类似 DOM 的 insertBefore：插到锚点之前，省略锚点则追加到末尾。会话或锚点不在记账中时拒绝且不写入；移动到当前位置时直接完成且不写入。注册表中的 Workspace 顺序绝不改变。
- `ctx.workspaceRegistry.archiveSession(id)`/`archivedSessionIds`：覆盖在 workspace 记账之上的注册表级全局归档集合：被归档的会话从各分组视图中消失，但其会话日志和 `sessionIds` 席位保持不变，未来取消归档时可恢复原位置。归档接受任何实时或已持久化的会话（无论已记账还是 Ungrouped），对已归档的 id 直接完成而不写入，并拒绝未知 id。在该字段出现之前写入的状态解析为一个空集合。
- `Workspace.sessionIds`：按持久候选顺序提供同步 id 加规范 cwd 成员投影。缺失头部、无效 cwd 值和不匹配情况都被过滤；下一次 workspace 变更会剪除它们。如果同一存储介质将一个会话索引到两个 workspace 下、用两条记录声明同一路径，或偏离持久 workspace 顺序，启动会被拒绝。
- `Workspace.status()`：未缓存的目录检查，返回 `'ok' | 'missing-dir'`；目录缺失绝不会改动记录。

`storageDomain` 和 `sessionPersistence` 是启动必需依赖。任一依赖服务不可用时，插件保持待处理，且不能提交空的已初始化标记。首次成功启动时，注册表调用 `SessionPersistence.list()`，仅使用头部 `id`、`cwd` 和 `createdAt` 对有效历史目录分组并持久化初始顺序；它绝不读取事件正文。已初始化标记最后写入，因此重启后可安全复用引导初始化期间的部分写入。后续仅能通过 cwd 识别的会话仍属于 Ungrouped。

创建和删除操作会在记录和顺序可能分叉之前，先持久化明确的待处理变更标记。启动时只补全该标记所指明的变更，随后清除标记；没有标记的顺序／表不一致仍属于来源不明的损坏，并会明确报错。删除后重新注册同一路径会生成新的 Workspace id，且不会自动重新接纳保留下来的会话。

## 模型体验

### Workspace 记录与会话记账

#### 模型看到的内容

没有。`ctx.workspaceRegistry` 只向宿主侧消费方提供 workspace 记录：此包不注册工具、不注入提示词、不写入会话事件，因此没有请求字段会携带此包数据。

#### Token 影响

每个请求的直接 token 为零。

#### KV Cache 影响

与实时请求无关：此包绝不触及请求前缀，因此不会使提供方缓存复用失效。

## 已知限制与暂缓事项

- 会话删除与破坏性的文件夹移除是彼此独立且尚未提供的功能；删除 Workspace 注册记录绝不能替代二者（参见[决策记录](../../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md)）。
- 头部索引会在启动时刷新，也会在 attach 必须解析未缓存持久 id 时刷新；另一进程执行的删除或造成的 cwd 损坏会在下次刷新或重启后被发现。
