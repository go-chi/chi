<!-- 英文源文件由 scripts/gen-config-catalog.ts 生成；本中文文件是通过双语配对维护的经评审对侧。
     更新时先运行 `pnpm run gen-config-catalog` 更新英文，再更新本文件并运行 `pnpm run verify-translation-pairing --write docs/config-catalog.md` 重新记录配对。 -->

# 插件配置目录

[English](config-catalog.md) | 中文

每个 `config:` 块均可由 `cordis.yml` 条目设置：针对每个可加载的 harness 包，原样列出其 `apply` 函数或服务构造函数接收的配置声明（包括 JSDoc），并附上所有引用类型——包内类型直接粘贴，其他类型则提供链接。粘贴的内容是插件声明的完整配置类型——运行时 schema 有意排除的字段是仅供运行时使用的 seam（其自身的 JSDoc 会如此说明），不能通过 `cordis.yml` 设置。这是以**部署**为轴的参考文档——插件作者所依据的连接方式请参阅各[子系统页面](subsystems/core.md)中的生成 `cordis-surface` 区域，面向模型的工具 schema 请参阅[工具目录](tool-catalog.md)，而 [subsystems/](subsystems/core.md) 则记录了这些声明所引用的类型。

英文源文件由源代码（`scripts/gen-config-catalog.ts`）生成，并通过 `pnpm run verify-config-catalog`（`doc-sync` 的一部分）验证新鲜度；本中文文件作为经评审对侧通过双语配对维护。声明块使用 `ts config-catalog` 围栏（doc-typecheck 会跳过它，因为单独引用导入项的声明无法独立编译）。英文生成器还会将运行时 schemastery schema 与粘贴的声明进行交叉核对——每个经 schema 验证的键（包括嵌套键）都必须能在声明的配置类型中找到——因此，粘贴内容无法隐藏加载器接受的字段。

`Requires:` 行列出插件通过 `inject` 注入的服务键：其 `cordis.yml` 树还必须加载这些服务的提供者。范围限定为 harness 层级（`packages/`）；配置树还可能加载的 vendored cordis 插件（`hmr`、控制台日志记录器等）固定为上游源代码（参见 [vendoring policy](../vendor/README.md)），未收录于此目录。

<a id="deepseek-aidsh-acp"></a>

## `@deepseek-ai/dsh-acp`

需要：`agents`

```ts config-catalog
/** Plugin config: the provider/model selection used for each ACP-created agent. */
export interface AcpConfig {
  /** Provider route for created agents. */
  provider?: string
  /** Model name for created agents. */
  model?: string
  /** Runtime-only transport override; production uses stdio. */
  stream?: Stream
}
```

依赖：`Stream`（`@agentclientprotocol/sdk`）

来源：[`packages/acp/acp/src/index.ts:71`](../packages/acp/acp/src/index.ts)

<a id="deepseek-aidsh-acp-demo"></a>

## `@deepseek-ai/dsh-acp-demo`

```ts config-catalog
/**
 * App config: the swappable per-deployment values. `provider` and `model` configure
 * each agent the ACP bridge creates at `session/new`; `persona` is the
 * deployment persona (forwarded to the system-prompt plugin); `toolOrder` is
 * the explicit model-facing tool order (forwarded to the system-prompt plugin);
 * `tools` is the tool registry's config (its presentation `mode`, forwarded
 * through agent-spine-demo); `persistenceRoot` is the JSONL backend's directory.
 */
export interface Config {
  /** Provider route for ACP-created agents. */
  provider: string
  /** Model name for ACP-created agents (must have a registered adapter). */
  model: string
  /** Bundled agent-loop concurrency cap; `1` is serial and omission uses its default. */
  maxParallelToolCalls?: number
  /** Deployment persona (the system-prompt plugin's `persona` config). */
  persona?: string
  /** Explicit model-facing tool order (the system-prompt plugin's `toolOrder` config; see dsh-system-prompt). */
  toolOrder?: string[]
  /** Tool-registry config — its presentation `mode` (forwarded through agent-spine-demo; see dsh-tools). */
  tools?: ToolsConfig
  /** DeepSeek Harness home directory exposed to bash and used for local skill discovery. */
  dshHome?: string
  /** Fallback session-title limits forwarded through agent-spine-demo. */
  sessionTitle?: NonNullable<agentCore.Config['sessionTitle']>
  /** Directory for JSONL sessions and the derived query index. Defaults to `./.sessions`. */
  persistenceRoot?: string
  /** Write delta-chunk runs as packed storage rows (the JSONL backend's `packChunks`). Defaults to `true`. */
  packChunks?: boolean
  /** JSONL artifact encoding; defaults to checksummed Zstandard frames. */
  persistenceCompression?: JsonlCompression
  /** Controls automatic AGENTS.md/CLAUDE.md loading; configure a byte budget or set `false`. */
  workspaceContext: agentCore.Config['workspaceContext']
  /** Skill registry, local-provider, and model-facing consumer config forwarded to agent-spine-demo. */
  skills?: agentCore.SkillConfig
  /** Model-facing bash tool config forwarded through agent-core. */
  toolBash?: NonNullable<agentCore.Config['toolBash']>
  /** Process-local background-job admission config forwarded through agent-core. */
  jobs?: NonNullable<agentCore.Config['jobs']>
  /** Generic background-job controls forwarded through agent-core; set false to omit their tools. */
  toolJobs?: NonNullable<agentCore.Config['toolJobs']>
  /** Persisted same-session goals; owner defaults enable them, or false disables the stack and tools. */
  goals?: agentCore.GoalConfig | false
}
```

