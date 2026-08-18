# Agent Note: 将简单的一元 API Proxy 调用迁移到业务 Remote 服务

Status: proposed

[English](2026-08-10-unary-apiproxy-remote-migration.md) | 中文

## 问题

Host API Proxy 仍承载许多一元方法。这些方法的实现仅执行服务查找、参数投影、一次业务调用和响应投影。尽管 [Typert Remote 调用](../../implemented/architecture/2026-08-02-typert-remote-method-calls.md)已经允许业务包承载此类调用，这种做法仍会在业务服务、API Proxy 接口、Zod schema、路由表、客户端 stub 和 Client 调用方之间重复定义同一约定。

仅机械迁移方法并不足够。与 Agent 绑定的 API Proxy 方法会调用 `agentFor()`：它复用 live Agent，使用普通冷 Session 中记录的 preset 恢复该 Session，对并发恢复去重，并拒绝由 subagent 拥有的 identity。如果 Remote 方法以不同方式解析 `Agent` 或 `Session`，即使最终业务调用看起来相同，也会改变生命周期行为。

API Proxy 还包含一些不以业务方法为约定的 BFF 操作：Session 生命周期与 transcript（文本记录）组装、模型选择状态、仅限 live 的输入控制、配置过滤、skill（技能）呈现、Host 组合信息和原生桌面操作。有状态交互与流又具有不同的生命周期。若把一元调用的语法一概视为方法简单的依据，就会把产品策略移入任意服务包，或者迫使系统新增没有独立业务所有者的包。

最后，Connection 目前在 API Proxy 回退路径内执行仅限环回地址的特权方法清单。Typert interceptor 会先于该回退路径认领自己的端点，因此，如果迁移凭据或 preset 创作调用时不一并迁移权限检查，受信任的局域网调用方就会获得目前仅向环回调用方开放的操作权限。

## 提案

只迁移符合以下条件的一元调用：其业务操作已经有自然归属的服务，且其余适配只是少量参数或结果投影。当现有方法的签名就是预期的消费方约定时，服务应绑定 Typert namespace，并直接使用 `@Remote` 装饰现有方法。只有执行实质性适配时才有理由新增方法；不得添加只做恒等转发的 `remote*` 包装层。

`@deepseek-ai/dsh-api-remotes/client` 将挂载所选各业务包生成的 `/remote` 贡献。Client 业务包将调用 `ctx.remote.<service>`，并在包内执行归 Client 所有的关联或呈现投影。对应的 API Proxy 接口成员、schema、路由、处理程序、生成的客户端方法、fixture（测试前置数据）实现和生产调用点，将在该服务的纵向提交中一并移除。

大型 BFF 方法仍留在 `dsh-host-apiproxy` 中。如果实现过程中发现某个方法包含端点特有的生命周期策略、大量编排、Client 依赖仅存在于协议层的错误区分，或者其传输数据结构无法用归属方的小型适配器表达，则该方法不在此次迁移范围内。

## 迁移集合

| 旧 RPC | Remote 目标 | Host 方法 | 适配 |
|---|---|---|---|
| `session.rename` | `ctx.remote.sessionTitle`，位于 `@deepseek-ai/dsh-session-title` | `SessionTitleService.rename(Session, title)` | 直接使用 `@Remote`；Client 将 `eventSeq` 映射到自身的标题投影序列。 |
| `command.list`、`command.execute` | `ctx.remote.commands`，位于 `@deepseek-ai/dsh-commands` | `CommandRuntime.list(Agent)`、`execute(Agent, line, signal)` | 直接使用 `@Remote`；Client 将 `undefined` 映射为未匹配结果，并保留调用方的取消行为。 |
| `llm.providers` | `ctx.remote.llm`，位于 `@deepseek-ai/dsh-llm` | `LlmRuntime.listProviders()`、`listConfigurableProviders()` | 两项读取都直接使用 `@Remote`；Client 关联注册行与配置目录行。 |
| `credentials.describe`、`credentials.set`、`credentials.unset` | `ctx.remote.credentials`，位于 `@deepseek-ai/dsh-credentials-local` | `LocalCredentialProvider.describe(ref)`、`set(ref, value)`、`unset(ref)` | 直接使用 `@Remote`；当 UI 请求多个 ref 时，Client 批量发起 `describe` 调用。 |
| `agentPreset.read`、`agentPreset.copy`、`agentPreset.remove` | `ctx.remote.agentPresets`，位于 `@deepseek-ai/dsh-agent-presets` | `readDocument(id)`、`copy(from, id, name?)`、`remove(id)` | `copy` 和 `remove` 直接暴露现有方法；`readDocument` 将存储的内容与一次实时发现取得的元数据组合。 |
| `subagent.interrupt` | `ctx.remote.subagents`，位于 `@deepseek-ai/dsh-subagent` | `interruptByParent(targetSessionId, parentSessionId)` | 适配器构造内部的用户权限变体，不解析也不恢复任一 Agent。 |
| `workspace.list`、`workspace.insertSessionBefore`、`workspace.archiveSession` | `ctx.remote.workspace`，位于 `@deepseek-ai/dsh-workspace` | `snapshot()`、`insertSessionBefore(workspaceId, sessionId, before?)`、`archiveSession(sessionId)` | 注册表适配器分离可变实体，并返回已完成更新的 workspace 或归档快照。 |

