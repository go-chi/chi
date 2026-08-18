# Agent Note: 向工具与钩子公开 agent 会话标识和 JSONL 位置

Status: implemented

[English](2026-07-10-agent-session-identity-and-log-location.md) | 中文

## 问题

agent（智能体）可以通过 `session.header.cwd` 识别其工作区，但使用 bash 的模型无法可靠识别当前调用所属的会话，也无法找到记录该调用的持久 transcript（文本记录）。搜索 `./.sessions` 等同于猜测部署配置和 JSONL 布局；自定义根目录、替代持久化后端、恢复、fork，以及并发运行的父子 agent，都会让这种猜测失效。钩子同样需要 transcript 位置，而未来的插件也可能需要向 shell 命令公开其他由 harness 所有的环境事实。

这项边界必须维持两个属性：事实的所有者决定如何解析该事实；每个子进程接收每次执行的快照，而不是进程级可变全局状态。尤其是嵌套 harness 不能把环境中的 `DSH_*` 值泄漏给当前 agent、持久化后端或配置均可能不同的子进程。

## 决策

在 [`SessionPersistence`](../architecture/2026-06-14-session-persistence.md) seam 上增加同步、无副作用的位置查询：

```ts
import type { SessionHeader } from '@deepseek-ai/dsh-session'

interface SessionLocation {
  readonly kind: string
  readonly path: string
}

interface SessionPersistence {
  locate(meta: SessionHeader): SessionLocation | undefined
}
```

`path` 是该后端为 `meta` 保留的专用日志的本地绝对路径；`kind` 标识其表示形式。JSONL 使用解析后的根目录和路径辅助函数返回 `{ kind: 'jsonl', path }`。SQLite 以及任何无法诚实提供逐会话本地产物的后端均返回 `undefined`。该查询不会创建或刷写任何内容，因此即使文件尚不存在，也可以报告按需创建的目标路径。

面向模型的 bash 包拥有一个 `ctx.shellEnv` 注册表。贡献方声明稳定名称、它可能返回的每个 `DSH_*` 键、每个键的说明，以及 `resolve(execution: ToolExecution)`。贡献方名称重复、键所有权重复、使用保留键、声明格式错误、运行时输出未声明或输出不是字符串时，系统都会明确失败。注册属于 Cordis effect，并随贡献插件的 fiber 一同移除。`list()` 无需运行解析器即可公开声明，从而让环境 API 可供诊断工具和未来的提示词／UI 消费方枚举。

注册表会为每次前台和后台 bash `ToolExecution` 重新构建受信任的覆盖层：

- `DSH_HOME` 始终是配置的 Harness home 绝对路径。独立的 [`@deepseek-ai/dsh-home-paths`](../../../../packages/util/home-paths/README.md) 工具库规定其优先级：显式 `dshHome`，其次是环境中的 `$DSH_HOME`，最后是 `~/.dsh`。
- `DSH_SHELL=1` 始终存在，用于标识由 DeepSeek Harness 管理、面向模型的 bash 子进程。
- 执行具有关联 agent 时，`DSH_SESSION_ID` 存在并等于 `agent.session.header.id`。
- 内置的持久化转换层提供 `DSH_SESSION_JSONL` 的条件是 `ctx.sessionPersistence.locate(header)` 返回 `kind: 'jsonl'`。

会话持久化仍然是事实所有者：JSONL 不依赖 tool-bash，也不会自行注册 shell 变量；钩子继续直接使用 `locate()`。tool-bash 是把持久化事实转换为 shell 约定的转换层。其他需要向 shell 公开事实的插件依赖该注册表，并注册各自的键；它们不修改 `process.env`。

bash seam 导出 `DSH_ENV_PREFIX` 作为唯一的命名空间来源，并派生 `DshEnvironmentKey`，其来源是该常量的 `typeof`。tool-bash 从该常量派生内置名称与模型指引，执行器则使用该常量过滤环境中已有的值。seam 通过 `ShellExecRequest.dshEnv`／`ShellExecSpec.dshEnv` 单独传递受管理的覆盖层：普通 `env` 仍是钩子所用的通用进程内插件接口，`dshEnv` 则以类型约束为受管理键。本地执行器移除环境中继承的全部受管理键，依次应用普通清理、终端环境和显式 `env`，最后合并受信任的 `dshEnv` 快照，因此 `env` 条目永远无法顶掉受管理的值。这保证了值缺失表示它当前确实不存在，而不是从外层或先前的 harness 继承而来。面向模型的工具仍忽略模型提供的 `env`／`stdin` 参数。

bash 工具说明只讲解持久约定：当前 harness 环境事实通过受管理的 `$DSH_*` 变量提供，可以在需要时查看。它不会枚举持久化专用键，也不会添加永久的系统提示词章节。工具 schema 已记录在请求 header 中，工具输出则记录为 `tool/result`，因此无需新增会话事件。

[Claude Code 和 Codex 钩子桥接层](2026-06-30-hook-bridges.md)在构造 payload 时，从同一持久化 seam 解析 transcript 位置。Codex 使用 `transcript_path: string | null`；Claude Code 保留其字符串字段，并回退为 `''`。钩子查询不会物化或刷写会话。