依赖：[`agentCore`](../packages/examples/agent-spine-demo/src/index.ts) · [`JsonlCompression`](../packages/session/session-persistence-jsonl/src/index.ts) · [`ToolsConfig`](#deepseek-aidsh-tools)

来源：[`packages/examples/acp-demo/src/index.ts:39`](../packages/examples/acp-demo/src/index.ts)

<a id="deepseek-aidsh-agent-default-model"></a>

## `@deepseek-ai/dsh-agent-default-model`

```ts config-catalog
/** Composition entry for the default model selection. */
export interface Config {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
}
```

来源：[`packages/core/agent-default-model/src/index.ts:41`](../packages/core/agent-default-model/src/index.ts)

<a id="deepseek-aidsh-agent-instructions"></a>

## `@deepseek-ai/dsh-agent-instructions`

```ts config-catalog
/** User-facing workspace instruction loader configuration. */
export interface Config {
  /** Harness home containing the fixed user-global `AGENTS.md`; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Directory entries that identify the project root while walking upward from the session cwd. */
  projectRootMarkers?: string[]
  /** UTF-8 byte cap for one rendered baseline or dynamic batch; non-positive or non-finite disables loading. */
  maxBytes: number
  /** Maximum UTF-8 bytes read from one instruction file; larger files are ignored. */
  maxSourceBytes?: number
  /**
   * Ordered same-directory project candidates; every existing file loads, with
   * per-directory trimmed-content duplicates collapsed to the earliest candidate.
   */
  instructionFileCandidates?: string[]
  /**
   * Ordered same-directory local-overlay candidates loaded after the base files
   * under the same per-directory trimmed-content dedup; empty disables the overlay.
   */
  localInstructionFileCandidates?: string[]
}
```

来源：[`packages/context/agent-instructions/src/config.ts:18`](../packages/context/agent-instructions/src/config.ts)

<a id="deepseek-aidsh-agent-loop"></a>

## `@deepseek-ai/dsh-agent-loop`

需要：`agents` · `sessions` · `llm` · `tools` · `systemPrompt`

```ts config-catalog
/** Agent-loop plugin configuration. */
export interface Config {
  /**
   * Maximum parallel-safe calls in flight per agent step. `1` is serial;
   * omission defaults to {@link DEFAULT_MAX_PARALLEL_TOOL_CALLS}.
   */
  maxParallelToolCalls?: number
  /** Agents created or resumed at plugin startup. */
  agents: (AgentOptions & {
    /** Stable config label used in logs and as the fresh combined-id prefix. */
    id: string
    /** Optional stable identity; remounts resume its materialized history, while first use creates it fresh. */
    sessionId?: SessionId
    /** Optional workspace for a fresh session. */
    cwd?: string
    /** Persisted session to resume instead of creating a fresh session. */
    resumeSessionId?: SessionId
  })[]
}
```

依赖：[`AgentOptions`](subsystems/core.md) · [`SessionId`](subsystems/core.md)

来源：[`packages/core/agent-loop/src/index.ts:255`](../packages/core/agent-loop/src/index.ts)

<a id="deepseek-aidsh-agent-presets"></a>

## `@deepseek-ai/dsh-agent-presets`

需要：`loader`

```ts config-catalog
/** Plugin config: which preset is the default, and where presets live. */
export interface Config {
  /** Preset id mounted when a caller names none. Missing at mount time fails loud. */
  default: string
  /** Scanned roots in precedence order; an earlier root wins a duplicate id. */
  roots: PresetRoot[]
  /**
   * Append the harness home's `USER_PRESET_DIR` as a `user` root, after every
   * configured root. False mounts a roster over `roots` alone.
   */
  includeUserRoot: boolean
}

/** One directory scanned for preset subdirectories. */
export interface PresetRoot {
  /** Directory holding one subdirectory per preset; a leading `~` expands. */
  path: string
  /** Trust recorded on every preset discovered under this root. */
  trust: PresetTrust
}

/**
 * Where a preset's composition came from. A `system` preset ships with the
 * deployment; a `user` preset was authored locally, by a person or by an
 * agent, and therefore carries the same trust as shell access.
 */
export type PresetTrust = 'system' | 'user'
```

来源：[`packages/preset/agent-presets/src/preset.ts:52`](../packages/preset/agent-presets/src/preset.ts)

<a id="deepseek-aidsh-agent-spine-demo"></a>

## `@deepseek-ai/dsh-agent-spine-demo`

```ts config-catalog
/**
 * Bundle config: each field forwarded verbatim to the child that owns it —
 * `agents` to the agent loop (an app that pre-creates no agents, like the ACP
 * bridge, simply omits it), `includeHarnessIdentity`, `includeRuntimeContext`,
 * `persona`, and `toolOrder` to the system-prompt plugin (the fixed opener,
 * dynamic-context policy, deployment persona, and explicit model-facing tool
 * order), the `tools` object to the tool registry (its presentation `mode`),
 * `dshHome` to bash environment and local skill discovery, `sessionTitle` to
 * the fallback title service, `skills` to the
 * skill registry/local provider/tool consumer, `workspaceContext` to the
 * agent-instructions loader, `jobs` to the process-local job provider, and
 * `toolBash`/`toolJobs` to the model-facing tool plugins this bundle owns.
 * Provider adapters own their `retryPolicy`; this bundle always mounts its
 * executor.
 * `goals` opts into and configures the persisted goal domain plus its model tool
 * and same-session driver; `invariants` configures global and package-filtered
 * relational checks. Owner schemas supply defaults for optional input;
 * workspace context instead requires an explicit byte budget or `false` because
 * it changes model-visible input. Producer opt-in stays producer-local:
 * `toolBash` configures bash only; independently composed producers keep their
 * own config. Set `toolBash: false` when another plugin owns the model-facing
 * `bash` name.
 */
export interface Config {
  /** The agent-loop `agents` list (see dsh-agent-loop's `Config`). */
  agents?: AgentLoopConfig['agents']
  /** Agent-loop concurrency cap; `1` is serial. */
  maxParallelToolCalls?: AgentLoopConfig['maxParallelToolCalls']
  /** Whether the system prompt includes the fixed Harness identity (default true). */
  includeHarnessIdentity?: SystemPromptConfig['includeHarnessIdentity']
  /** Whether model history includes dynamic runtime-context snapshots (default true). */
  includeRuntimeContext?: SystemPromptConfig['includeRuntimeContext']
  /** The deployment persona (see dsh-system-prompt's `Config`). */
  persona?: SystemPromptConfig['persona']
  /** The explicit model-facing tool order (see dsh-system-prompt's `Config`). */
  toolOrder?: SystemPromptConfig['toolOrder']
  /** The tool registry's config — its presentation `mode` (see dsh-tools' `Config`). */
  tools?: ToolsConfig
  /** DeepSeek Harness home directory shared by shell context and local skill discovery. */
  dshHome?: string
  /** Deterministic fallback and accepted-title limits; omission uses the bundle's example policy. */
  sessionTitle?: SessionTitleConfig
  /** Workspace-context loader controls with an explicit byte budget; set `false` for hermetic prompts. */
  workspaceContext: workspaceContext.Config | false
  /**
   * Skill registry, local provider, and model-facing consumer config.
   * Skills use `enabled` because one nested config controls a provider stack;
   * single model-tool plugins use `Config | false` to disable that one consumer.
   */
  skills?: SkillConfig
  /** Model-facing bash tool config, or false when another plugin owns `bash`. */
  toolBash?: toolBash.Config | false
  /** Process-local background-job admission config. */
  jobs?: JobsConfig
  /** Generic background-job controls; set false to keep the job service without model-facing job tools. */
  toolJobs?: toolJobs.Config | false
  /** Global enablement and package-name filters for invariant companions. */
  invariants?: InvariantConfig
  /** Opt-in persisted same-session goal stack; set false or omit to leave it unmounted. */
  goals?: GoalConfig | false
}

/** Skill bundle config forwarded to the registry, local provider, and model-facing consumer. */
export interface SkillConfig {
  /** Mount the bundled local skill provider and model-facing skill tool (default true). */
  enabled?: boolean
  /** Registry-level discovery cache settings. */
  registry?: SkillRegistryConfig
  /** Local filesystem skill provider settings. */
  filesystem?: SkillFileSystem.Config
  /** Model-facing skill catalog and tool settings. */
  tool?: toolSkill.Config
}

/** Persisted goal domain, model-tool policy, and same-session driver config. */
export interface GoalConfig {
  /** Goal-domain creation defaults. */
  domain?: GoalDomainConfig
  /** Model-facing goal-tool authority policy. */
  tool?: toolGoal.Config
}
```

依赖：[`AgentLoopConfig`](#deepseek-aidsh-agent-loop) · [`GoalDomainConfig`](#deepseek-aidsh-goal) · [`InvariantConfig`](#deepseek-aidsh-invariants) · [`JobsConfig`](#deepseek-aidsh-jobs-local) · [`SessionTitleConfig`](#deepseek-aidsh-session-title) · [`SkillFileSystem`](../packages/skill/skill-filesystem/src/index.ts) · [`SkillRegistryConfig`](#deepseek-aidsh-skill) · [`SystemPromptConfig`](#deepseek-aidsh-system-prompt) · [`toolBash`](../packages/shell/tool-bash/src/index.ts) · [`toolGoal`](../packages/goal/tool-goal/src/index.ts) · [`toolJobs`](../packages/jobs/tool-jobs/src/index.ts) · [`ToolsConfig`](#deepseek-aidsh-tools) · [`toolSkill`](../packages/skill/tool-skill/src/index.ts) · [`workspaceContext`](../packages/context/agent-instructions/src/index.ts)

来源：[`packages/examples/agent-spine-demo/src/index.ts:92`](../packages/examples/agent-spine-demo/src/index.ts)

<a id="deepseek-aidsh-agent-tool-presentation"></a>

## `@deepseek-ai/dsh-agent-tool-presentation`

需要：`tools`

```ts config-catalog
/** Plugin config. */
export interface Config {
  /**
   * The form this agent's model sees. `native` sends every visible schema,
   * `code` sends only `run_code` plus a generated SDK, `both` sends both.
   * Required rather than defaulted: the deployment default is what a preset
   * without this row already gets, so an omitted value would mean the row was
   * composed for nothing.
   */
  mode: ToolPresentationMode
}
```

依赖：[`ToolPresentationMode`](subsystems/tools.md)

来源：[`packages/core/agent-tool-presentation/src/index.ts:38`](../packages/core/agent-tool-presentation/src/index.ts)

<a id="deepseek-aidsh-attachment-local"></a>

## `@deepseek-ai/dsh-attachment-local`

```ts config-catalog
/** Local attachment backend configuration. */
export interface Config {
  /** Explicit harness home; omitted follows `DSH_HOME`, then `~/.dsh`. */
  dshHome?: string
  /** Maximum encoded bytes accepted for one image. */
  maxImageBytes?: number
  /** Maximum image count accepted in one submitted message. */
  maxImagesPerMessage?: number
  /** Maximum aggregate encoded image bytes accepted in one submitted message. */
  maxMessageImageBytes?: number
  /** Maximum intrinsic width multiplied by height accepted for one image. */
  maxImagePixels?: number
}
```

来源：[`packages/attachment/attachment-local/src/index.ts:24`](../packages/attachment/attachment-local/src/index.ts)

<a id="deepseek-aidsh-bash-local"></a>

## `@deepseek-ai/dsh-bash-local`

需要：`subprocess`

```ts config-catalog
/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** Default working directory for commands (default: process.cwd()). */
  cwd?: string
  /** Default foreground timeout in milliseconds. */
  timeoutMs?: number
  /** Upper bound for per-call timeout overrides. */
  maxTimeoutMs?: number
  /** Per-stream in-memory output cap; overflow spills to a temp file. */
  maxOutputBytes?: number
  /** Per-stream spill-file cap; larger streams retain only their in-memory tail. */
  maxSpillBytes?: number
  /** Grace period for kill escalation and inherited pipes; at most `MAX_TIMER_DELAY_MS`. */
  graceMs?: number
}
```

来源：[`packages/shell/bash-local/src/index.ts:41`](../packages/shell/bash-local/src/index.ts)

<a id="deepseek-aidsh-bash-sandbox"></a>

## `@deepseek-ai/dsh-bash-sandbox`

需要：`subprocess` · `sandbox` · `sandboxPolicy`

```ts config-catalog
/**
 * Plugin config: the local executor's knobs, verbatim. The sandbox policy —
 * the default mode and fallback `workspace-write` root — is NOT here: it lives
 * on `ctx.sandboxPolicy` (`@deepseek-ai/dsh-sandbox-policy`), which resolves
 * each calling session's mode and cwd for every enforcing capability. The runner
 * choice is likewise the `ctx.sandbox` provider's config, not this executor's.
 */
export type Config = LocalConfig
```

依赖：[`LocalConfig`](#deepseek-aidsh-bash-local)

来源：[`packages/shell/bash-sandbox/src/index.ts:35`](../packages/shell/bash-sandbox/src/index.ts)

<a id="deepseek-aidsh-client-connection"></a>

## `@deepseek-ai/dsh-client-connection`

需要：`webServer`

```ts config-catalog
/** Plugin config: the deployment's non-loopback serving authorities. */
export interface ConnectionConfig {
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The /api trust fence refuses any
   * request whose Host is neither loopback nor listed here, so a
   * non-loopback (`0.0.0.0`) deployment must declare the names it is reached
   * by (the dsh CLI derives the machine's LAN IP literals itself). An entry
   * that is not a bare, canonical authority fails the plugin load.
   */
  trustedHosts?: string[]
  /** Maximum buffered JSON body for every `/api` request. */
  maxRequestBodyBytes?: number
}
```

来源：[`packages/client/connection/src/index.ts:50`](../packages/client/connection/src/index.ts)

<a id="deepseek-aidsh-client-hmr"></a>

## `@deepseek-ai/dsh-client-hmr`

需要：`clientModuleHost` · `webServer`

```ts config-catalog
/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Bundle stat-poll interval in milliseconds (default 500, the build-side watcher's polling default). */
  pollIntervalMs?: number
}
```

来源：[`packages/client/hmr/src/index.ts:31`](../packages/client/hmr/src/index.ts)

<a id="deepseek-aidsh-code-runtime-worker-thread"></a>

## `@deepseek-ai/dsh-code-runtime-worker-thread`

```ts config-catalog
/** Plugin config: every execution cap, changeable from `cordis.yml` (no hardcoded tunables). */
export interface Config {
  /**
   * Busy-time budget in milliseconds: the run fails with kind `'timeout'`
   * once the worker's MEASURED event-loop active time
   * (`worker.performance.eventLoopUtilization()`) exceeds this. Metering
   * measured busy time — not wall time, not host-side pending-call
   * bookkeeping — is what makes the budget both fair (a program awaiting a
   * slow tool accrues nothing) and ungameable (a hot loop accrues whether
   * or not a decoy dispatch is in flight).
   */
  computeMs?: number
  /**
   * Wall-clock ceiling in milliseconds; never pauses for anything. The
   * backstop for what busy-time cannot see (a program awaiting a promise
   * nobody will resolve). At most `2_147_483_647` (Node's maximum
   * `setTimeout` delay, about 24.9 days): a longer value is rejected at load
   * because `setTimeout` would clamp it to 1 ms.
   */
  maxWallMs?: number
  /**
   * Hard cap for serialized log-array, completion-value, and failure-message payloads;
   * fixed result-envelope syntax is excluded.
   */
  maxOutputBytes?: number
  /** The worker's max old-generation heap in MiB (`resourceLimits`); overflow kills the worker, surfacing as kind `'worker-exit'`. */
  maxOldGenerationSizeMb?: number
}
```

来源：[`packages/code-runtime/code-runtime-worker-thread/src/index.ts:25`](../packages/code-runtime/code-runtime-worker-thread/src/index.ts)

<a id="deepseek-aidsh-compaction-basic"></a>

## `@deepseek-ai/dsh-compaction-basic`

需要：`llm` · `tokenMeter` · `sessions`

```ts config-catalog
/** Basic compaction configuration with an optional exact-target policy table. */
export interface BasicCompactionConfig extends CompactionPolicyConfig {
  /** Exact provider/model overrides; duplicate targets fail plugin load. */
  modelPolicies?: ModelCompactPolicyConfig[]
  /** Enable automatic step-boundary pressure and overflow-recovery listeners. Defaults to `true`. */
  auto?: boolean
}

/** Policy fields shared by the default policy and exact model overrides. */
export interface CompactionPolicyConfig {
  /** Compact at this fraction of the model's context window. Defaults to `0.8`. */
  thresholdRatio?: number
  /** Recent context retained as a fraction of the model's window. Defaults to `0.16`. */
  retainRatio?: number
  /** Absolute recent-context budget; mutually exclusive with `retainRatio`. */
  retainTokens?: number
  /** Summary provider; set together with `summarizationModel`, or inherit the conversation target. */
  summarizationProvider?: string
  /** Summary model; set together with `summarizationProvider`, or inherit the conversation target. */
  summarizationModel?: string
  /** Provider generation cap for summarization. Defaults to `8192`. */
  maxTokens?: number
  /** Extra attempts after the first compaction when pressure remains above threshold. Defaults to `1`. */
  compactionRetries?: number
  /** Maximum retries after canonical context overflow; `0` disables recovery. Defaults to `1`. */
  maxOverflowRetries?: number
}

/** Exact provider/model override merged over the default compaction policy. */
export interface ModelCompactPolicyConfig extends CompactionPolicyConfig {
  /** Registered provider route to match. */
  provider: string
  /** Exact routed model id to match within `provider`. */
  model: string
}
```

来源：[`packages/compaction/compaction-basic/src/types.ts:38`](../packages/compaction/compaction-basic/src/types.ts)

<a id="deepseek-aidsh-compaction-tool-result-pruner"></a>

## `@deepseek-ai/dsh-compaction-tool-result-pruner`

需要：`tokenMeter`

```ts config-catalog
/** Character-budget policy for deterministic tool-result pruning. */
export interface ToolResultPruneConfig {
  /** Prune when total text exceeds this many Unicode code points. Defaults to `8192`. */
  thresholdChars?: number
  /** Maximum leading Unicode code points retained. Defaults to `4096`. */
  headChars?: number
  /** Maximum trailing Unicode code points retained. Defaults to `1024`. */
  tailChars?: number
}
```

来源：[`packages/compaction/compaction-tool-result-pruner/src/types.ts:4`](../packages/compaction/compaction-tool-result-pruner/src/types.ts)

<a id="deepseek-aidsh-cordis-host-runner"></a>

## `@deepseek-ai/dsh-cordis-host-runner`

需要：`tools`

```ts config-catalog
/** Runner configuration. */
export interface Config {
  /** Maximum synchronous VM evaluation time in milliseconds. */
  vmTimeoutMs?: number
}
```

来源：[`packages/extensions/cordis-host-runner/src/index.ts:88`](../packages/extensions/cordis-host-runner/src/index.ts)

<a id="deepseek-aidsh-credentials-local"></a>

## `@deepseek-ai/dsh-credentials-local`

```ts config-catalog
/** Plugin config: file location and hot-reload behavior. */
export interface Config {
  /** Credentials document path; defaults to `.credentials.yaml` under the harness home. */
  path?: string
  /** Harness home used when `path` is omitted; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Watch the document and hot-publish external edits; defaults to true. */
  watch?: boolean
  /** Watcher write-settle window in milliseconds; defaults to 100. */
  debounceMs?: number
}
```

来源：[`packages/credentials/credentials-local/src/index.ts:55`](../packages/credentials/credentials-local/src/index.ts)

<a id="deepseek-aidsh-e2b"></a>

## `@deepseek-ai/dsh-e2b`

```ts config-catalog
/** Configuration for the shared E2B sandbox owner. */
export interface Config {
  /** API key; omission reads `E2B_API_KEY`. It is never forwarded into the sandbox. */
  apiKey?: string
  /** Shared remote working directory, created before adapters receive the sandbox. */
  cwd?: string
  /** E2B sandbox lifetime in milliseconds; expiry always deletes the sandbox. */
  timeoutMs?: number
}
```

来源：[`packages/e2b/e2b/src/index.ts:43`](../packages/e2b/e2b/src/index.ts)

<a id="deepseek-aidsh-fs-local"></a>

## `@deepseek-ai/dsh-fs-local`

```ts config-catalog
/** Configuration for the local filesystem backend. */
export interface Config {
  /** Base directory for relative paths. Defaults to `process.cwd()`. */
  cwd?: string
  /**
   * Exclusive UTF-8 byte limit on each overwrite-diff side, capped by the
   * runtime's safe allocation/decode maximum. Defaults to 10 MiB.
   */
  diffBasisMaxBytes?: number
}
```

来源：[`packages/fs/fs-local/src/index.ts:41`](../packages/fs/fs-local/src/index.ts)

<a id="deepseek-aidsh-fs-sandbox"></a>

## `@deepseek-ai/dsh-fs-sandbox`

需要：`sandboxPolicy`

```ts config-catalog
/**
 * Plugin config: the local backend's knobs verbatim (`cwd` resolution default
 * and `diffBasisMaxBytes` overwrite-presentation bound). The sandbox default
 * (mode + `workspace-write` fallback root) is NOT here — `ctx.sandboxPolicy`
 * resolves each calling session for every enforcing capability.
 */
export type Config = LocalConfig
```

依赖：[`LocalConfig`](#deepseek-aidsh-fs-local)

来源：[`packages/fs/fs-sandbox/src/index.ts:49`](../packages/fs/fs-sandbox/src/index.ts)

<a id="deepseek-aidsh-goal"></a>

## `@deepseek-ai/dsh-goal`

需要：`agents`

```ts config-catalog
/** Deployment defaults for goal creation. */
export interface Config {
  /** Total rounds used when a create request omits its own cap. */
  defaultMaxGoalRounds?: number
}
```

来源：[`packages/goal/goal/src/index.ts:116`](../packages/goal/goal/src/index.ts)

<a id="deepseek-aidsh-headless"></a>

## `@deepseek-ai/dsh-headless`

需要：`agentDefaultModel` · `agents` · `sessions`

```ts config-catalog
/** Plugin config: the task resolved from this app's injected provider service. */
export interface Config {
  /** The prompt text for the single run. */
  task: string
}
```

来源：[`packages/bundle/headless/src/index.ts:31`](../packages/bundle/headless/src/index.ts)

<a id="deepseek-aidsh-hooks-claude-code"></a>

## `@deepseek-ai/dsh-hooks-claude-code`

需要：`bash`

```ts config-catalog
/** Plugin config: where the CC hook config lives + substitution roots. */
export interface Config {
  /**
   * Path to a `hooks.json` or a settings file whose `hooks` key holds the config.
   * Process-level: read once at load, a relative path resolves against the process
   * launch cwd, so one config applies to the whole process.
   * TODO(per-session-hook-config): per-session discovery of a project-local
   * `hooks.json` from each `session/new.cwd`.
   */
  configPath: string
  /**
   * Replaces `${CLAUDE_PLUGIN_ROOT}` in command strings (the plugin's root dir).
   */
  pluginRoot?: string
  /**
   * Replaces `${CLAUDE_PROJECT_DIR}` in command strings AND is exported as the
   * `CLAUDE_PROJECT_DIR` env var for hook processes. When omitted, the env var
   * defaults per-run to the agent's session workspace (`session.header.cwd`, the
   * same dir the hook runs in) — Claude Code always exports this var, and common
   * unmodified hooks reference `$CLAUDE_PROJECT_DIR` for project-relative paths.
   */
  projectDir?: string
  /** Default per-hook timeout in ms when a hook sets none (CC default: 600000). */
  defaultTimeoutMs?: number
  /** Character cap for the `hook/result` event's persisted stderr summary. */
  stderrSummaryMaxChars?: number
}
```

来源：[`packages/hooks/hooks-claude-code/src/index.ts:45`](../packages/hooks/hooks-claude-code/src/index.ts)

<a id="deepseek-aidsh-hooks-codex"></a>

## `@deepseek-ai/dsh-hooks-codex`

需要：`bash`

```ts config-catalog
/** Plugin config: where the Codex hooks.json lives + the model name for payloads. */
export interface Config {
  /**
   * Path to a Codex `hooks.json`. Process-level: read once at load, a relative
   * path resolves against the process launch cwd.
   * TODO(per-session-hook-config): per-session project-local discovery from each
   * `session/new.cwd`.
   */
  configPath: string
  /** The model name stamped on every payload (Codex includes `model` on each event). */
  model?: string
  /** Default per-hook timeout in ms when a hook sets none (Codex default: 600000). */
  defaultTimeoutMs?: number
  /** Character cap for the `hook/result` event's persisted stderr summary. */
  stderrSummaryMaxChars?: number
}
```

来源：[`packages/hooks/hooks-codex/src/index.ts:44`](../packages/hooks/hooks-codex/src/index.ts)

<a id="deepseek-aidsh-host-apiproxy"></a>

## `@deepseek-ai/dsh-host-apiproxy`

需要：`agentDefaultModel` · `agents` · `attachments` · `directoryPicker` · `llm` · `sessions` · `subagents` · `sessionQuery` · `tools` · `userInteraction` · `workspace`

```ts config-catalog
/** Gateway plugin configuration. */
export interface Config {
  /**
   * Whether this deployment can hand paths to a native desktop opener —
   * the `hasDocument` capability the agent-preset roster reports. Absent,
   * the platform is asked (macOS/Windows/WSL yes; Linux only with a display
   * server); set it explicitly where detection misleads, e.g. `false` in a
   * container whose DISPLAY points nowhere a user can see.
   */
  nativeOpen?: boolean
  /**
   * DEFLATE level for every session-log ZIP entry: `0` stores without
   * compression, `1` favors CPU/latency, and `9` favors archive size.
   * @default 6
   */
  sessionExportCompressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  /**
   * Maximum physical size of a cold Session artifact eligible for blankness
   * verification. Zero disables probes.
   * @default 1024
   */
  coldBlankProbeMaxBytes?: number
}
```

来源：[`packages/host/apiproxy/src/index.ts:41`](../packages/host/apiproxy/src/index.ts)

<a id="deepseek-aidsh-host-directory-picker-browse"></a>

## `@deepseek-ai/dsh-host-directory-picker-browse`

```ts config-catalog
/** Validated plugin configuration. */
export interface Config {
  /** Complete-result bound of one listing level; see {@link BrowseDirectoryPicker.Config}. */
  maxEntries: number
}
```

来源：[`packages/host/directory-picker-browse/src/index.ts:181`](../packages/host/directory-picker-browse/src/index.ts)

<a id="deepseek-aidsh-host-frontend-static"></a>

## `@deepseek-ai/dsh-host-frontend-static`

需要：`webServer`

```ts config-catalog
/** Plugin config: the dist anchor. */
export interface Config {
  /** Absolute path of index.html inside the dist root. */
  distIndex: string
}
```

来源：[`packages/host/frontend-static/src/index.ts:28`](../packages/host/frontend-static/src/index.ts)

<a id="deepseek-aidsh-host-webserver"></a>

## `@deepseek-ai/dsh-host-webserver`

```ts config-catalog
/** Gateway config: the listen address. */
export interface Config {
  /** Listen host; the two supported values are loopback and all-interfaces. */
  host: '127.0.0.1' | '0.0.0.0'
  /** Listen port; zero requests an OS-assigned port. */
  port: number
}
```

来源：[`packages/host/webserver/src/index.ts:45`](../packages/host/webserver/src/index.ts)

<a id="deepseek-aidsh-invariants"></a>

## `@deepseek-ai/dsh-invariants`

```ts config-catalog
/** Runtime invariant selection configured on the service plugin. */
export interface Config {
  /** Global switch; defaults to `true`. */
  readonly enabled?: boolean
  /** Case-sensitive JavaScript regex sources that admit package names; empty admits all. */
  readonly package_allowlist?: string[]
  /** Case-sensitive JavaScript regex sources that exclude package names after allowlist matching. */
  readonly package_blocklist?: string[]
}
```

来源：[`packages/runtime-diagnostics/invariants/src/index.ts:15`](../packages/runtime-diagnostics/invariants/src/index.ts)

<a id="deepseek-aidsh-jobs-local"></a>

## `@deepseek-ai/dsh-jobs-local`

```ts config-catalog
/** Configuration for the process-local job registry. */
export interface Config {
  /**
   * Maximum `running` plus `stopping` jobs per exact owner or in the shared unowned bucket;
   * omission defaults to 10.
   */
  maxConcurrentJobsPerOwner?: number
}
```

来源：[`packages/jobs/jobs-local/src/index.ts:31`](../packages/jobs/jobs-local/src/index.ts)

<a id="deepseek-aidsh-llm-deepseek"></a>

## `@deepseek-ai/dsh-llm-deepseek`

需要：`llm`

```ts config-catalog
/**
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the `llm-deepseek` settings-section shape. Every field is optional in
 * yml: a missing API key resolves through {@link Config.apiKeyEnv} at each
 * request (a request without any key fails with `MISSING_CREDENTIAL`, not at
 * plugin load), omitted thinking mode uses the provider default, and omitted
 * reasoning effort resolves to `high`.
 */
export interface Config {
  /** Credential reference (environment-variable name) resolved per request; defaults to `DEEPSEEK_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; falls back to $DEEPSEEK_BASE_URL from a trusted environment layer, then the public API. */
  baseURL?: string
  /** Deployment thinking policy; `disabled` limits every conversation request to `off`. */
  thinking?: 'enabled' | 'disabled'
  /** Default thinking effort (default `high`); `off` disables thinking per request. */
  reasoningEffort?: 'off' | 'low' | 'high' | 'max'
  /** Default per-request output cap (default 256,000); a model's own cap and explicit request values win. */
  maxTokens?: number
  /** Positive context capacity used when the selected model has no exact value (default 1,000,000). */
  defaultContextWindow?: number
  /** Advisory models shown by discovery consumers; defaults to V4 Flash and V4 Pro. */
  models?: DeepSeekCatalogModel[]
  /** Maximum provider idle time while one stream read is outstanding (default five minutes). */
  streamIdleTimeoutMs?: number
  /** Provider-owned model-request retry policy; omission uses normal defaults. */
  retryPolicy?: RetryPolicyConfig
}

/** One optional model entry advertised by the direct-fetch adapter. */
export interface DeepSeekCatalogModel {
  /** Wire model id accepted by the configured endpoint. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Optional selector detail for deployments with similar model variants. */
  description?: string
  /** Known combined request/response context capacity; omitted when deployment metadata is unavailable. */
  contextWindow?: number
  /** Per-request output cap for this model; omission falls back to the profile's {@link DeepSeekConnectionOptions.maxTokens}. */
  maxTokens?: number
}
```

依赖：[`RetryPolicyConfig`](../packages/llm/llm/src/index.ts)

来源：[`packages/llm/llm-deepseek/src/index.ts:62`](../packages/llm/llm-deepseek/src/index.ts)

<a id="deepseek-aidsh-llm-pi-ai"></a>

## `@deepseek-ai/dsh-llm-pi-ai`

需要：`llm`

```ts config-catalog
/** Plugin configuration: the provider routes this instance owns. */
export interface Config {
  /**
   * pi-ai provider routes, keyed by provider. An empty (or omitted) dict is
   * the dormant settings-driven posture: the adapter mounts with no routes
   * and registers them the moment a settings section supplies profiles.
   */
  providers?: Record<string, PiAiProviderProfile>
}

/** Configuration for one pi-ai provider route; the `providers` dict key IS the route. */
export interface PiAiProviderProfile {
  /** Credential reference (environment-variable name) resolved per request through `ctx.credentials`. */
  apiKeyEnv?: string
  /** Name shown by configuration surfaces; defaults to the route key. */
  displayName?: string
  /**
   * Wire protocol every model on this route speaks. Omission keeps each
   * installed catalog model's own protocol, which is why a catalog route needs
   * no protocol at all; a route the catalog does not ship must name one.
   */
  api?: string
  /** Endpoint for this route's models; defaults to the installed catalog's endpoint. */
  baseURL?: string
  /**
   * This route's model catalog. Omission serves the installed catalog for the
   * route unchanged; an explicit list replaces it, each entry defaulting its
   * unset fields from the installed model of the same id.
   */
  models?: PiAiModelProfile[]
  /**
   * Installed-catalog customizations by model id: each entry reshapes that
   * one model with the same fields a {@link models} entry takes, while the
   * rest of the catalog keeps serving untouched. Only meaningful on a catalog
   * route with no `models` list — `models` already replaces the catalog, so
   * an override beside it, on a route the catalog does not ship, or naming a
   * model the catalog does not describe is refused rather than skipped.
   */
  modelOverrides?: Record<string, PiAiModelOverride>
  /**
   * Reasoning-dispatch switches for every `openai-completions` model on this
   * route; each model's own `compat` overrides per field. What neither sets
   * keeps the installed catalog entry's value, then pi-ai's baseURL-derived
   * detection.
   */
  compat?: PiAiCompatProfile
  /**
   * Context capacity for a model this route lists that neither the entry nor
   * the installed catalog sizes (default 262,144). A guess by construction, so
   * a deployment whose gateway serves smaller models corrects it here.
   */
  defaultContextWindow?: number
  /**
   * Output capability for a model this route lists that neither the entry nor
   * the installed catalog sizes (default 32,768). This sizes the model; it
   * never becomes a per-request cap on its own.
   */
  defaultMaxTokens?: number
  /**
   * Request modalities for a model this route lists that neither its entry's
   * {@link PiAiModelProfile.input} nor the installed catalog declares (default
   * `[text]`). A fallback like the capacities above, not an override: a
   * catalog model keeps the modalities the catalog records for it, and this
   * value never narrows one. A gateway serving vision models the catalog does
   * not describe declares `[text, image]` once here instead of on every entry.
   * Unlike an entry's list, this one may not be empty — nothing sits below it
   * to answer instead.
   */
  defaultInput?: PiAiModality[]
  /** Provider request headers; Harness attribution wins reserved names. */
  headers?: Record<string, string>
  /** Provider-neutral pi-ai reasoning level. */
  reasoning?: ModelThinkingLevel
  /** Token budgets used by reasoning providers that support them. */
  thinkingBudgets?: ThinkingBudgets
  /** Prompt-cache retention preference. */
  cacheRetention?: CacheRetention
  /** Streaming transport preference. */
  transport?: Transport
  /** HTTP/provider SDK timeout in milliseconds. */
  timeoutMs?: number
  /** WebSocket connection timeout in milliseconds. */
  websocketConnectTimeoutMs?: number
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs?: number
  /** Provider-owned model-request retry policy; omission uses normal defaults. */
  retryPolicy?: RetryPolicyConfig
}

/** One configured model entry: an id plus the catalog fields it overrides. */
export interface PiAiModelProfile {
  /** Model id sent to the provider and accepted by {@link GenerateOptions.model}. */
  id: string
  /** Display name for selectors; defaults to the catalog name, then the id. */
  name?: string
  /** Maximum combined request and response context in tokens. */
  contextWindow?: number
  /**
   * Maximum output tokens. Configuring one also makes it this model's
   * per-request default; a value inherited from the installed catalog, or the
   * route's fallback, is the model's capability and never becomes a request
   * default on its own.
   */
  maxTokens?: number
  /**
   * Request modalities this model accepts. Absent — or empty, which describes
   * a model that accepts nothing and so states no answer either — keeps the
   * installed catalog entry's modalities, then the route's `defaultInput`.
   * Declaring images is what makes a hand-declared vision model usable, and
   * declaring text alone corrects a catalog model whose gateway does not serve
   * what the catalog records. This is a claim about the endpoint, not a check
   * of it: nothing interrogates a gateway for what it accepts, so a model
   * claiming images its endpoint refuses is refused by the provider instead,
   * mid-turn.
   */
  input?: PiAiModality[]
  /**
   * Selectable reasoning efforts. Absent inherits the installed catalog
   * entry's capability (a hand-declared model has none and does not reason);
   * `false` declares a non-reasoning model, which is how a profile strips
   * reasoning from a catalog model its gateway cannot serve; a non-empty dict
   * declares the offered levels and their wire spellings.
   */
  reasoningEfforts?: false | PiAiReasoningEfforts
  /** Reasoning-dispatch switches for this model, winning over the route's. */
  compat?: PiAiCompatProfile
}

/**
 * Customization of one installed catalog model, keyed by its id in the
 * route's `modelOverrides` dict — the same fields a `models` entry may set,
 * with the id living in the key. Unlike a `models` list, overrides leave the
 * rest of the catalog serving untouched, which is what makes "correct one
 * model, keep the other thirty-seven" a three-line edit.
 */
export type PiAiModelOverride = Omit<PiAiModelProfile, 'id'>

/**
 * Reasoning-dispatch compatibility switches, set on the route (its models'
 * default) or per model (winning over the route). Only the switches pi-ai's
 * reasoning dispatch reads are offered; the rest of pi-ai's compat surface
 * keeps its baseURL-derived auto-detection. pi-ai types both fields only on
 * `OpenAICompletionsCompat` — the other wire protocols define their reasoning
 * fields in the protocol itself — so resolution rejects a model-level switch
 * anywhere else, while a route-level default skips past models it cannot fit.
 */
export interface PiAiCompatProfile {
  /** Reasoning parameter format the endpoint expects; absent keeps the catalog entry's, then pi-ai's baseURL-derived guess. */
  thinkingFormat?: PiAiThinkingFormat
  /** Whether the endpoint accepts `reasoning_effort`; absent keeps the catalog entry's, then pi-ai's baseURL-derived guess. */
  supportsReasoningEffort?: boolean
}

/** One request modality a pi-ai model may accept. */
export type PiAiModality = Model<Api>['input'][number]

/**
 * Selectable reasoning efforts for one model: each key is a level the model
 * offers (and selectors show), and its value is the wire spelling dispatch
 * sends for it. `off` alone may leave its value empty — "supported, send
 * nothing" — because for most providers not thinking is the parameter's
 * absence; every other declared level must name a wire value. A level absent
 * from the dict is not offered.
 */
export type PiAiReasoningEfforts = Partial<Record<ModelThinkingLevel, string | null>>

/** One reasoning-dispatch wire format a profile may name. */
export type PiAiThinkingFormat = Exclude<PiThinkingFormat, WithheldThinkingFormat>

/** The `compat.thinkingFormat` spellings pi-ai accepts on an `openai-completions` model. */
type PiThinkingFormat = NonNullable<OpenAICompletionsCompat['thinkingFormat']>

/**
 * pi-ai thinking formats a profile cannot name: both drive the request through
 * `chatTemplateKwargs`, which this configuration does not expose.
 */
type WithheldThinkingFormat = 'chat-template' | 'qwen-chat-template'
```

依赖：`Api`（`@earendil-works/pi-ai`）· `CacheRetention`（`@earendil-works/pi-ai`）· `Model`（`@earendil-works/pi-ai`）· `ModelThinkingLevel`（`@earendil-works/pi-ai`）· `OpenAICompletionsCompat`（`@earendil-works/pi-ai`）· [`RetryPolicyConfig`](../packages/llm/llm/src/index.ts) · `ThinkingBudgets`（`@earendil-works/pi-ai`）· `Transport`（`@earendil-works/pi-ai`）

来源：[`packages/llm/llm-pi-ai/src/config.ts:172`](../packages/llm/llm-pi-ai/src/config.ts)

<a id="deepseek-aidsh-llm-replay"></a>

## `@deepseek-ai/dsh-llm-replay`

需要：`llm`

```ts config-catalog
/** Plugin config: the {@link ReplayConfig} inputs, each defaulting to its `DSH_SNAPSHOT_*` env var in `apply`. */
export interface Config {
  /** Override the fixture path; defaults to `$DSH_SNAPSHOT_FILE`. */
  file?: string
  /** Override the sidecar path; defaults to `$DSH_SNAPSHOT_OVERRIDE`. */
  overrideFile?: string
  /**
   * Override the child-log paths; defaults to `$DSH_SNAPSHOT_CHILD_FILES` (a
   * path-separator-delimited list). Each is a recorded subagent session log for
   * a nested-agent scenario; absent/empty for a single-session scenario.
   */
  childFiles?: string[]
  /** Optional replay-only provider catalog; absent or empty selects catch-all waterfall replay. */
  providers?: ReplayProviderConfig[]
  /** Optional per-chunk pacing delay in ms (see {@link ReplayConfig.paceMs}); absent keeps burst yield. */
  paceMs?: number
}

/** One provider route exposed by the replay adapter. */
export interface ReplayProviderConfig {
  /** Provider route used for replay requests. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Advisory models exposed to replay scenarios that exercise discovery. */
  models?: ReplayModelConfig[]
  /** Optional provider-owned retry policy used by assembled recovery snapshots. */
  retryPolicy?: RetryPolicyConfig
}

/** One model exposed by a replay-only provider catalog. */
export interface ReplayModelConfig {
  /** Model id used for replay requests. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Optional selector description. */
  description?: string
  /** Optional positive integer context capacity published by the replay adapter. */
  contextWindow?: number
  /** Optional declared input modalities, so a scenario can exercise capability gates (e.g. image-capable `read_image`). */
  inputModalities?: readonly ModelModality[]
  /**
   * Optional per-request output cap the replay route materializes when callers
   * omit one, so replay reconstructs the request header a live catalog produced.
   */
  defaultMaxTokens?: number
  /** Optional reasoning-effort ids the replay route accepts, in display order. */
  reasoningEfforts?: string[]
  /**
   * Optional effort materialized when callers omit one; must appear in
   * {@link reasoningEfforts} or call resolution rejects the route.
   */
  defaultReasoningEffort?: string
}
```

依赖：[`ModelModality`](../packages/llm/llm/src/index.ts) · [`RetryPolicyConfig`](../packages/llm/llm/src/index.ts)

来源：[`packages/test-support/llm-replay/src/index.ts:776`](../packages/test-support/llm-replay/src/index.ts)

<a id="deepseek-aidsh-llm-retry"></a>

## `@deepseek-ai/dsh-llm-retry`

需要：`agents`

```ts config-catalog
/** This policy executor has no config; providers own `retryPolicy`. */
export type Config = Readonly<Record<string, never>>
```

来源：[`packages/llm/llm-retry/src/index.ts:24`](../packages/llm/llm-retry/src/index.ts)

<a id="deepseek-aidsh-lsp-stdio"></a>

## `@deepseek-ai/dsh-lsp-stdio`

需要：`fs` · `lsp` · `subprocess`

```ts config-catalog
/** Plugin configuration: provider id → local language-server configuration. */
export interface Config {
  /** Non-empty table of stable provider ids to independent local server configurations. */
  servers: Record<string, LspLocalServerConfig>
}

/** One configured local language server and its host bounds. */
export interface LspLocalServerConfig {
  /** Executable to spawn (absolute, or resolved on PATH at load). */
  command: string
  /** Lowercase leading-dot extension → LSP language id (e.g. `{ '.ts': 'typescript' }`). */
  extensionToLanguage: Record<string, string>
  /** Arguments passed to the executable (no shell). Default `[]`. */
  args?: string[]
  /** Extra env vars merged on top of the scrubbed ambient env. Default `{}`. */
  env?: Record<string, string>
  /** Static `initialize` options forwarded to the server. Default `null`. */
  initializationOptions?: unknown
  /** Static answer to every `workspace/configuration` item. Default `null`. */
  configuration?: unknown
  /** Largest single framed message accepted from the server (bytes). Default 16000000. */
  maxMessageBytes?: number
  /** Largest stderr tail retained for diagnostics (bytes). Default 1000000. */
  maxStderrBytes?: number
  /** Largest source file this host will open (bytes). Default 4000000. */
  maxDocumentBytes?: number
  /** Graceful `shutdown`/`exit` budget before escalation (ms). Default 5000. */
  shutdownTimeoutMs?: number
  /** Request-cancel and SIGTERM→SIGKILL grace (ms). Default 2000. */
  killGraceMs?: number
}
```

来源：[`packages/lsp/lsp-stdio/src/index.ts:82`](../packages/lsp/lsp-stdio/src/index.ts)

<a id="deepseek-aidsh-mcp-client"></a>

## `@deepseek-ai/dsh-mcp-client`

需要：`tools`

```ts config-catalog
/** Configuration for one stdio or Streamable HTTP MCP server. */
export type Config = StdioConfig | StreamableHttpConfig

/** Config for connecting to an MCP server via a spawned child process over stdio. */
export interface StdioConfig {
  /** Selects child-process stdio transport. */
  transport: 'stdio'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live mcp-client instances.
   */
  serverName: string
  /** Executable used to start the server. */
  command: string
  /** Arguments passed directly, without shell interpolation. */
  args: string[]
  /** Extra env vars merged on top of scrubbed ambient env. */
  env: Record<string, string>
  /** Working directory for the child process. */
  cwd: string
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/** Config for connecting to an MCP server over Streamable HTTP (SSE). */
export interface StreamableHttpConfig {
  /** Selects Streamable HTTP transport. */
  transport: 'streamable-http'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live mcp-client instances.
   */
  serverName: string
  /** MCP endpoint URL. */
  url: string
  /** Additional headers attached to MCP requests. */
  headers: Record<string, string>
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/** Automatic reconnect policy for one MCP server connection. */
export interface ReconnectConfig {
  /** Reconnect automatically after a lost connection (default true). */
  enabled?: boolean
  /** First reconnect delay in milliseconds; doubles per consecutive failed attempt (default 500). */
  initialDelayMs?: number
  /** Backoff ceiling in milliseconds; also the uptime after which the attempt budget resets (default 30000). */
  maxDelayMs?: number
  /** Consecutive failed attempts per outage before giving up for good (default 10). */
  maxAttempts?: number
}
```

来源：[`packages/mcp/mcp-client/src/index.ts:98`](../packages/mcp/mcp-client/src/index.ts)

<a id="deepseek-aidsh-message-feedback"></a>

## `@deepseek-ai/dsh-message-feedback`

需要：`storageDomain` · `sessionPersistence` · `sessions`

```ts config-catalog
/** Required deployment policy for optional notes. */
export interface Config {
  /** Maximum UTF-8 byte length accepted for one note. */
  readonly maxNoteBytes: number
}
```

来源：[`packages/feedback/message-feedback/src/index.ts:49`](../packages/feedback/message-feedback/src/index.ts)

<a id="deepseek-aidsh-permission-presets"></a>

## `@deepseek-ai/dsh-permission-presets`

需要：`bash` · `approval` · `sessions`

```ts config-catalog
/** The {@link PermissionPresetService} config: preset table and composition default. */
export interface Config {
  /**
   * The preset table: name → knob bundle. Defaults to `workspace-write`
   * (workspace-write + ask) and `danger-full-access` (danger-full-access +
   * never). The name `custom` is reserved for the derived not-a-preset state.
   */
  presets?: Record<string, PresetSpec>
  /**
   * Default for new sessions. When omitted, the preset matching the composed
   * sandbox and approval defaults is used.
   */
  defaultPreset?: string
}

/** One preset's sandbox/approval bundle and optional client presentation. */
export interface PresetSpec {
  /** The `sandbox/mode` value the preset writes through. */
  sandbox: SandboxMode
  /** The `approval/policy` value the preset writes through. */
  approval: ApprovalPolicy
  /** The display label a client shows for this preset; the raw table key when omitted. */
  name?: string
  /** One user-facing sentence on what the preset means; omitted when not configured. */
  description?: string
}
```

依赖：[`ApprovalPolicy`](subsystems/approval.md) · [`SandboxMode`](subsystems/sandbox.md)

来源：[`packages/interaction/permission-presets/src/index.ts:140`](../packages/interaction/permission-presets/src/index.ts)

<a id="deepseek-aidsh-persona"></a>

## `@deepseek-ai/dsh-persona`

需要：`systemPrompt`

```ts config-catalog
/** Plugin config: the persona text this composition contributes. */
export interface Config {
  /**
   * Persona prose rendered as the `deployment:persona` section. A template:
   * complete `{{…}}` groups interpolate strictly against registered prompt
   * variables. Empty text drops the section at render, matching the registry.
   */
  text: string
  /** Make this persona the complete system prompt, suppressing every other section. */
  complete?: boolean
  /** Suppress dynamic runtime-context snapshots for this persona's agent scope. */
  includeRuntimeContext?: boolean
}
```

来源：[`packages/preset/persona/src/index.ts:34`](../packages/preset/persona/src/index.ts)

<a id="deepseek-aidsh-plan-mode"></a>

## `@deepseek-ai/dsh-plan-mode`

需要：`tools` · `systemPrompt`

```ts config-catalog
/** Deployment-owned plan guidance. */
export interface PlanModeConfig {
  /** Guidance rendered as the `plan:policy` prompt section while plan mode is active. */
  section: string
}
```

来源：[`packages/plan/plan-mode/src/index.ts:70`](../packages/plan/plan-mode/src/index.ts)

<a id="deepseek-aidsh-pwsh-local"></a>

## `@deepseek-ai/dsh-pwsh-local`

需要：`subprocess`

```ts config-catalog
/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** Default working directory for commands (default: process.cwd()). */
  cwd?: string
  /** Default foreground timeout in milliseconds. */
  timeoutMs?: number
  /** Upper bound for per-call timeout overrides. */
  maxTimeoutMs?: number
  /** Per-stream in-memory output cap; overflow spills to a temp file. */
  maxOutputBytes?: number
  /** Per-stream spill-file cap; larger streams retain only their in-memory tail. */
  maxSpillBytes?: number
  /** Grace period for kill escalation and inherited pipes; at most `MAX_TIMER_DELAY_MS`. */
  graceMs?: number
  /**
   * Explicit pwsh executable. When omitted, well-known Windows install
   * locations and PATH entries are probed in order (PowerShell 7 install,
   * PATH entries such as the Microsoft Store install, then Windows
   * PowerShell 5.1), falling back to a bare `pwsh` resolved through PATH.
   */
  pwshPath?: string
}
```

来源：[`packages/shell/pwsh-local/src/index.ts:58`](../packages/shell/pwsh-local/src/index.ts)

<a id="deepseek-aidsh-pwsh-sandbox"></a>

## `@deepseek-ai/dsh-pwsh-sandbox`

需要：`subprocess` · `sandbox` · `sandboxPolicy`

```ts config-catalog
/**
 * Plugin config: the local executor's knobs, verbatim. The sandbox policy —
 * the default mode and fallback `workspace-write` root — is NOT here: it lives
 * on `ctx.sandboxPolicy` (`@deepseek-ai/dsh-sandbox-policy`), which resolves
 * each calling session's mode and cwd for every enforcing capability. The
 * runner choice is likewise the `ctx.sandbox` provider's config, not this
 * executor's.
 */
export type Config = LocalConfig
```

依赖：[`LocalConfig`](#deepseek-aidsh-pwsh-local)

来源：[`packages/shell/pwsh-sandbox/src/index.ts:40`](../packages/shell/pwsh-sandbox/src/index.ts)

<a id="deepseek-aidsh-repeat-tool-reminder"></a>

## `@deepseek-ai/dsh-repeat-tool-reminder`

```ts config-catalog
/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud: an empty
 * `thresholds` list, a non-integer, a value below 2, or a duplicate throws at
 * plugin load, never a silent fall-back). `include`/`exclude` entries are
 * `*`-wildcard predicates over tool names at call time, not references to
 * registry entries — a pattern matching no currently registered tool is valid
 * (`exclude: [mcp_*]` must stay legal in a deployment that loads no MCP tools).
 */
export interface Config {
  /** Consecutive-repeat counts that trigger a reminder (default `[3, 5, 8]`). */
  thresholds?: number[]
  /** Tool-name patterns to track; empty means every tool is tracked. */
  include?: string[]
  /** Tool-name patterns transparent to the chain (neither count nor reset). */
  exclude?: string[]
  /**
   * Maximum characters of canonical arguments quoted in the DETAILED reminder
   * (default 500). Large payloads (a `write` body, a long command) would
   * otherwise ride into the next request unbounded — precisely in a loop
   * scenario; the cap bounds the reminder, never the detection (the chain key
   * always compares the FULL canonical string).
   */
  argumentsPreviewChars?: number
}
```

来源：[`packages/guard/repeat-tool-reminder/src/index.ts:28`](../packages/guard/repeat-tool-reminder/src/index.ts)

<a id="deepseek-aidsh-sandbox-local"></a>

## `@deepseek-ai/dsh-sandbox-local`

```ts config-catalog
/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface Config {
  /**
   * Override the runner argv; bwrap-compatible profile arguments are appended. A
   * non-empty override asserts full enforcement and skips built-in selection and
   * probing. A runner that starts but refuses its profile must be identifiable by
   * {@link runnerFailureSignatures}. Consumers classify a spawn rejection only after
   * confirming the workdir is usable. `ENOENT` or `EACCES` identifies the runner when
   * `error.path` equals argv[0] and `error.syscall` is `spawn` or `spawn <runner>`, or
   * when `error.path` is absent and `error.syscall` is exactly `spawn <runner>`.
   */
  runnerCommand?: string[]
  /**
   * Case-insensitive stderr substrings emitted when a configured
   * {@link runnerCommand} refuses its profile before executing the wrapped
   * command. Required and non-empty with `runnerCommand`; rejected without
   * it. Each entry is a non-empty, single-line, case-insensitive substring
   * covering the executable runner's own failure dialect.
   */
  runnerFailureSignatures?: string[]
  /** Positive timeout for each functional probe; zero would mean unbounded to Node. */
  probeTimeoutMs?: number
}
```

来源：[`packages/sandbox/sandbox-local/src/index.ts:44`](../packages/sandbox/sandbox-local/src/index.ts)

<a id="deepseek-aidsh-sandbox-policy"></a>

## `@deepseek-ai/dsh-sandbox-policy`

```ts config-catalog
/**
 * Plugin config: the deployment's sandbox default. All optional — `Config`
 * supplies the defaults (`mode: 'read-only'` is the fail-safe default; a
 * deployment that wants a workspace-writable agent opts in explicitly). The
 * runner choice is NOT here (it is the `ctx.sandbox` provider's config), nor
 * is any per-family knob: this is the one shared policy home.
 */
export interface Config {
  /** File-sandbox mode a session starts from (default: `read-only`). */
  mode?: SandboxMode
  /**
   * Fallback root for agentless calls and sessions without a cwd (default:
   * `process.cwd()`). Normal agent calls use their session cwd instead.
   */
  workspaceRoot?: string
}
```

依赖：[`SandboxMode`](subsystems/sandbox.md)

来源：[`packages/sandbox/sandbox-policy/src/index.ts:67`](../packages/sandbox/sandbox-policy/src/index.ts)

<a id="deepseek-aidsh-sdk-jsonrpc-server"></a>

## `@deepseek-ai/dsh-sdk-jsonrpc-server`

需要：`agents`

```ts config-catalog
/** JSON-RPC deployment config plus runtime-only test hooks. */
export interface JsonRpcConfig {
  /** Report max-token turn/subagent termination as a successful SDK result. */
  maxTokensAsSuccess?: boolean
  /** Transport input override; production uses `process.stdin`. */
  input?: Readable
  /** Transport output override; production uses `process.stdout`. */
  output?: Writable
  /** Process-exit override; production uses `process.exit`. */
  exit?: (code: number) => void
}
```

依赖：`Readable`（`node:stream`）· `Writable`（`node:stream`）

来源：[`packages/sdk/server/src/index.ts:29`](../packages/sdk/server/src/index.ts)

<a id="deepseek-aidsh-session-persistence-jsonl"></a>

## `@deepseek-ai/dsh-session-persistence-jsonl`

需要：`sessions`

```ts config-catalog
/** Plugin config: where the JSONL backend keeps its session logs, and the packed-row write switch. */
export interface Config {
  /**
   * Root directory for all session files. Required (no default): a default of
   * `process.cwd()` would scatter session files as the process's cwd changes
   * (bash calls, subprocesses). Sessions group under human-readable project
   * directories, then per-session directories. An existing root must be a
   * readable directory; an absent root is created on first materialization.
   */
  root: string
  /**
   * Write runs of consecutive `assistant/chunk` delta events as packed
   * `text-chunks`/`reasoning-chunks`/`tool-call-chunks` rows (lossless,
   * ~60% smaller logs measured on a real session). Defaults to true; false
   * keeps one `SessionEvent` per line for diagnostics. Reading packed rows is
   * unconditional: a log's layout never depends on this switch.
   */
  packChunks?: boolean
  /** Physical encoding; defaults to checksummed Zstandard frames. */
  compression?: JsonlCompression
  /** Maximum cold Session preparations retained for history-to-resume reuse. */
  preparedSessionCacheSize?: number
  /** Fixed live-event coalescing window; not a backend completion deadline. */
  writeBatchMaxDelayMs?: number
}

/** Physical encoding selected for JSONL session artifacts. */
export type JsonlCompression = 'zstd' | 'none'
```

来源：[`packages/session/session-persistence-jsonl/src/index.ts:60`](../packages/session/session-persistence-jsonl/src/index.ts)

<a id="deepseek-aidsh-session-persistence-sqlite"></a>

## `@deepseek-ai/dsh-session-persistence-sqlite`

需要：`sessions`

```ts config-catalog
/** Plugin configuration. */
export interface Config {
  /**
   * Filesystem path to the SQLite database file. The special value `:memory:`
   * opens an in-process database (tests). On filesystems with POSIX modes,
   * missing directories and databases are created owner-only; existing path
   * modes are preserved. Filesystem setup errors other than an existing database
   * fail initialization. The backend does not protect confidentiality or
   * integrity when another principal can replace the database entry in its
   * parent directory.
   */
  path: string
  /**
   * SQLite `journal_mode` pragma. `wal` (the default) is the recorded
   * durability model; pick a rollback-journal mode (`delete`/`truncate`/
   * `persist`) on filesystems where WAL's shared-memory files do not work
   * (network mounts). See {@link JournalMode}.
   */
  journalMode?: JournalMode
  /** Maximum cold Session preparations retained for history-to-resume reuse. */
  preparedSessionCacheSize?: number
  /** Fixed live-event coalescing window; not a backend completion deadline. */
  writeBatchMaxDelayMs?: number
}

/**
 * Journal modes the backend will run under. `wal` is the default and the
 * durability model the persistence ADR records; the rollback-journal modes
 * (`delete`/`truncate`/`persist`) exist for filesystems where WAL's
 * shared-memory files do not work (network mounts). `memory`/`off` are
 * excluded: dropping journal durability silently contradicts what this
 * backend promises.
 */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'
```

来源：[`packages/session/session-persistence-sqlite/src/index.ts:70`](../packages/session/session-persistence-sqlite/src/index.ts)

<a id="deepseek-aidsh-session-projection-cache"></a>

## `@deepseek-ai/dsh-session-projection-cache`

需要：`storageDomain` · `sessionProjections` · `sessionPersistence` · `sessions`

```ts config-catalog
/**
 * Plugin config. Both throttle triggers are deployment choices with no
 * universally correct value, so the composition states them explicitly
 * (cordis.yml); the two mandatory write points (`turn/end` and session
 * disposal) are policy, not tunables, and always fire.
 */
export interface Config {
  /** Committed events per session that force a durable checkpoint write between mandatory points. */
  writeEveryEvents: number
  /** Longest time (milliseconds) a dirty checkpoint may stay unwritten between mandatory points. */
  writeIntervalMs: number
}
```

来源：[`packages/session/session-projection-cache/src/index.ts:42`](../packages/session/session-projection-cache/src/index.ts)

<a id="deepseek-aidsh-session-query-sqlite"></a>

## `@deepseek-ai/dsh-session-query-sqlite`

需要：`sessions`

```ts config-catalog
/** Combined session-query configuration backed by SQLite full-text search. */
export interface Config extends SessionQueryConfig {
  /**
   * Dedicated derived-index path; `:memory:` is supported for ephemeral
   * indexes. Missing directories and database files are created owner-only on
   * POSIX filesystems; existing modes are preserved.
   */
  path: string
  /**
   * Open the SQLite module and handle at service activation or the first
   * search, or `never` to disable full-text search: the inherited exact
   * reads, filters, and traces stay available, while `searchSessions` and
   * `searchEvents` fail with `SESSION_QUERY_SEARCH_DISABLED` and SQLite is
   * never imported or opened. Defaults to `startup`.
   */
  openAt?: OpenAt
  /** SQLite journal mode. Defaults to `wal`. */
  journalMode?: JournalMode
  /** Page size when a request omits `limit`. At most `Number.MAX_SAFE_INTEGER - 1`; defaults to 20. */
  defaultLimit?: number
  /** Largest accepted page size. At most `Number.MAX_SAFE_INTEGER - 1`; defaults to 100. */
  maxLimit?: number
  /** Maximum snippet length in Unicode code points. Defaults to 240. */
  snippetChars?: number
  /** Maximum concurrent persisted-log inspections in one inherited batch read. Defaults to 4. */
  persistedInspectConcurrency?: number
}

/** SQLite module/handle opening phase; `never` disables full-text search entirely. */
export type OpenAt = 'startup' | 'first-search' | 'never'

/** Supported SQLite journal modes. */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'
```

依赖：[`SessionQueryConfig`](../packages/session-query/session-query/src/index.ts)

来源：[`packages/session-query/session-query-sqlite/src/index.ts:89`](../packages/session-query/session-query-sqlite/src/index.ts)

<a id="deepseek-aidsh-session-reference"></a>

## `@deepseek-ai/dsh-session-reference`

需要：`sessionQuery`

```ts config-catalog
/** Session-reference service configuration. */
export interface Config {
  /** Maximum distinct source sessions referenced by one message, from one to three. */
  maxReferences?: number
  /** Default host candidate-list limit. */
  candidateLimit?: number
  /** Maximum rendered UTF-8 bytes for one source snapshot. */
  maxReferenceBytes?: number
}
```

来源：[`packages/context/session-reference/src/config.ts:11`](../packages/context/session-reference/src/config.ts)

<a id="deepseek-aidsh-session-telemetry-otel"></a>

## `@deepseek-ai/dsh-session-telemetry-otel`

需要：`sessions`

```ts config-catalog
/**
 * Plugin configuration: one sharing policy, two verbatim SDK option objects,
 * and one DSH-owned shutdown bound. Uploading modes validate their endpoint
 * and shutdown deadline at plugin load; `DISABLED` reads neither.
 */
export interface Config {
  /** Sharing policy; defaults to local-only `DISABLED` behavior. */
  mode?: SessionTelemetryMode
  /**
   * Passed verbatim to the SDK's OTLP/HTTP log exporter — the complete
   * `OTLPExporterNodeConfigBase` shape (`headers`, `timeoutMillis`,
   * `compression`, `keepAlive`, …), owned and documented by the SDK. `url`
   * is the one field this package requires and validates itself.
   */
  exporter?: OTLPExporterNodeConfigBase & {
    /** Full logs endpoint (e.g. `https://collector.example.com/v1/logs`). Required outside `DISABLED`; validated at load. */
    url?: string
  }
  /**
   * Passed verbatim to `BatchLogRecordProcessor` (minus the exporter slot,
   * which this plugin fills); the SDK owns and documents these knobs.
   */
  processor?: Omit<BatchLogRecordProcessorOptions, 'exporter'>
  /** Maximum time spent awaiting the SDK provider's complete shutdown path. */
  shutdownTimeoutMillis?: number
}

/** Session-sharing policy selected by {@link Config.mode}. */
export enum SessionTelemetryMode {
  FULL = 'FULL',
  FEEDBACK_ONLY = 'FEEDBACK_ONLY',
  DISABLED = 'DISABLED',
}
```

依赖：`BatchLogRecordProcessorOptions`（`@opentelemetry/sdk-logs`）· `OTLPExporterNodeConfigBase`（`@opentelemetry/otlp-exporter-base`）

来源：[`packages/session/session-telemetry-otel/src/index.ts:91`](../packages/session/session-telemetry-otel/src/index.ts)

<a id="deepseek-aidsh-session-title"></a>

## `@deepseek-ai/dsh-session-title`

需要：`sessions`

```ts config-catalog
/** Required deterministic fallback and accepted-title limits. */
export interface Config {
  /** Maximum whitespace-delimited words in the built-in fallback. */
  readonly fallbackMaxWords: number
  /** Maximum UTF-8 bytes in the built-in fallback. */
  readonly fallbackMaxBytes: number
  /** Maximum UTF-8 bytes in any accepted title. */
  readonly maxTitleBytes: number
}
```

来源：[`packages/session/session-title/src/index.ts:79`](../packages/session/session-title/src/index.ts)

<a id="deepseek-aidsh-session-title-all-prompts-llm"></a>

## `@deepseek-ai/dsh-session-title-all-prompts-llm`

需要：`sessionTitle` · `llm` · `sessions`

```ts config-catalog
/** Required LLM policy; this plugin adds no defaults. */
export type Config = SessionTitleLlmConfig
```

依赖：[`SessionTitleLlmConfig`](../packages/session/session-title-llm/src/index.ts)

来源：[`packages/session/session-title-all-prompts-llm/src/index.ts:15`](../packages/session/session-title-all-prompts-llm/src/index.ts)

<a id="deepseek-aidsh-session-title-first-prompt-llm"></a>

## `@deepseek-ai/dsh-session-title-first-prompt-llm`

需要：`sessionTitle` · `llm` · `sessions`

```ts config-catalog
/** Required LLM policy; this plugin adds no defaults. */
export type Config = SessionTitleLlmConfig
```

依赖：[`SessionTitleLlmConfig`](../packages/session/session-title-llm/src/index.ts)

来源：[`packages/session/session-title-first-prompt-llm/src/index.ts:15`](../packages/session/session-title-first-prompt-llm/src/index.ts)

<a id="deepseek-aidsh-settings-file"></a>

## `@deepseek-ai/dsh-settings-file`

```ts config-catalog
/** Plugin config: file location and hot-reload behavior. */
export interface Config {
  /** Settings document path; defaults to `settings.yaml` under the harness home. */
  path?: string
  /** Harness home used when `path` is omitted; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Watch the document and hot-publish external edits; defaults to true. */
  watch?: boolean
  /** Watcher write-settle window in milliseconds; defaults to 100. */
  debounceMs?: number
}
```

来源：[`packages/settings/settings-file/src/index.ts:21`](../packages/settings/settings-file/src/index.ts)

<a id="deepseek-aidsh-shell-env"></a>

## `@deepseek-ai/dsh-shell-env`

```ts config-catalog
/** Plugin config (all optional — the built-in facts resolve without defaults). */
export interface Config {
  /** DeepSeek Harness home directory exposed as `DSH_HOME`; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
}
```

来源：[`packages/shell/shell-env/src/index.ts:29`](../packages/shell/shell-env/src/index.ts)

<a id="deepseek-aidsh-skill"></a>

## `@deepseek-ai/dsh-skill`

```ts config-catalog
/** Skill registry configuration. */
export interface Config {
  /** Maximum number of completed cwd/provider catalogs kept in memory. */
  readonly collectCacheMaxEntries?: number
}
```

来源：[`packages/skill/skill/src/index.ts:279`](../packages/skill/skill/src/index.ts)

<a id="deepseek-aidsh-skill-filesystem"></a>

## `@deepseek-ai/dsh-skill-filesystem`

需要：`skills`

```ts config-catalog
/** Local filesystem skill provider configuration. */
export interface Config {
  /** Unique provider name. Defaults to `local`. */
  providerName?: string
  /** Whether project and user roots are included around custom roots. */
  includeDefaultRoots?: boolean
  /** DeepSeek Harness config root. Defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Shared agent config root. Defaults to `$DSH_AGENTS_HOME` or `~/.agents`. */
  agentsHome?: string
  /** Additional skill roots scanned after project roots and before user roots. */
  customSkillDirs?: string[]
  /** Whether host-local skill roots are watched for catalog changes. */
  watch?: boolean
  /** Whether Chokidar uses polling instead of native filesystem events. */
  watchUsePolling?: boolean
  /** Milliseconds a changed skill entry must remain stable before it is observed. */
  watchStabilityThresholdMs?: number
  /** Milliseconds between Chokidar stability or polling probes. */
  watchPollIntervalMs?: number
  /** Maximum distinct project roots whose skill directories remain watched. */
  watchMaxProjects?: number
  /** Whether watched symbolic links follow their target files. */
  watchFollowSymlinks?: boolean
  /** Bundled skill root; defaults to `$DSH_BUNDLED_SKILL_DIR` when default roots are included, otherwise mounts none. */
  bundledSkillDir?: string
}
```

来源：[`packages/skill/skill-filesystem/src/index.ts:49`](../packages/skill/skill-filesystem/src/index.ts)

<a id="deepseek-aidsh-spill-local"></a>

## `@deepseek-ai/dsh-spill-local`

```ts config-catalog
/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /**
   * Root directory for spill files. Omitted uses a lazily-created private
   * (0700) per-process directory under the OS temp dir — the safe default for
   * a local deployment. Set it to keep spill files under a known location.
   */
  root?: string
}
```

来源：[`packages/spill/spill-local/src/index.ts:22`](../packages/spill/spill-local/src/index.ts)

<a id="deepseek-aidsh-spill-policy"></a>

## `@deepseek-ai/dsh-spill-policy`

需要：`tools`

```ts config-catalog
/** Plugin config. */
export interface Config {
  /**
   * The model-facing context cap for a plain-text tool result, in UTF-8 bytes.
   * Omitted disables the policy entirely (no-op). When set, a result larger than
   * this is spilled and replaced with a preview derived from this same budget.
   */
  maxInlineBytes?: number
}
```

来源：[`packages/spill/spill-policy/src/index.ts:60`](../packages/spill/spill-policy/src/index.ts)

<a id="deepseek-aidsh-storage-domain"></a>

## `@deepseek-ai/dsh-storage-domain`

需要：`storage`

```ts config-catalog
/**
 * Plugin config. Which backend serves which domain is decided here, not
 * globally on the hub: `backend` is the default route and `routes` overrides
 * it per domain name. A route naming an unregistered backend fails loud at
 * `open` with `backend-not-found`.
 */
export interface Config {
  /** Default backend name for every domain without an explicit route. Required: there is no universally correct medium. */
  backend: string
  /** Per-domain overrides: domain name → backend name. */
  routes?: Record<string, string>
}
```

来源：[`packages/storage/storage-domain/src/index.ts:52`](../packages/storage/storage-domain/src/index.ts)

<a id="deepseek-aidsh-storage-json"></a>

## `@deepseek-ai/dsh-storage-json`

需要：`storage`

```ts config-catalog
/**
 * Plugin configuration.
 * `root` has NO default on purpose: a `process.cwd()` fallback would scatter
 * unit files wherever the process happens to start; assemblies state the
 * location explicitly.
 */
export interface Config {
  /** Directory holding one `<unit>.json` file per unit. */
  root: string
}
```

来源：[`packages/storage/storage-json/src/index.ts:27`](../packages/storage/storage-json/src/index.ts)

<a id="deepseek-aidsh-storage-sqlite"></a>

## `@deepseek-ai/dsh-storage-sqlite`

需要：`storage`

```ts config-catalog
/** Plugin configuration. */
export interface Config {
  /**
   * Filesystem path to the SQLite database file. The special value `:memory:`
   * opens an in-process database (tests). On filesystems with POSIX modes,
   * missing directories and databases are created owner-only; existing path
   * modes are preserved. Filesystem setup errors other than an existing
   * database fail the open. The backend does not protect confidentiality or
   * integrity when another principal can replace the database entry in its
   * parent directory.
   */
  path: string
  /**
   * SQLite `journal_mode` pragma. `wal` (the default) suits local disks; pick
   * a rollback-journal mode (`delete`/`truncate`/`persist`) on filesystems
   * where WAL's shared-memory files do not work (network mounts). See
   * {@link JournalMode}.
   */
  journalMode?: JournalMode
}

/**
 * Journal modes the backend will run under. `wal` is the default; the
 * rollback-journal modes (`delete`/`truncate`/`persist`) exist for
 * filesystems where WAL's shared-memory files do not work (network mounts).
 * `memory`/`off` are excluded: dropping journal durability silently
 * contradicts the durability clause of the KV backend contract.
 */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'
```

来源：[`packages/storage/storage-sqlite/src/index.ts:24`](../packages/storage/storage-sqlite/src/index.ts)

<a id="deepseek-aidsh-subagent-acp"></a>

## `@deepseek-ai/dsh-subagent-acp`

需要：`subagents` · `subprocess`

```ts config-catalog
/** Config: how to spawn and drive the child ACP agent process. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `acp`). */
  providerName: string
  /** The executable to spawn for each run (the child ACP agent). */
  command: string
  /** Arguments passed to {@link command}. */
  args: string[]
  /**
   * Working directory override for the child process and its ACP session.
   * Must be non-empty; a relative path resolves against the harness launch
   * directory at load, and the result must be an existing directory. When
   * omitted, each child inherits its delegating parent session's cwd — and
   * starting one from a parent session that has no cwd fails.
   */
  cwd?: string
  /**
   * How to auto-answer the child's `session/request_permission` prompts:
   * `reject` (default — decline every prompt) or `allow` (approve via the first
   * `allow_once` or `allow_always` option). No prompt is surfaced to a human.
   */
  permission: PermissionPolicy
  /**
   * Extra environment variables for the child process — e.g. the child
   * harness's own `DEEPSEEK_API_KEY`. Forwarded on top of a credential-scrubbed
   * copy of the parent env, so an explicit key here reaches the child while
   * ambient secrets do not leak implicitly.
   */
  env: Record<string, string>
  /**
   * Grace period (ms) for the child's EOF-driven quiesce on dispose — its
   * window to flush persistence and tear down its own nested subprocesses
   * before the parent escalates to a signal. Must not exceed
   * `MAX_TIMER_DELAY_MS`.
   */
  disposeEofGraceMs?: number
  /** Termination-escalation grace (ms); must not exceed `MAX_TIMER_DELAY_MS`. */
  disposeGraceMs?: number
}

/** Fixed response to child permission requests: reject by default, or select the first allow option. */
export type PermissionPolicy = 'allow' | 'reject'
```

来源：[`packages/subagent/subagent-acp/src/index.ts:27`](../packages/subagent/subagent-acp/src/index.ts)

<a id="deepseek-aidsh-subagent-claude-code"></a>

## `@deepseek-ai/dsh-subagent-claude-code`

需要：`subagents` · `subprocess`

```ts config-catalog
/** Deployment-owned environment and process-release bound. */
export interface Config {
  /**
   * Explicit environment entries layered over the subprocess seam's
   * credential-scrubbed parent environment.
   */
  env?: Record<string, string>
  /** Grace in milliseconds for Claude Code process-tree termination. */
  disposeGraceMs?: number
}
```

来源：[`packages/subagent/subagent-claude-code/src/index.ts:32`](../packages/subagent/subagent-claude-code/src/index.ts)

<a id="deepseek-aidsh-subagent-codex"></a>

## `@deepseek-ai/dsh-subagent-codex`

需要：`subagents` · `subprocess`

```ts config-catalog
/** Deployment-owned environment and process-release bound. */
export interface Config {
  /**
   * Explicit environment entries layered over the subprocess seam's
   * credential-scrubbed parent environment.
   */
  env?: Record<string, string>
  /** Grace in milliseconds for app-server process-tree termination. */
  disposeGraceMs?: number
}
```

来源：[`packages/subagent/subagent-codex/src/index.ts:30`](../packages/subagent/subagent-codex/src/index.ts)

<a id="deepseek-aidsh-subagent-dsh-sdk"></a>

## `@deepseek-ai/dsh-subagent-dsh-sdk`

需要：`subagents`

```ts config-catalog
/** Config: how to spawn and drive the child SDK runtime process. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `dsh-sdk`). */
  providerName: string
  /** The executable to spawn for each run (the child runtime bin or packaged exe). */
  command: string
  /** Arguments passed to {@link command} (typically the child's `cordis.yml` path). */
  args: string[]
  /**
   * Working directory override for the child process and its SDK session
   * workspace. Must be non-empty; a relative path resolves against the
   * harness launch directory at load, and the result must be an existing
   * directory. When omitted, each child inherits its delegating parent
   * session's cwd — and starting one from a parent session that has no cwd
   * fails.
   */
  cwd?: string
  /** Provider route the child runtime initializes with (default `deepseek-official`). */
  provider: string
  /** Model the child runtime initializes with (default `deepseek-v4-flash`). */
  model: string
  /** Optional per-request output-token cap for the child runtime. */
  maxTokens?: number
  /**
   * Extra environment variables for the child process — e.g. the child
   * runtime's own `DEEPSEEK_API_KEY`, or `DSH_CORDIS_CONFIG` naming its
   * config. Forwarded on top of a credential-scrubbed copy of the parent
   * env, so an explicit key here reaches the child while ambient secrets do
   * not leak implicitly.
   */
  env: Record<string, string>
  /** Bound (ms) on the protocol `shutdown` exchange during dispose. */
  shutdownTimeoutMs?: number
  /**
   * Grace period (ms) for the child's EOF-driven quiesce on dispose — its
   * window to flush persistence and tear down its own nested subprocesses
   * before the parent escalates to a signal.
   */
  disposeEofGraceMs?: number
  /** Termination confirmation window (ms), including forced exit on every platform. */
  disposeGraceMs?: number
}
```

来源：[`packages/subagent/subagent-dsh-sdk/src/index.ts:29`](../packages/subagent/subagent-dsh-sdk/src/index.ts)

<a id="deepseek-aidsh-subagent-fork-in-process"></a>

## `@deepseek-ai/dsh-subagent-fork-in-process`

需要：`subagents`

```ts config-catalog
/** Config: the registry name to register the provider under. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `fork`). */
  providerName: string
}
```

来源：[`packages/subagent/subagent-fork-in-process/src/index.ts:31`](../packages/subagent/subagent-fork-in-process/src/index.ts)

<a id="deepseek-aidsh-subagent-spawn-in-process"></a>

## `@deepseek-ai/dsh-subagent-spawn-in-process`

需要：`subagents`

```ts config-catalog
/** Config: the registry name to register the provider under. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `spawn`). */
  providerName: string
}
```

来源：[`packages/subagent/subagent-spawn-in-process/src/index.ts:25`](../packages/subagent/subagent-spawn-in-process/src/index.ts)

<a id="deepseek-aidsh-subprocess-e2b"></a>

## `@deepseek-ai/dsh-subprocess-e2b`

需要：`e2b`

```ts config-catalog
/** Configuration for the E2B subprocess adapter. */
export interface Config {
  /** Remote status/liveness poll cadence in milliseconds; each tick is one control-plane request. */
  pollMs?: number
}
```

来源：[`packages/e2b/subprocess-e2b/src/index.ts:25`](../packages/e2b/subprocess-e2b/src/index.ts)

<a id="deepseek-aidsh-system-prompt"></a>

## `@deepseek-ai/dsh-system-prompt`

```ts config-catalog
/** Plugin config: the deployment-authored fragment of the system prompt (see {@link Config.persona} for its contract). */
export interface Config {
  /** Include the fixed DeepSeek Harness identity before the deployment persona (default true). */
  includeHarnessIdentity?: boolean
  /** Include dynamic runtime-context snapshots in model history (default true). */
  includeRuntimeContext?: boolean
  /**
   * Deployment-wide order-0 persona template. A scoped section named
   * `deployment:persona` shadows it; `{{variable}}` references are strict.
   */
  persona?: string
  /**
   * Model-facing tool names in order, with {@link TOOL_ORDER_REST} exactly once.
   * Invalid fields fail at load and unknown names fail at assembly; known names
   * hidden in one scope may be absent there. Omitted means lexicographic order.
   */
  toolOrder?: string[]
}
```

来源：[`packages/core/system-prompt/src/index.ts:186`](../packages/core/system-prompt/src/index.ts)

<a id="deepseek-aidsh-terminal-bash"></a>

## `@deepseek-ai/dsh-terminal-bash`

需要：`pty` · `sandboxPolicy` · `subprocess`

```ts config-catalog
/** Public plugin configuration. */
export interface Config {
  /** Backend registry type (default: `shell`). */
  backendType?: string
  /** Interactive shell executable (default: `/bin/bash`). */
  shellPath?: string
  /** Shell arguments (default: `--noprofile --norc -i`). */
  shellArgs?: string[]
  /** Terminal rows. */
  rows?: number
  /** Terminal columns. */
  cols?: number
  /** Maximum retained logical lines. */
  scrollbackLines?: number
  /** Maximum retained UTF-8 bytes. */
  scrollbackMaxBytes?: number
  /** Maximum bytes returned by one read or settled viewport. */
  maxReadBytes?: number
  /** Readiness polling interval. */
  pollIntervalMs?: number
  /** Delay before Linux exact syscall probes. */
  exactProbeAfterMs?: number
  /** Silence duration that yields `inferred_idle`. */
  idleSilenceMs?: number
  /**
   * Extra wait beyond `idleSilenceMs`, once a prompt marker was seen, for the shell to
   * regain the foreground before `inferred_idle` settles; at least one `pollIntervalMs`.
   */
  handoffGraceMs?: number
  /** Absolute send wait bound. */
  timeoutMs?: number
  /** Grace before teardown escalates to `SIGKILL`. */
  disposeGraceMs?: number
}
```

来源：[`packages/terminal/terminal-bash/src/config.ts:6`](../packages/terminal/terminal-bash/src/config.ts)

<a id="deepseek-aidsh-time-context"></a>

## `@deepseek-ai/dsh-time-context`

需要：`agents`

```ts config-catalog
/** Request-preparation clock formatting and append scheduling. Invalid values fail plugin load. */
export interface Config {
  /** Fallback display zone when the open turn has no unique browser zone. Omit to use the process zone. */
  timeZone?: string
  /** Minimum milliseconds between durable injections in one session. Omit or set to 0 to inject at every eligible step. */
  refreshIntervalMs?: number
}
```

来源：[`packages/context/time-context/src/index.ts:27`](../packages/context/time-context/src/index.ts)

<a id="deepseek-aidsh-tmux-context"></a>

## `@deepseek-ai/dsh-tmux-context`

需要：`agents`

```ts config-catalog
/** Per-turn tmux-location scheduling. Invalid values fail plugin load. */
export interface Config {
  /** Minimum milliseconds between durable injections in one session. Omit or set to 0 to inject on every eligible change. */
  refreshIntervalMs?: number
}
```

来源：[`packages/context/tmux-context/src/index.ts:34`](../packages/context/tmux-context/src/index.ts)

<a id="deepseek-aidsh-token-meter"></a>

## `@deepseek-ai/dsh-token-meter`

```ts config-catalog
/** Token-meter plugin configuration; the fixed estimator has no settings. */
export type TokenMeterConfig = Record<string, never>
```

来源：[`packages/llm/token-meter/src/types.ts:12`](../packages/llm/token-meter/src/types.ts)

<a id="deepseek-aidsh-tool-bash"></a>

## `@deepseek-ai/dsh-tool-bash`

需要：`tools` · `bash` · `systemPrompt` · `bashEnv`

```ts config-catalog
/** Configuration for the bash tool. */
export interface Config {
  /** Expose `run_in_background` (default true); disabled calls are also rejected. */
  enableRunInBackground?: boolean
}
```

来源：[`packages/shell/tool-bash/src/index.ts:34`](../packages/shell/tool-bash/src/index.ts)

<a id="deepseek-aidsh-tool-bash-persistent"></a>

## `@deepseek-ai/dsh-tool-bash-persistent`

需要：`tools` · `pty`

```ts config-catalog
/** Configuration for the persistent Bash tool. */
export interface Config {
  /** PTY backend used for each owner-isolated persistent shell (default `shell`). */
  backendType?: string
  /** Wall-clock limit for one command (default 300000). */
  timeoutMs?: number
  /** Maximum returned command-output characters before clipping (default 16000). */
  maxOutputChars?: number
  /** Model-facing tool description; deployments may describe their environment. */
  description?: string
}
```

来源：[`packages/shell/tool-bash-persistent/src/index.ts:400`](../packages/shell/tool-bash-persistent/src/index.ts)

<a id="deepseek-aidsh-tool-fs"></a>

## `@deepseek-ai/dsh-tool-fs`

需要：`tools` · `fs` · `systemPrompt`

```ts config-catalog
/** Plugin config (all optional — `Config` supplies the defaults). */
export interface Config {
  /** Default and maximum number of lines returned by one `read` call. */
  readLimit?: number
  /** Maximum characters returned for a single line before truncation. */
  readMaxLineLength?: number
  /** Maximum bytes returned for the selected lines of one `read` call. */
  readMaxBytes?: number
  /** Files at or above this size stream instead of loading whole into memory. */
  readStreamMinSize?: number
}
```

来源：[`packages/fs/tool-fs/src/index.ts:25`](../packages/fs/tool-fs/src/index.ts)

<a id="deepseek-aidsh-tool-fs-search"></a>

## `@deepseek-ai/dsh-tool-fs-search`

需要：`tools` · `systemPrompt` · `subprocess`

```ts config-catalog
/** Plugin config; over-cap glob sampling is an explicit deployment choice and the remaining fields have defaults. */
export interface Config {
  /** Whether an over-cap `glob` page is sampled across top-level entries instead of taking the modification-time head. */
  sampleOverCapGlobResults: boolean
  /** Max paths one `glob` call retains inline; later paths go to the formatted spill file. */
  globMaxResults?: number
  /** Max flat matches one `grep` call retains inline; later matches go to the formatted spill file. */
  grepMaxMatches?: number
  /** Max bytes retained for one matched-line preview (the cut preserves UTF-8 boundaries). */
  grepMaxLineBytes?: number
  /** Max bytes of one search's serialized `presentationMeta`; trailing groups/paths drop past it so the persisted card stays bounded. */
  searchMetaMaxBytes?: number
  /** Max complete raw `rg` stdout bytes a search will parse; larger raw output fails with `SEARCH_RAW_OUTPUT_OVERFLOW`. */
  rawOutputMaxBytes?: number
  /** Terminate-escalation grace (ms), handed to the subprocess seam and bounded by `MAX_TIMER_DELAY_MS`. */
  graceMs?: number
  /** Max bytes retained for one search's stderr tail; the excerpt is embedded in `SEARCH_*` error messages, never shown on success. */
  stderrMaxBytes?: number
  /**
   * Cooperative tool-call timeout budget (ms) on both tools, enforced by
   * `@deepseek-ai/dsh-tool-call-timeout-policy` through `exec.signal`.
   */
  timeoutMs?: number
}
```

来源：[`packages/fs/tool-fs-search/src/index.ts:73`](../packages/fs/tool-fs-search/src/index.ts)

<a id="deepseek-aidsh-tool-goal"></a>

## `@deepseek-ai/dsh-tool-goal`

需要：`agents` · `goals` · `tools` · `systemPrompt`

```ts config-catalog
/** Model policy and hard lower bounds for goal-state updates. */
export interface Config {
  /** Minimum admitted goal rounds before the model may self-report `blocked`. */
  blockedAfterConsecutiveRounds?: number
}
```

来源：[`packages/goal/tool-goal/src/index.ts:26`](../packages/goal/tool-goal/src/index.ts)

<a id="deepseek-aidsh-tool-jobs"></a>

## `@deepseek-ai/dsh-tool-jobs`

需要：`tools` · `tasks` · `systemPrompt`

```ts config-catalog
/** Configures bounded `job_output` waits and completion-notice delivery. */
export interface Config {
  /** Wait duration applied when `job_output` sets `wait` without `timeout_ms` (default 30s). */
  waitTimeoutMs?: number
  /** Hard cap on any single wait; a larger model-supplied `timeout_ms` is clamped down to it (default 10min). */
  maxWaitTimeoutMs?: number
  /** Whether a completion opens a turn on an idle owner (default `wakeup`). */
  completionDelivery?: CompletionDelivery
  /**
   * Turns one owner may have opened by completion wakes before the next
   * notice degrades to injection, reset by any user-authored input (default 3).
   * Bounds the self-exciting chain where a woken turn starts the job whose
   * completion wakes it again.
   */
  maxConsecutiveWakes?: number
}