Remote API 有意采用服务名称，而不保留旧 RPC 的点分名称。例如，Session 重命名将变为 `ctx.remote.sessionTitle.rename(...)`。

## 暂缓迁移的 API Proxy 领域

| 领域 | 方法 | 保留在 API Proxy 中的原因 |
|---|---|---|
| Session Host 生命周期 | `session.list`、`search`、`create`、`fork` | 跨 Agent 持久化、Workspace 分配、preset 组合和创建策略。 |
| Session transcript | `session.history`、`attachment`、`subagent.history` | cold／live 日志、分页、投影、呈现器和附件授权。 |
| Agent 模型选择 | `session.models`、`selectModel` | 各 Agent 的状态、模型校验和默认值持久化属于 BFF 策略。 |
| Agent 输入与控制 | `session.prompt`、`updateQueue`、`cancel` | 图片准入、Inbox 变更和端点特有的仅限 live 语义。 |
| 配置 Remote | `settings.describe`、`openDocument`、`update`、`replace`、`mutate` | namespace 暴露、脱敏、修订检查和原生打开操作属于产品策略。 |
| Session skill 目录 | `skill.list` | 不得恢复冷 Session；preset 的常驻 scope 和呈现器过滤属于 BFF 关联操作。 |
| Host 运行时信息 | `host.describe` | 版本、cwd、默认模型和当前已附加的 Session 数量来自多个 Host 所有者。 |
| Host 路径打开 | `host.openPath`、`agentPreset.openDocument` | 原生桌面权限和取消属于 Host 组合。 |
| 其余 preset、subagent 和 workspace 调用 | `agentPreset.list`、`select`；`subagent.list`、`history`、`prompt`；`workspace.create`、`rename`、`delete` | 这些调用包含名单策略、live／cold 关联、授权或多项操作的串行执行顺序。 |
| 有状态协议和流式协议 | 审批、问题、响应、mux 和 Host 流 | 它们不是一次请求／一次结果的业务调用。 |

`workspace.delete` 与 `create` 和 `rename` 保持在一起，因为三者都参与同一条串行的创建／命名／删除操作链。单独迁出一个方法会使服务与 API Proxy 观察到不同的操作顺序。

## Agent 与 Session lookup 等价性

`createApiRemoteAgentResolver()` 构造一个 resolver，并将其作为 API Proxy 的 `agentFor` 返回。同一个 closure 通过 `ctx.typert.lookups.configure('agent', ...)`、`ctx.typert.lookups.configure('session', ...)` 和 `ctx.typert.contexts.configureHost('agent', ...)` 安装。因此，Remote `Agent` 或 `Session` 参数与旧版 `agentFor()` 调用共享同一套 live lookup、进行中的恢复表、持久化检查、感知 preset 的 setup 和 ownership fence。

迁移必须用集成测试固定以下结果：

- 直接复用普通的 live Agent，不执行恢复；
- 根据持久化的 header、事件和已记录的 preset setup 恢复普通冷 Session；
- 对同一个 id 并发执行 Agent 与 Session lookup 时，共享同一次恢复；
- 无论 live 还是 cold，由 subagent 拥有的 identity 都会在业务调用前以 `agent-busy` 失败；
- 持久化存储中不存在的 id 以 `session-not-found` 失败；
- resolver 失败会保留现有的 `RpcError`，并通过 `TypertLookupFailure` 传递。

Lookup 策略作用于整个 key，而非特定端点。提示词输入、队列编辑、取消、模型选择和 skill 列表等方法如果使用共享 `agent` 或 `session` lookup，就无法保留仅限 live 或禁止恢复的行为，因此在 Typert 支持显式的逐端点策略之前，这些方法仍留在 API Proxy 中。

签名只包含 branded id 的方法不会调用 Typert 对象 lookup。`subagents.interruptByParent()` 必须保留现有的进程内 Activation lookup 和父级离线行为：它不会调用 `agentFor`、读取目录、检查持久化，也不会冷恢复父 Agent 或子 Agent。

## Client 与错误行为

生成的 Remote 方法返回业务值，并抛出一个 Error，其 `cause` 包含现有的 RPC 失败。Client 业务服务负责适配到当前的结果／store 接口。它们必须像当前一样让成功结果立即生效，使事件帧仍是幂等回放，而非唯一的更新路径。

Resolver 拥有的 `session-not-found` 和 `agent-busy` 错误保持稳定，因为共享 resolver 会抛出 `TypertLookupFailure`。普通业务异常会变成 Gateway 现有的 `internal` RPC 失败。只有在选定的 Client 消费方不根据更具体的旧版业务错误码进行分支时，才能迁移该调用；如果实现过程中发现这种分支，除非业务包新增与传输无关的类型化失败，否则该 RPC 将退出此集合。