## 同类产品调研

同类产品把稳定标识与物理存储分开处理。Codex 向 spawn 的 shell 注入稳定的 `CODEX_THREAD_ID`，而 recorder 和钩子接口负责提供 transcript 路径。Claude Code 通过结构化的钩子／状态输入提供 `session_id` 和 `transcript_path`。OpenCode 在结构化工具上下文中携带标识；Kimi Code 展开会话占位符；Reasonix 则把活动会话路径保存在控制器上。可移植的规则是：在调用边界注入标识，由存储层解析位置，绝不在并发 harness 中使用进程级的当前会话全局变量。

## 生命周期与持久化语义

新会话在第一个轮次之前获得 id，因此它的首次 bash 调用即可读取 `DSH_SESSION_ID` 和 JSONL 目标。JSONL 文件可能要等到第一次成功的轮次结束检查点后才存在，而且在一个轮次仍未结束时，它只包含上次刷写的前缀。`DSH_SESSION_JSONL` 是位置提示，不是授权凭据或新鲜度保证。

恢复操作复用已加载的 header，因此 id 和位置不变。fork 和 spawn 会创建新的会话 id 与位置。父子调用分别从自己的 `ToolExecution.agent` 解析事实；即使调用重叠，每条命令也会收到不可变快照。替换持久化服务会影响后续收集，因为转换层在执行时查询 `ctx.get('sessionPersistence')`；注册表本身受 effect 作用域约束，并且可安全用于 HMR（热模块替换）。

`dshHome` 是与会话无关的部署上下文。agent-core 通过 `@deepseek-ai/dsh-home-paths` 解析出一个值，并将其同时传给 tool-bash 和本地 skill（技能）发现；独立消费方调用同一解析器。如果顶层 `dshHome` 与 `skills.local.dshHome` 均已提供但解析结果不同，组合会失败，而不会公开互相矛盾的 home。持久化可以独立变更，无需把其事实冻结到会话前缀中。

## 测试

单元测试覆盖注册表声明校验、effect 释放、逐次执行收集、`dshHome` 优先级，以及本地执行器清理并重建 `DSH_*` 的顺序。请求录制测试覆盖前台／后台快照、无 agent 调用、持久化不存在或为 JSONL、忽略模型 `env`，以及父子隔离。JSONL／SQLite 定位器约定测试与两套钩子桥接测试均锁定 transcript 可用和不可用两种方言。

一项无密钥的完整循环集成测试会在第一个轮次驱动真实的 agent loop、JSONL 持久化、tool-bash 与 bash-local。子进程打印 `DSH_HOME`、`DSH_SHELL`、会话 id、JSONL 目标和继承的陈旧哨兵值；测试校验当前值、陈旧变量不存在、刷写前文件不存在，并最终检查持久化 header。快照测试会固定录制请求 header 中的通用 bash 说明。该约定属于确定性的本地执行，不涉及模型选择，因此无需带密钥测试。

## 考虑过的替代方案

**只提供 id，再用 `find`。** 搜索无法得知自定义根目录或后端布局，并且在多会话环境下存在竞态。

**只提供绝对路径。** 路径可能不可用、延迟创建或取决于表示形式，不能作为稳定的会话标识。

**使用全局 `process.env`。** 并发 agent 会互相覆盖，嵌套 harness 也会继承陈旧的当前会话值。

**把持久化说明放入会话前缀。** 活动服务可以在 HMR 或未来的后端切换中改变，而会话前缀保持冻结；持久化专用指引会因此变得陈旧。

**使用类型化 waterfall 事件。** 监听器不运行就无法声明所有权，而后续监听器可以无提示地覆盖键。注册表能在注册时检测键冲突，并且保持可枚举。

**让每个持久化后端直接注册 bash 环境。** 这会反转依赖方向，让存储层依赖某一个消费方，并迫使未使用 bash 的部署也引入它。钩子仍然需要 `locate()`。

**增加面向模型的 `session_info` 工具。** bash 已经提供查询 API，新增工具只会多出 schema 和一次调用；注册表可以扩展至未来的环境事实，无需为每项事实增加一个工具。

## 影响

每个面向模型的 bash 子进程都会收到当前 Harness home 和 shell 标识，关联 agent 的调用还会收到稳定的会话标识。使用 JSONL 后端的调用可以获得可选的目标路径；非文件持久化会如实省略该值。这些子进程中受管理的 `DSH_*` 事实来自 harness：系统移除环境中已有的受管理值、在最后重新加入当前受信任的值，普通调用方的 `env` 条目无法顶掉它们。

该命名空间可被发现，但并非秘密。路径可能泄露配置的根目录，延迟创建的目标也可能不存在或处于陈旧状态，而且命令可以在自己的 shell 语法中覆盖变量。消费方应把这些值视为关联信息和环境事实，在归属关系重要时校验 transcript 元数据，并依靠沙箱／文件系统策略而不是变量保密性来完成授权。