/**
 * How an unreported completion reaches an owner that is already idle: `wakeup`
 * opens a turn for it, `quiet` leaves it pending until something else wakes the
 * owner. A busy owner is injected either way.
 */
export type CompletionDelivery = 'quiet' | 'wakeup'
```

来源：[`packages/jobs/tool-jobs/src/index.ts:32`](../packages/jobs/tool-jobs/src/index.ts)

<a id="deepseek-aidsh-tool-lsp"></a>

## `@deepseek-ai/dsh-tool-lsp`

需要：`tools` · `lsp` · `systemPrompt`

```ts config-catalog
/** Plugin configuration: result caps and the timeout budget. */
export interface Config {
  /** Largest number of rendered locations before an omission marker (default 100). */
  maxLocations?: number
  /** Largest complete rendered result in characters, including truncation metadata (default 16000). */
  maxResultChars?: number
  /** Tool-call timeout budget in ms (default 60000). */
  timeoutMs?: number
}
```

来源：[`packages/lsp/tool-lsp/src/index.ts:58`](../packages/lsp/tool-lsp/src/index.ts)

<a id="deepseek-aidsh-tool-pwsh"></a>

## `@deepseek-ai/dsh-tool-pwsh`

需要：`tools` · `bash` · `systemPrompt` · `bashEnv`

```ts config-catalog
/** Configuration for the pwsh tool. */
export interface Config {
  /** Expose `run_in_background` (default true); disabled calls are also rejected. */
  enableRunInBackground?: boolean
}
```

来源：[`packages/shell/tool-pwsh/src/index.ts:52`](../packages/shell/tool-pwsh/src/index.ts)

<a id="deepseek-aidsh-tool-ralph"></a>

## `@deepseek-ai/dsh-tool-ralph`

需要：`tools` · `workflows` · `subagents` · `systemPrompt`

```ts config-catalog
/** Deployment policy for the fixed Ralph workflow. */
export interface Config {
  /** Fresh structured-output provider used for every round (default `spawn`). */
  subagentProvider?: string
  /** Default and deployment ceiling for one call's round count (default 256). */
  maxRounds?: number
  /** Maximum serialized characters in one structured handoff (default 16384). */
  maxHandoffChars?: number
  /** Maximum characters in a successful parent-facing terminal text (default 16384). */
  maxResultChars?: number
}
```

来源：[`packages/workflow/tool-ralph/src/index.ts:23`](../packages/workflow/tool-ralph/src/index.ts)

<a id="deepseek-aidsh-tool-session-query"></a>

## `@deepseek-ai/dsh-tool-session-query`

需要：`tools` · `systemPrompt` · `sessionQuery`

```ts config-catalog
/** Deployment-owned search count and timeout bounds. */
export interface Config {
  /** Maximum authorized hits returned by one search call. Defaults to 100. */
  maxSearchResults?: number
  /** Cooperative full-text search deadline in milliseconds. Defaults to 30000. */
  searchTimeoutMs?: number
}
```

来源：[`packages/session-query/tool-session-query/src/index.ts:29`](../packages/session-query/tool-session-query/src/index.ts)

<a id="deepseek-aidsh-tool-skill"></a>

## `@deepseek-ai/dsh-tool-skill`

需要：`agents` · `tools` · `skills`

```ts config-catalog
/** Model-facing skill catalog configuration. */
export interface Config {
  /** Maximum normalized description length rendered in the session catalog; minimum 3. */
  catalogDescriptionMaxLength?: number
}
```

来源：[`packages/skill/tool-skill/src/index.ts:61`](../packages/skill/tool-skill/src/index.ts)

<a id="deepseek-aidsh-tool-str-replace-editor"></a>

## `@deepseek-ai/dsh-tool-str-replace-editor`

需要：`tools` · `fs`

```ts config-catalog
/** Configuration for the string-replacement editor tool. */
export interface Config {
  /** Maximum returned view characters before clipping (default 16000). */
  maxOutputChars?: number
  /** Model-facing tool description. */
  description?: string
}
```

来源：[`packages/fs/tool-str-replace-editor/src/index.ts:497`](../packages/fs/tool-str-replace-editor/src/index.ts)

<a id="deepseek-aidsh-tool-subagent"></a>

## `@deepseek-ai/dsh-tool-subagent`

需要：`tools` · `subagents` · `systemPrompt`

```ts config-catalog
/** Config: which registered provider this tool delegates to, plus child defaults. */
export interface Config {
  /** The `ctx.subagents` provider name to start runs on (e.g. `spawn`, `acp`). */
  provider: string
  /**
   * Model-facing tool name (default `subagent`). Each loaded instance must use
   * a distinct name.
   */
  toolName?: string
  /**
   * Expose `run_in_background` (default true). Disabled instances omit the
   * parameter and reject forced background calls.
   */
  enableRunInBackground?: boolean
  /**
   * Background execution policy (default `one-shot`). `one-shot` defaults calls
   * to foreground; `continuable` defaults them to background, requires a provider
   * with the `prepareContinuable` capability, and returns the durable child id.
   * Follow-up adapters remain independently optional.
   */
  backgroundMode?: 'one-shot' | 'continuable'
  /**
   * Agent options applied to every child; omitted fields use child-loop defaults.
   */
  agentOptions?: AgentOptions
  /**
   * Per-child persona that shadows `deployment:persona`. Requires the
   * provider's `persona` capability; omission preserves the deployment persona.
   */
  persona?: string
  /**
   * Tool filter applied to every child. Filtered tools disappear from its
   * prompt and reject execution. Requires the provider's `toolFilter`
   * capability; unknown names fail startup.
   */
  toolFilter?: {
    /** Global tool names the child keeps; everything else is removed. */
    allow?: string[]
    /** Global tool names removed from the child. */
    deny?: string[]
  }
  /**
   * Maximum child depth: a non-negative safe integer (default `3`; `0` forbids
   * delegation entirely), or `'provider-managed'` to send no cap. A numeric cap
   * requires the provider's `depthLimit` capability (mount fails loud
   * otherwise). The provider checks the calling agent's current depth at every
   * start; the tool remains model-visible so runtime policy owns rejection.
   * `'provider-managed'` is for an out-of-process provider whose recursion
   * budget belongs to the child runtime or its own deployment.
   */
  maxDepth?: number | 'provider-managed'
}
```

依赖：[`AgentOptions`](subsystems/core.md)

来源：[`packages/subagent/tool-subagent/src/index.ts:29`](../packages/subagent/tool-subagent/src/index.ts)

<a id="deepseek-aidsh-tool-subagent-report"></a>

## `@deepseek-ai/dsh-tool-subagent-report`

需要：`subagents` · `tools` · `systemPrompt`

```ts config-catalog
/** Config: how accepted reports are scheduled on the parent. */
export interface Config {
  /**
   * Parent scheduling (default `wakeup`). `wakeup` creates one ordinary later
   * parent turn; `quiet` adds context without waking, so a parked parent learns
   * of the report only when something else wakes it.
   */
  reportDelivery?: SubagentReportDelivery
}
```

依赖：[`SubagentReportDelivery`](subsystems/subagent.md)

来源：[`packages/subagent/tool-subagent-report/src/index.ts:27`](../packages/subagent/tool-subagent-report/src/index.ts)

<a id="deepseek-aidsh-tool-terminal"></a>

## `@deepseek-ai/dsh-tool-terminal`

需要：`pty` · `tools` · `systemPrompt`

```ts config-catalog
/** Model-facing terminal tool configuration. */
export interface Config {
  /** Expose `run_in_background` and accept background sends (default true). */
  enableRunInBackground?: boolean
  /** Maximum UTF-8 bytes in one complete terminal or task-output result. */
  maxResultBytes?: number
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts:35`](../packages/terminal/tool-terminal/src/index.ts)

<a id="deepseek-aidsh-tool-todo"></a>

## `@deepseek-ai/dsh-tool-todo`

需要：`tools`

```ts config-catalog
/** Model-facing todo tool configuration. */
export interface Config {
  /**
   * Required deployment choice for whether several todos may be `in_progress` at once. True suits
   * agents that run work concurrently — subagents, background commands, workflow fan-out — and the
   * description then instructs the model to mark every actively worked task. False restores the
   * single-active discipline: the description asks for exactly one, and a call marking more is
   * rejected.
   */
  allowParallelInProgress: boolean
}
```

来源：[`packages/todo/tool-todo/src/index.ts:29`](../packages/todo/tool-todo/src/index.ts)

<a id="deepseek-aidsh-tool-web"></a>

## `@deepseek-ai/dsh-tool-web`

需要：`tools` · `web` · `systemPrompt`

```ts config-catalog
/** Plugin config: which web tools to register, the source cap, per-tool budgets, and the fetch output cap. */
export interface Config {
  /** Register `web_search`. Defaults to true. */
  search?: boolean
  /** Register `web_fetch`. Defaults to true. */
  fetch?: boolean
  /** Upper bound on sources returned by one `web_search` call. */
  searchMaxResults?: number
  /** Cooperative timeout budget (ms) for `web_fetch`. Defaults to 30000. */
  fetchTimeoutMs?: number
  /** Cooperative timeout budget (ms) for `web_search`. Defaults to 30000. */
  searchTimeoutMs?: number
  /** Cap on source characters converted and complete `web_fetch` output characters. Defaults to 200000. */
  fetchMaxOutputChars?: number
}
```

来源：[`packages/web/tool-web/src/index.ts:37`](../packages/web/tool-web/src/index.ts)

<a id="deepseek-aidsh-tool-workflow"></a>

## `@deepseek-ai/dsh-tool-workflow`

需要：`tools` · `workflows` · `systemPrompt`

```ts config-catalog
/** Config: the model-facing tool name plus result rendering caps. */
export interface Config {
  /** The model-facing tool name to register (default `workflow`). */
  toolName?: string
  /** Rendered-result ceiling, in characters: a longer JSON value is truncated with a notice (default 50000). */
  maxResultChars?: number
}
```

来源：[`packages/workflow/tool-workflow/src/index.ts:33`](../packages/workflow/tool-workflow/src/index.ts)

<a id="deepseek-aidsh-tools"></a>

## `@deepseek-ai/dsh-tools`

需要：`systemPrompt`

```ts config-catalog
/** Plugin config: how the registered tools are presented to the model. */
export interface Config {
  /**
   * Model presentation. `native` (default) sends every visible schema; `code`
   * sends only `run_code` plus a generated SDK prompt and collapses the
   * executor to the same surface (a model-direct call may only name
   * `run_code`; `run_code` SDK sub-dispatches keep every visible tool); `both`
   * sends both forms. Code modes require a `ctx.codeRuntime` whose `language`
   * has a registered SDK renderer (TypeScript or Python) and fail prompt
   * assembly when it is absent or has no renderer. Under `code`, native names
   * in `toolOrder` are invalid.
   */
  mode?: ToolPresentationMode
  /**
   * Concurrency cap for a `run_code` program's overlapping sub-calls
   * (default 10, the loop scheduler's own default). Sub-calls follow the
   * native scheduling contract — only calls whose tools classify
   * concurrency-safe overlap; exclusive calls form barriers — so `1`
   * restores strictly serial dispatch. Must be a positive integer.
   */
  maxParallelSubCalls?: number
}

/** How the registry presents its tools to the model (see {@link Config.mode}). */
export type ToolPresentationMode = 'native' | 'code' | 'both'
```

来源：[`packages/core/tools/src/index.ts:654`](../packages/core/tools/src/index.ts)

<a id="deepseek-aidsh-typert-loader"></a>

## `@deepseek-ai/dsh-typert-loader`

需要：`typert` · `loader`

```ts config-catalog
/** Additional package artifacts whose owning plugins are nested behind another Loader entry. */
export interface Config {
  /** Exact npm package names that must resolve and export `./typert`. */
  packages?: string[]
}
```

来源：[`packages/typert/loader/src/index.ts:47`](../packages/typert/loader/src/index.ts)

<a id="deepseek-aidsh-user-approval"></a>

## `@deepseek-ai/dsh-user-approval`

```ts config-catalog
/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface Config {
  /**
   * The deployment's default {@link ApprovalPolicy} for sessions without an
   * `approval/policy` override — `'ask'` delegates to the composed answerers
   * (fail-closed with none); `'never'` auto-rejects every ask without
   * prompting (the deterministic CI/unattended stance).
   */
  readonly policy?: ApprovalPolicy
}

/**
 * A session's approval policy — what happens to an {@link ApprovalService}
 * ask BEFORE any interactive answerer sees it:
 *
 * - `'ask'` (the default) — delegate to the composed answerers; with none
 *   composed the chain falls through to the fail-closed `'unavailable'`.
 * - `'never'` — never prompt anyone: every ask resolves `'rejected'`
 *   deterministically. The strict headless stance (CI, unattended runs) and
 *   the policy whose outcome is knowable without asking.
 */
export type ApprovalPolicy = 'ask' | 'never'
```

来源：[`packages/interaction/user-approval/src/index.ts:177`](../packages/interaction/user-approval/src/index.ts)

<a id="deepseek-aidsh-web"></a>

## `@deepseek-ai/dsh-web`

```ts config-catalog
/**
 * Config for the web seam. `searchProvider` / `fetchProvider` pin which provider
 * wins for each capability; both are optional (a single registered usable
 * provider auto-selects). Operational overrides such as environment variables
 * must feed these same fields rather than introduce a hidden priority chain.
 */
export interface WebRuntimeConfig {
  /** Explicit search provider id. Omitted = auto-select when exactly one usable. */
  readonly searchProvider?: string
  /** Explicit fetch provider id. Omitted = auto-select when exactly one usable. */
  readonly fetchProvider?: string
}
```

来源：[`packages/web/web/src/index.ts:55`](../packages/web/web/src/index.ts)

<a id="deepseek-aidsh-web-app"></a>

## `@deepseek-ai/dsh-web-app`

需要：`webServer`

```ts config-catalog
/** Plugin config: composed deployment settings plus per-invocation command-line values. */
export interface Config {
  /** Print the URL line on activation; a non-interactive layer can turn it off. */
  printUrl: boolean
  /**
   * Register the model-visible surface context (the `app:web-surface` prompt
   * section and the `DSH_WEB_URL` bash variable). A one-shot non-interactive
   * layer can turn it off when its user is not in the GUI, so the
   * orientation text would be false.
   */
  surfaceContext: boolean
  /** Explicit `--trusted-host` authorities from this invocation. */
  trustedHosts: string[]
}
```

来源：[`packages/bundle/web-app/src/index.ts:38`](../packages/bundle/web-app/src/index.ts)

<a id="deepseek-aidsh-web-fetch-http"></a>

## `@deepseek-ai/dsh-web-fetch-http`

需要：`web`

```ts config-catalog
/** Plugin config: the provider's transport and size limits plus its `User-Agent` (all defaulted). */
export interface Config {
  /** Maximum accepted request URL length. */
  maxUrlLength?: number
  /** Maximum response body size in bytes. */
  maxResponseBytes?: number
  /** Maximum decoded body length in characters. */
  maxBodyChars?: number
  /** Default fetch timeout in milliseconds, within Node's timer range. */
  timeoutMs?: number
  /** Maximum number of same-origin redirect hops to follow. */
  maxRedirects?: number
  /** `User-Agent` header sent on every request. */
  userAgent?: string
}
```

来源：[`packages/web/web-fetch-http/src/index.ts:34`](../packages/web/web-fetch-http/src/index.ts)

<a id="deepseek-aidsh-web-search-deepseek"></a>

## `@deepseek-ai/dsh-web-search-deepseek`

需要：`web`

```ts config-catalog
/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal DeepSeek API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `DEEPSEEK_API_KEY`. */
  apiKeyEnv?: string
  /** Anthropic-compatible endpoint base; `/messages` is appended. */
  baseURL?: string
  /** Anthropic-format model name. Defaults to `deepseek-v4-flash`. */
  model?: string
  /** `anthropic-version` header value. Defaults to `2023-06-01`. */
  apiVersion?: string
  /** Upper bound on generated tokens for the Messages request. Defaults to 4096. */
  maxTokens?: number
  /** Maximum `web_search` server-tool uses per request. Defaults to 5. */
  maxUses?: number
}
```

来源：[`packages/web/web-search-deepseek/src/index.ts:46`](../packages/web/web-search-deepseek/src/index.ts)

<a id="deepseek-aidsh-web-search-exa"></a>

## `@deepseek-ai/dsh-web-search-exa`

需要：`web`

```ts config-catalog
/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Exa API key. Falls back to `$EXA_API_KEY`. Empty → provider unavailable. */
  apiKey?: string
  /** Endpoint base; `/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Retrieval mode sent as Exa's `type`. Defaults to `auto`. */
  searchType?: 'auto' | 'keyword' | 'neural'
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
  /** Highlight sentences requested per result. Defaults to 1. */
  highlightsPerResult?: number
}
```

来源：[`packages/web/web-search-exa/src/index.ts:38`](../packages/web/web-search-exa/src/index.ts)

<a id="deepseek-aidsh-web-search-perplexity"></a>

## `@deepseek-ai/dsh-web-search-perplexity`

需要：`web`

```ts config-catalog
/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Perplexity API key. Falls back to `$PERPLEXITY_API_KEY`. Empty → unavailable. */
  apiKey?: string
  /** Endpoint base; `/chat/completions` is appended. Defaults to the public API. */
  baseURL?: string
  /** Search model name. Defaults to `sonar`. */
  model?: string
  /** Upper bound on generated answer tokens. Defaults to 1024. */
  maxTokens?: number
  /** Recency window sent as `search_recency_filter`. Omitted = no filter. */
  searchRecency?: 'day' | 'week' | 'month' | 'year'
}
```

来源：[`packages/web/web-search-perplexity/src/index.ts:32`](../packages/web/web-search-perplexity/src/index.ts)

<a id="deepseek-aidsh-workflow-worker-thread"></a>

## `@deepseek-ai/dsh-workflow-worker-thread`

需要：`subagents`

```ts config-catalog
/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** The `ctx.subagents` provider children run on (default `spawn`). */
  provider?: string
  /** Concurrent `agent()` ceiling; `0` (the default) auto-resolves to `min(16, max(1, cores - 2))`. */
  maxConcurrentAgents?: number
  /** Total `agent()` calls one run may start — the runaway-loop backstop (default 1000). */
  maxTotalAgents?: number
  /** Items accepted by a single `parallel()`/`pipeline()` call (default 4096). */
  maxItemsPerCall?: number
  /** vm timeout for the script's initial synchronous slice, inside the worker (default 5000 ms). */
  syncTimeoutMs?: number
  /**
   * How long after a cancellation an unsettled script may keep running before
   * the run force-settles `cancelled` and its worker is TERMINATED (default
   * 5000 ms); also bounds `dispose()`.
   */
  disposeGraceMs?: number
}
```

来源：[`packages/workflow/workflow-worker-thread/src/index.ts:32`](../packages/workflow/workflow-worker-thread/src/index.ts)

## 无配置的可加载插件

这些插件通过 `cordis.yml` 中不含 `config:` 块的条目加载；它们未声明任何配置接口。

- `@deepseek-ai/dsh-agent`（[`packages/core/agent/src/index.ts`](../packages/core/agent/src/index.ts)）
- `@deepseek-ai/dsh-api-gateway` — 需要 `typert`（[`packages/api/gateway/src/index.ts`](../packages/api/gateway/src/index.ts)）
- `@deepseek-ai/dsh-api-remotes`（[`packages/api/remotes/src/index.ts`](../packages/api/remotes/src/index.ts)）
- `@deepseek-ai/dsh-client-locale`（[`packages/client/locale/src/index.ts`](../packages/client/locale/src/index.ts)）
- `@deepseek-ai/dsh-client-modules` — 需要 `webServer` · `loader`（[`packages/client/modules/src/index.ts`](../packages/client/modules/src/index.ts)）
- `@deepseek-ai/dsh-client-runtime`（[`packages/client/runtime/src/index.ts`](../packages/client/runtime/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-agent-preset`（[`packages/client/ui-agent-preset/src/index.ts`](../packages/client/ui-agent-preset/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-commands`（[`packages/client/ui-commands/src/index.ts`](../packages/client/ui-commands/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-conversation`（[`packages/client/ui-conversation/src/index.ts`](../packages/client/ui-conversation/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-cordis`（[`packages/extensions/ui-cordis/src/index.ts`](../packages/extensions/ui-cordis/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-deliverables` — 需要 `systemPrompt`（[`packages/client/ui-deliverables/src/index.ts`](../packages/client/ui-deliverables/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-directory-picker-browse`（[`packages/client/ui-directory-picker-browse/src/index.ts`](../packages/client/ui-directory-picker-browse/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-directory-picker-native`（[`packages/client/ui-directory-picker-native/src/index.ts`](../packages/client/ui-directory-picker-native/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-goal`（[`packages/client/ui-goal/src/index.ts`](../packages/client/ui-goal/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-input-trigger`（[`packages/client/ui-input-trigger/src/index.ts`](../packages/client/ui-input-trigger/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-jobs`（[`packages/client/ui-jobs/src/index.ts`](../packages/client/ui-jobs/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-layout`（[`packages/client/ui-layout/src/index.ts`](../packages/client/ui-layout/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-message-feedback`（[`packages/client/ui-message-feedback/src/index.ts`](../packages/client/ui-message-feedback/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-model-selection`（[`packages/client/ui-model-selection/src/index.ts`](../packages/client/ui-model-selection/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-permission-presets`（[`packages/client/ui-permission-presets/src/index.ts`](../packages/client/ui-permission-presets/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-plan`（[`packages/client/ui-plan/src/index.ts`](../packages/client/ui-plan/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-settings`（[`packages/client/ui-settings/src/index.ts`](../packages/client/ui-settings/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-settings-general`（[`packages/client/ui-settings-general/src/index.ts`](../packages/client/ui-settings-general/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-settings-models`（[`packages/client/ui-settings-models/src/index.ts`](../packages/client/ui-settings-models/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-settings-plugin-inventory`（[`packages/client/ui-settings-plugin-inventory/src/index.ts`](../packages/client/ui-settings-plugin-inventory/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-settings-plugins`（[`packages/client/ui-settings-plugins/src/index.ts`](../packages/client/ui-settings-plugins/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-sidebar`（[`packages/client/ui-sidebar/src/index.ts`](../packages/client/ui-sidebar/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-skill`（[`packages/client/ui-skill/src/index.ts`](../packages/client/ui-skill/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-subagent`（[`packages/client/ui-subagent/src/index.ts`](../packages/client/ui-subagent/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-theme`（[`packages/client/ui-theme/src/index.ts`](../packages/client/ui-theme/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-tool`（[`packages/client/ui-tool/src/index.ts`](../packages/client/ui-tool/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-trajectory`（[`packages/client/ui-trajectory/src/index.ts`](../packages/client/ui-trajectory/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-user-questions`（[`packages/client/ui-user-questions/src/index.ts`](../packages/client/ui-user-questions/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-workflow-run`（[`packages/client/ui-workflow-run/src/index.ts`](../packages/client/ui-workflow-run/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-workspace`（[`packages/client/ui-workspace/src/index.ts`](../packages/client/ui-workspace/src/index.ts)）
- `@deepseek-ai/dsh-command-compact` — 需要 `commands` · `compact`（[`packages/compaction/command-compact/src/index.ts`](../packages/compaction/command-compact/src/index.ts)）
- `@deepseek-ai/dsh-command-feedback` — 需要 `commands`（[`packages/feedback/command-feedback/src/index.ts`](../packages/feedback/command-feedback/src/index.ts)）
- `@deepseek-ai/dsh-command-goal` — 需要 `commands` · `goals`（[`packages/goal/command-goal/src/index.ts`](../packages/goal/command-goal/src/index.ts)）
- `@deepseek-ai/dsh-commands`（[`packages/interaction/commands/src/index.ts`](../packages/interaction/commands/src/index.ts)）
- `@deepseek-ai/dsh-cordis-client-runner`（[`packages/extensions/cordis-client-runner/src/index.ts`](../packages/extensions/cordis-client-runner/src/index.ts)）
- `@deepseek-ai/dsh-fs-e2b` — 需要 `e2b`（[`packages/e2b/fs-e2b/src/index.ts`](../packages/e2b/fs-e2b/src/index.ts)）
- `@deepseek-ai/dsh-fs-observation-policy`（[`packages/fs/fs-observation-policy/src/index.ts`](../packages/fs/fs-observation-policy/src/index.ts)）
- `@deepseek-ai/dsh-goal-round-driver` — 需要 `agents` · `goals` · `sessions`（[`packages/goal/goal-round-driver/src/index.ts`](../packages/goal/goal-round-driver/src/index.ts)）
- `@deepseek-ai/dsh-host-directory-picker-auto` — 需要 `webServer` · `loader`（[`packages/host/directory-picker-auto/src/index.ts`](../packages/host/directory-picker-auto/src/index.ts)）
- `@deepseek-ai/dsh-host-directory-picker-native`（[`packages/host/directory-picker-native/src/index.ts`](../packages/host/directory-picker-native/src/index.ts)）
- `@deepseek-ai/dsh-host-plugin-inventory` — 需要 `loader`（[`packages/host/plugin-inventory/src/index.ts`](../packages/host/plugin-inventory/src/index.ts)）
- `@deepseek-ai/dsh-llm`（[`packages/llm/llm/src/index.ts`](../packages/llm/llm/src/index.ts)）
- `@deepseek-ai/dsh-lsp`（[`packages/lsp/lsp/src/index.ts`](../packages/lsp/lsp/src/index.ts)）
- `@deepseek-ai/dsh-schedule` — 需要 `agents` · `sessions` · `tools` · `sessionPersistence`（[`packages/schedule/schedule/src/index.ts`](../packages/schedule/schedule/src/index.ts)）
- `@deepseek-ai/dsh-session`（[`packages/core/session/src/index.ts`](../packages/core/session/src/index.ts)）
- `@deepseek-ai/dsh-session-checkpoint-policy` — 需要 `llm` · `sessionPersistence` · `sessions` · `tools`（[`packages/session/session-checkpoint-policy/src/index.ts`](../packages/session/session-checkpoint-policy/src/index.ts)）
- `@deepseek-ai/dsh-session-log-export` — 需要 `commands`（[`packages/session-query/session-log-export/src/index.ts`](../packages/session-query/session-log-export/src/index.ts)）
- `@deepseek-ai/dsh-session-projection`（[`packages/session/session-projection/src/index.ts`](../packages/session/session-projection/src/index.ts)）
- `@deepseek-ai/dsh-session-stats` — 需要 `sessionProjections`（[`packages/session/session-stats/src/index.ts`](../packages/session/session-stats/src/index.ts)）
- `@deepseek-ai/dsh-skill-badge` — 需要 `skills`（[`packages/skill/skill-badge/src/index.ts`](../packages/skill/skill-badge/src/index.ts)）
- `@deepseek-ai/dsh-storage`（[`packages/storage/storage/src/index.ts`](../packages/storage/storage/src/index.ts)）
- `@deepseek-ai/dsh-subagent`（[`packages/subagent/subagent/src/index.ts`](../packages/subagent/subagent/src/index.ts)）
- `@deepseek-ai/dsh-subprocess-local`（[`packages/subprocess/subprocess-local/src/index.ts`](../packages/subprocess/subprocess-local/src/index.ts)）
- `@deepseek-ai/dsh-terminal`（[`packages/terminal/terminal/src/index.ts`](../packages/terminal/terminal/src/index.ts)）
- `@deepseek-ai/dsh-tool-ask-user` — 需要 `tools` · `userInteraction`（[`packages/interaction/tool-ask-user/src/index.ts`](../packages/interaction/tool-ask-user/src/index.ts)）
- `@deepseek-ai/dsh-tool-call-timeout-policy` — 需要 `tools`（[`packages/guard/timeout-policy/src/index.ts`](../packages/guard/timeout-policy/src/index.ts)）
- `@deepseek-ai/dsh-tool-cordis` — 需要 `tools` · `systemPrompt` · `dynamicCordisRunner` · `cordisInspect`（[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)）
- `@deepseek-ai/dsh-tool-subagent-control` — 需要 `tools` · `subagents`（[`packages/subagent/tool-subagent-control/src/index.ts`](../packages/subagent/tool-subagent-control/src/index.ts)）
- `@deepseek-ai/dsh-user-questions`（[`packages/interaction/user-questions/src/index.ts`](../packages/interaction/user-questions/src/index.ts)）
- `@deepseek-ai/dsh-workspace` — 需要 `storageDomain` · `sessionPersistence`（[`packages/workspace/workspace/src/index.ts`](../packages/workspace/workspace/src/index.ts)）

## Seam 包（不可直接加载）

抽象服务类——部署时应改为加载具体的实现包（参见[能力 seam](../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)）。

- `@deepseek-ai/dsh-attachment` — 抽象 `AttachmentStore`（[`packages/attachment/attachment/src/index.ts`](../packages/attachment/attachment/src/index.ts)）
- `@deepseek-ai/dsh-code-runtime` — 抽象 `CodeRuntime`（[`packages/code-runtime/code-runtime/src/index.ts`](../packages/code-runtime/code-runtime/src/index.ts)）
- `@deepseek-ai/dsh-compaction` — 抽象 `CompactionEngine`（[`packages/compaction/compaction/src/index.ts`](../packages/compaction/compaction/src/index.ts)）
- `@deepseek-ai/dsh-credentials` — 抽象 `Credentials`（[`packages/credentials/credentials/src/index.ts`](../packages/credentials/credentials/src/index.ts)）
- `@deepseek-ai/dsh-fs` — 抽象 `FileSystem`（[`packages/fs/fs/src/index.ts`](../packages/fs/fs/src/index.ts)）
- `@deepseek-ai/dsh-host-directory-picker` — 抽象 `DirectoryPicker`（[`packages/host/directory-picker/src/index.ts`](../packages/host/directory-picker/src/index.ts)）
- `@deepseek-ai/dsh-jobs` — 抽象 `JobRegistry`（[`packages/jobs/jobs/src/index.ts`](../packages/jobs/jobs/src/index.ts)）
- `@deepseek-ai/dsh-sandbox` — 抽象 `SandboxProvider`（[`packages/sandbox/sandbox/src/index.ts`](../packages/sandbox/sandbox/src/index.ts)）
- `@deepseek-ai/dsh-session-persistence` — 抽象 `SessionPersistence`（[`packages/session/session-persistence/src/index.ts`](../packages/session/session-persistence/src/index.ts)）
- `@deepseek-ai/dsh-session-query` — 抽象 `SessionQueryEngine`（[`packages/session-query/session-query/src/index.ts`](../packages/session-query/session-query/src/index.ts)）
- `@deepseek-ai/dsh-settings` — 抽象 `Settings`（[`packages/settings/settings/src/index.ts`](../packages/settings/settings/src/index.ts)）
- `@deepseek-ai/dsh-shell` — 抽象 `ShellExecutor`（[`packages/shell/shell/src/index.ts`](../packages/shell/shell/src/index.ts)）
- `@deepseek-ai/dsh-spill` — 抽象 `SpillStore`（[`packages/spill/spill/src/index.ts`](../packages/spill/spill/src/index.ts)）
- `@deepseek-ai/dsh-subprocess` — 抽象 `SubprocessRuntime`（[`packages/subprocess/subprocess/src/index.ts`](../packages/subprocess/subprocess/src/index.ts)）
- `@deepseek-ai/dsh-workflow` — 抽象 `WorkflowEngine`（[`packages/workflow/workflow/src/index.ts`](../packages/workflow/workflow/src/index.ts)）
## 库包（无插件入口）

由其他包作为库导入；`cordis.yml` 无法加载它们。

- `@deepseek-ai/dsh-acp-snapshot`（[`packages/test-support/acp-snapshot/src/index.ts`](../packages/test-support/acp-snapshot/src/index.ts)）
- `@deepseek-ai/dsh-agent-loop-testkit`（[`packages/test-support/agent-loop-testkit/src/index.ts`](../packages/test-support/agent-loop-testkit/src/index.ts)）
- `@deepseek-ai/dsh-anonymous-user-id`（[`packages/identity/anonymous-user-id/src/index.ts`](../packages/identity/anonymous-user-id/src/index.ts)）
- `@deepseek-ai/dsh-app-boot`（[`packages/boot/app-boot/src/index.ts`](../packages/boot/app-boot/src/index.ts)）
- `@deepseek-ai/dsh-atomic-write`（[`packages/util/atomic-write/src/index.ts`](../packages/util/atomic-write/src/index.ts)）
- `@deepseek-ai/dsh-base`（[`packages/bundle/base/src/index.ts`](../packages/bundle/base/src/index.ts)）
- `@deepseek-ai/dsh-brand`（[`packages/util/brand/src/index.ts`](../packages/util/brand/src/index.ts)）
- `@deepseek-ai/dsh-client-schema-form`（[`packages/client/schema-form/src/index.ts`](../packages/client/schema-form/src/index.ts)）
- `@deepseek-ai/dsh-client-test-runtime`（[`packages/test-support/client-runtime/src/index.ts`](../packages/test-support/client-runtime/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-attachment`（[`packages/client/ui-attachment/src/index.ts`](../packages/client/ui-attachment/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-primitives`（[`packages/client/ui-primitives/src/index.ts`](../packages/client/ui-primitives/src/index.ts)）
- `@deepseek-ai/dsh-client-ui-slots`（[`packages/client/ui-slots/src/index.ts`](../packages/client/ui-slots/src/index.ts)）
- `@deepseek-ai/dsh-client-web`（[`packages/client/web/src/index.ts`](../packages/client/web/src/index.ts)）
- `@deepseek-ai/dsh-client-web-react`（[`packages/client/web-react/src/index.ts`](../packages/client/web-react/src/index.ts)）
- `@deepseek-ai/dsh-cmdline`（[`packages/boot/cmdline/src/index.ts`](../packages/boot/cmdline/src/index.ts)）
- `@deepseek-ai/dsh-home-paths`（[`packages/util/home-paths/src/index.ts`](../packages/util/home-paths/src/index.ts)）
- `@deepseek-ai/dsh-hook-protocol`（[`packages/hooks/hook-protocol/src/index.ts`](../packages/hooks/hook-protocol/src/index.ts)）
- `@deepseek-ai/dsh-launch-environment`（[`packages/util/launch-environment/src/index.ts`](../packages/util/launch-environment/src/index.ts)）
- `@deepseek-ai/dsh-llm-mock-server`（[`packages/test-support/llm-mock-server/src/index.ts`](../packages/test-support/llm-mock-server/src/index.ts)）
- `@deepseek-ai/dsh-loader-smoke`（[`packages/test-support/loader-smoke/src/index.ts`](../packages/test-support/loader-smoke/src/index.ts)）
- `@deepseek-ai/dsh-native-command`（[`packages/util/native-command/src/index.ts`](../packages/util/native-command/src/index.ts)）
- `@deepseek-ai/dsh-output-retention`（[`packages/util/output-retention/src/index.ts`](../packages/util/output-retention/src/index.ts)）
- `@deepseek-ai/dsh-sandbox-windows-acl`（[`packages/sandbox/sandbox-windows-acl/src/index.ts`](../packages/sandbox/sandbox-windows-acl/src/index.ts)）
- `@deepseek-ai/dsh-scope`（[`packages/core/scope/src/index.ts`](../packages/core/scope/src/index.ts)）
- `@deepseek-ai/dsh-sdk-client`（[`packages/sdk/client/src/index.ts`](../packages/sdk/client/src/index.ts)）
- `@deepseek-ai/dsh-sdk-jsonrpc-demo`（[`packages/examples/jsonrpc-demo/src/index.ts`](../packages/examples/jsonrpc-demo/src/index.ts)）
- `@deepseek-ai/dsh-sdk-protocol`（[`packages/sdk/protocol/src/index.ts`](../packages/sdk/protocol/src/index.ts)）
- `@deepseek-ai/dsh-session-telemetry`（[`packages/session/session-telemetry/src/index.ts`](../packages/session/session-telemetry/src/index.ts)）
- `@deepseek-ai/dsh-session-title-llm`（[`packages/session/session-title-llm/src/index.ts`](../packages/session/session-title-llm/src/index.ts)）
- `@deepseek-ai/dsh-subagent-in-process-driver`（[`packages/subagent/subagent-in-process-driver/src/index.ts`](../packages/subagent/subagent-in-process-driver/src/index.ts)）
- `@deepseek-ai/dsh-timeout`（[`packages/util/timeout/src/index.ts`](../packages/util/timeout/src/index.ts)）
- `@deepseek-ai/dsh-typert-generator`（[`packages/typert/generator/src/index.ts`](../packages/typert/generator/src/index.ts)）
- `@deepseek-ai/dsh-typert-protocol`（[`packages/typert/protocol/src/index.ts`](../packages/typert/protocol/src/index.ts)）
- `@deepseek-ai/dsh-typert-registry`（[`packages/typert/registry/src/index.ts`](../packages/typert/registry/src/index.ts)）
