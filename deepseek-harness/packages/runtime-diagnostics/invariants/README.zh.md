# dsh-invariants

[English](README.md) | 中文

用于包自有运行时不变量检查的可配置注册表服务。根插件注册 `ctx.invariants`；它不包含产品检查或产品包导入。每个工作区包都发布一个 `./invariant` 配套入口，用于注册其精确 npm 包名。

## 服务：`InvariantRegistry`（`ctx.invariants`）

```ts
interface Config {
  enabled?: boolean
  package_allowlist?: string[]
  package_blocklist?: string[]
}
```

默认值为 `enabled: true`、`package_allowlist: []` 和 `package_blocklist: []`。只有在服务启用、allowlist 为空或至少一个 allowlist pattern 匹配完整 npm 名称，且没有 blocklist pattern 匹配时，包才被选中。因此，blocklist 匹配优先于 allowlist 匹配。

每个条目都是区分大小写的 JavaScript 正则表达式源，使用 `new RegExp(pattern)` 编译。除非源提供 `^` 和 `$`，否则匹配不锚定；不解析 `/pattern/flags` 语法。同一列表中的空白、带前后空白、无效或重复条目会使服务启动失败。有效 pattern 可以不匹配任何当前已加载包，以使后续加载和 HMR（热模块替换）保持确定性。

`ctx.invariants.register(packageName, installer)` 为完整 npm 包名保留一个活动注册，即使过滤器使其 installer 保持非活动，并返回 disposer。已启用贡献在专用子 Cordis fiber 中运行。installer 可以通过 `installer.inject` 声明所需服务接口，并收到 `fail(message)`；后者抛出绑定到注册包的 `InvariantError`。在注册成功前，系统会等待同步或异步 installer 完成；失败会原子地 dispose（资源释放）子级并释放归属。

服务拥有每个注册 fiber，返回的 disposer 同时属于配套 fiber。卸载任一侧都会移除监听器、跟踪状态和保留。因此，配套入口可以重新加载并注册同一包名，而不保留旧状态。由会话支撑的配套入口从持久事件重建 baseline；仅实时配套入口观察重新加载后开始的操作。

`InvariantError` 扩展 `Error`，携带稳定 `code: 'INVARIANT'`，并公开所属 `packageName`，而不向服务添加产品依赖。

在每个组合中，Session 自身负责不可变且在对外接口层面有效的日志存储：它对每个候选项制作一份无损 JSON 快照，验证引用的源事件是否齐全以及位置替换是否合法，将 `tool/result` 替换限制为一个当前结果的 `content`，深度冻结已接受记录，并通过不可变数组快照公开日志。`dsh-session` 不变量配套入口检查 Session 不负责的其余跨记录规则。

## 包配套入口

发布和注册覆盖全部包；但不会为了覆盖全部包而人为编造运行时断言。只有当包拥有可观察事件关系或相关可变数据关系时，配套入口才安装检查。确认必需方法、插件名称、注入、effect 或固定纯函数结果属于类型、加载或单元测试关注点，而非运行时不变量。

如果不存在合理的运行时关系，配套入口使用空 installer，并以包专用的前置 `No runtime invariant:` 注释说明原因。纯工具、行为已通过其接口包观察的薄实现、仅组合包、二进制程序、需要通过崩溃测试和往返测试验证其约定的持久化适配器和测试支持包通常属于此类。当 owner 获得可变状态或事件协议时，必须重新审视该说明。

当前可执行配套入口保护以下关系：

| 配套入口 | 检查 |
|---|---|
| `dsh-session`、`dsh-agent`、`dsh-scope`、`dsh-agent-loop` | 会话包含关系和调用/结果跟踪、agent（智能体）状态转换、inbox FIFO 守恒、作用域 subject 和模型请求重建。 |
| `dsh-llm`、`dsh-llm-retry`、`dsh-tools`、`dsh-system-prompt` | 流语法、持久重试位置和边界、工具流水线阶段与冻结结果，以及权威提示词组装数据。 |
| `dsh-compaction`、`dsh-hook-protocol`、`dsh-sandbox-policy` | 持久压缩（compaction）与钩子配对、压缩元数据和沙箱 mode 词汇。 |
| `dsh-fs`、`dsh-subagent`、`dsh-workflow` | 文件系统事件身份、提供方/子级配对和工作流/agent 生命周期身份。 |
| `dsh-goal`、`dsh-goal-round-driver` | 持久 goal 来源/内容一致性、修订和生命周期转换、时间戳、依次获准的 Round 和重建的继续提示词。 |
| `dsh-permission-presets`、`dsh-user-approval` | 活动 preset 引用和审批询问/决定审计配对。 |
| `dsh-jobs`、`dsh-tool-todo` | 任务快照生命周期/归属字段和持久整表 todo 结构。 |
| `dsh-time-context` | 持久化时钟读数与会话中正在进行的轮次、下一步骤开始前的位置及已用时间 baseline 一致；渲染时间可解析，且不晚于其事件。 |

每个 owner 的根入口仍独立于诊断。单独加载服务不会安装产品检查；在没有服务时加载配套入口，会等待其声明的 `invariants` 注入。

`pnpm run verify-package-invariants` 发现全部工作区包。它拒绝生成标记、未说明的空 installer、省略或忽略 reporter 的非空 installer、错误注册名称，以及不完整的导出、发布、依赖、TypeScript 引用或 bundle 接线。该源码规则是最低归属检查；聚焦测试证明每个可执行配套入口的语义。

## 组合

```ts
import type { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'

declare const ctx: Context

ctx.plugin(InvariantRegistry, {
  enabled: true,
  package_allowlist: ['^@deepseek-ai/dsh-'],
  package_blocklist: ['^@deepseek-ai/dsh-agent-loop$'],
})
ctx.plugin(SessionInvariant)
```

标准 agent 组合挂载服务和 4 个核心有状态配套入口。自定义组合为希望检查其约定的其他已加载包显式添加配套入口；过滤器可以在不改变包入口的情况下禁用或选择注册。

每个普通 Vitest 拓扑都挂载显式启用的服务和当前测试包的配套入口。聚焦套件覆盖可执行配套入口的合法与违规观测，一个穷尽拓扑则挂载全部配套入口，以证明注册和 dispose 接线。

## 模型体验

无。服务和配套入口观察运行时事件和可变快照，不会更改提示词、消息、schema、流或工具结果。

#### KV Cache 影响

无；不变量检查不组装或发送提供方请求。

## 已知限制与暂缓事项

- 请求重建覆盖 loop 在冻结前显式标记的请求；直接一次性 LLM（大语言模型）调用即使由调用方冻结或附加会话 id，仍不在该标记约定内。
- 仅实时生命周期配套入口无法重建自身重新加载前开始的操作。标准组合和测试组合会在相应操作开始前挂载它们。
- 正则表达式过滤器在服务生命周期内固定；更改它们需要执行普通 Cordis 插件重新加载。