## 特权调用权限

Connection 必须在选择 Typert interceptor 或 API Proxy 回退路径之前检查调用方是否有权访问特权端点。该检查必须同时识别旧式点分名称和 Remote 斜杠端点，并保持以下已迁移操作仅限环回地址：

- `agentPresets/readDocument`、`agentPresets/copy` 和 `agentPresets/remove`；
- `credentials/describe`、`credentials/set` 和 `credentials/unset`。

贯穿整个载体的 trusted-host 和 origin 检查保持不变。这是一项非升权要求：端点所有权可以变化，但获准调用该操作的调用方集合不得扩大。

## 提交边界

此次迁移将以一个 RFC 提交、每项服务各一个纵向提交，以及一个最终集成提交落地。服务提交包含其 Host 绑定与装饰器、生成约定所需的包声明、API Remotes 挂载、Client 业务接入，以及移除该服务的旧版 API Proxy 路由和生产客户端调用。服务提交可能暂时无法通过门禁，因为生成产物和共享 fixture 将在最终集成提交中统一调整。

最终提交从干净状态生成所有 `/remote` 产物，更新共享 fixture 和测试，将本文移至 `implemented`，更新中央一元调用所有权发生变化之处仍具权威性的协议文档，并运行选定的仓库门禁。

## 考虑过的替代方案

**将简单方法保留在中央 API Proxy 中。** 这会保留统一的传输外观，但仍会延续 Typert 原本要消除的重复接口、schema、路由行、stub 和业务投影。

**迁移每一个一元 API Proxy 方法。** 一元调用形式并不表示行为只有一个所有者。Session 编排、仅限 live 的控制、配置暴露和原生 Host 操作要么会把 BFF 策略泄漏到通用服务中，要么会产生没有所有者的包。

**为 Remote 方法提供单独的恢复实现。** 第二个 resolver 可能在 preset 恢复、并发去重或 subagent 所有权方面出现偏差。与旧版 `agentFor()` 共享完全相同的 closure，使等价性成为实现事实，而不只是一项承诺。

**保留每一个旧版 RPC 名称和响应 envelope。** 这会使业务包变成旧协议的副本。面向服务的名称和业务值让 Client 负责关联操作，而 Connection 继续负责统一的 RPC envelope。

**依赖 API Proxy 回退路径强制执行特权方法权限。** interceptor 选择会绕过该回退路径，因此这会悄然扩大已迁移方法的权限范围。

## 验收标准

- 迁移表中的每个方法都可通过表中列出的 `ctx.remote` 服务调用，并且不存在生产环境中的旧版 API Proxy 路由、schema、映射表行、客户端 stub 或调用。
- 签名匹配的现有方法直接带有 `@Remote`；每个新增方法都执行表中所述的适配，且不保留只做恒等转发的 `remote*` 包装层。
- Agent／Session 集成测试证明共享 lookup 的各项结果，subagent 中断测试证明不会发生冷恢复。
- 已迁移的特权端点拒绝受信任的非环回调用方，并接受环回调用方，且该判定在任一分发路径运行前完成。
- 每项已迁移调用的 Client 行为和立即提交状态的行为保持等价，包括支持取消之处的取消行为。
- 暂缓迁移的方法及其现有行为仍保留在 API Proxy 上。
- 一次从干净状态开始的生成与构建会生成并消费所选的每项 Remote 贡献，且聚焦测试和最终仓库门禁均通过。

## 风险

移除旧版 schema 也会移除其协议特有的错误分类。如果 Client 中存在依赖其中某个错误码的隐蔽分支，该调用就不是简单调用，必须在接受相应服务提交前发现它。

生成的 Remote 约定会为每个业务包引入构建顺序要求和发布条目。如果遗漏运行时挂载、声明导出、source map 来源、包依赖或 Project Reference 中的任何一项，局部源码测试可能仍会通过，但从干净状态开始的 Client 构建会失败。

将权限强制执行移至复合分发会改变安全敏感的载体代码。测试必须覆盖一个由 Remote 拥有的端点和一个旧版回退端点，确保两条路径都无法绕过环回判定。

本文应用现有 Typert Remote 架构，而非取代它。本文部分取代 [GUI RPC 协议笔记](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)中的中央一元调用所有权和五步扩展检查清单，以及 [Web 配置平面笔记](../../implemented/architecture/2026-07-30-web-config-plane.md)中的中央接线清单；对于已迁移方法之外的 Connection envelope 和配置行为，这些笔记仍具权威性。标题、命令、配置边界、subagent 中断和归档笔记继续负责各自的业务行为，只需如实更新传输相关事实，无需归档。[浏览器信任边界](../../implemented/architecture/2026-07-28-api-browser-trust-boundary.md)和[生成约定构建顺序](../../implemented/process/2026-08-08-api-remotes-generated-contract-build.md)仍具权威性，无需执行归档操作。
