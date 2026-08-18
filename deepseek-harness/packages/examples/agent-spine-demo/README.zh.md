# @deepseek-ai/dsh-agent-spine-demo

[English](README.md) | 中文

将**默认的不含执行器、不含 UI 的 agent（智能体）主干**作为一个 Cordis 组合包插件。它加载每个 harness agent 所需的固定服务集合，包括本地 skill（技能）提供方，并将循环的 `agents` 列表作为自身配置转发。因此，应用包只需添加入口和可替换后端，就能组合出可工作的 agent。

阅读此包可了解完整插件树及其组合顺序。

## 它加载的插件树

`apply(ctx, config)` 将以下每个插件挂载为组合包 fiber 的子节点：

```
@deepseek-ai/cordis-plugin-timer  timer service (writes nothing to stdout)
@deepseek-ai/dsh-llm              abstract LLM service + content-block vocabulary
@deepseek-ai/dsh-session          event-sourced session log + store
@deepseek-ai/dsh-session-title    log-backed title service + deterministic fallback
@deepseek-ai/dsh-system-prompt    prompt-section + tool-schema assembly
@deepseek-ai/dsh-tools            registry + guarded pre/around/post/final-result pipeline
@deepseek-ai/dsh-skill            skill provider registry
@deepseek-ai/dsh-skill-filesystem      local filesystem skill provider
@deepseek-ai/dsh-agent            agent registry + initiator scope + agent/* events
@deepseek-ai/dsh-goal             optional persisted same-session goal domain
@deepseek-ai/dsh-tool-goal        optional model-facing goal controls
@deepseek-ai/dsh-goal-round-driver     optional same-session goal-round driver
@deepseek-ai/dsh-llm-retry        provider-routed request retry policy
@deepseek-ai/dsh-jobs-local      generic background-job registry
@deepseek-ai/dsh-invariants       configurable invariant registry service
@deepseek-ai/dsh-session/invariant
@deepseek-ai/dsh-agent/invariant
@deepseek-ai/dsh-scope/invariant
@deepseek-ai/dsh-agent-loop/invariant
                                  package-owned relational checks
@deepseek-ai/dsh-tool-bash        the model-facing bash schema (unless toolBash=false)
@deepseek-ai/dsh-agent-instructions  AGENTS.md/CLAUDE.md workspace context loader
@deepseek-ai/dsh-tool-skill       session-prefix skill catalog + model-facing loader schema
@deepseek-ai/dsh-tool-jobs       job_output/job_list/job_kill schemas + completion notices
@deepseek-ai/dsh-agent-loop       THE concrete loop (gets the forwarded `agents`)
                                  (dsh-system-prompt gets the forwarded `persona`)
```

## 有意留在组合包外的组件

主干包含每个入口都共有的全部组件。可替换组件和与入口耦合的组件留在外部，由加载组合包的一方选择：

- **LLM（大语言模型）适配器**：组合包交付抽象 `llm` 服务；叶节点在 `ctx.llm` 上注册具体适配器（`llm-deepseek`、`llm-pi-ai`、`llm-replay`）。
- **基于模型的会话标题提供方**：组合包挂载带可覆盖示例限制的后备服务（5 个词、40 个后备字节、80 个可接受标题字节）；叶节点可以恰好选用一个首消息或全消息 LLM 提供方。
- **bash 执行器**：组合包交付 `tool-bash`（消费方 schema）；叶节点提供 `ctx.shell`（`bash-local` 或沙箱化实现）。
- **非本地 skill 提供方**：组合包交付 skill 注册表、本地文件系统提供方和 `skill` 工具；部署可以把嵌入式目录或远程目录等其他提供方作为同级插件添加。
- **入口与各应用基础设施**：无头、ACP（Agent Client Protocol）和 JSON-RPC 应用包负责传输、stdout 与重新加载选择。`timer` 保留在主干中，因为它是共有组件且不写 stdout。

这里在组合层应用 [Service Definition／Service Provider／Consumer 的职责分离](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)：组合包拥有共享主干，叶节点拥有后端，应用包拥有入口。

## 配置

```ts
import type { Config } from '@deepseek-ai/dsh-agent-spine-demo'
// { agents?, maxParallelToolCalls?, includeHarnessIdentity?, includeRuntimeContext?, persona?, toolOrder?, tools?, dshHome?, sessionTitle?, skills?, workspaceContext, toolBash?, jobs?, toolJobs?, goals?, invariants? }
// workspaceContext requires { maxBytes } or false; the other owner schemas supply defaults.
```

组合包将每个字段转发给拥有它的子节点。应用包提供预创建的 agent：无头和 JSON-RPC 组合会创建 `main`，ACP 应用则在 `session/new` 按需创建 agent。`includeRuntimeContext: false` 会转发给 `dsh-system-prompt`，为新建会话抑制所有动态上下文快照，但不禁用其策略服务。提示词、工具、标题、skill、工作区上下文、不变式、目标和任务设置沿用其所属包记录的 schema 与默认值；`jobs.maxConcurrentJobsPerOwner` 配置本地 Service Provider，并与面向模型的 `toolJobs` 控制工具相互独立。`pickSpineConfig()` 只复制该组合包拥有的字段，`dshHome` 值冲突会在组合时失败。

例如，`{ invariants: { enabled: true, package_allowlist: ['^@deepseek-ai/dsh-'], package_blocklist: ['agent-loop$'] } }` 会让包拥有的配套插件保持挂载，但抑制被阻止的拥有者。Blocklist 匹配优先于 allowlist 匹配；正则表达式与生命周期规则见 [`dsh-invariants`](../../runtime-diagnostics/invariants/README.md)。

## 为何使用代码组合包，而非共享 YAML include

YAML include 可以去重配置，却无法拥有 bin 或提供入口默认值。ACP 应用包默认接出协议纯净的 stdout，但叶节点仍可添加不安全的 logger。组合包子节点把服务注册到根 isolate-keyed store，因此叶节点的同级插件无需依赖加载顺序即可通过注入看到它们。

重试策略可能在新的编号步骤中重复失败的请求。重试状态、提供方错误和失败的部分分片不进入模型历史；每次提供方尝试仍可能产生计费；always 模式没有尝试次数上限；入口从所有已记录步骤推导用量；重建的请求保留先前前缀，以便复用提供方缓存。

## 模型体验

模型通过 `dsh-system-prompt`、`dsh-tool-skill`、`dsh-tool-bash`、`dsh-tools` 和 `dsh-llm-retry` 间接获得体验；还会通过 `dsh-tool-goal` 与 Goal Round 提示词获得体验，前提是启用 `goals`。组合包自身不添加面向模型的包装内容。

#### KV Cache 影响

不会直接失效；上述消费方负责请求前缀的任何变更。

## 已知限制与暂缓事项

- **大部分主干集合固定在代码中**：`apply()` 始终挂载核心服务；配置可以省略组合包内的目标、skill、bash 与任务控制工具，但要替换循环或删除其他主干成员，就必须组合另一个组合包。
- **不变式服务与配套插件仍是固定成员**：`invariants.enabled: false` 或包筛选器会抑制检查，但不会移除服务或配套插件注册；Session 始终启用的校验与冻结是另一套机制。
