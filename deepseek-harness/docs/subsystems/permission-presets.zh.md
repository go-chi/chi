# 权限预设

[English](permission-presets.md) | 中文

[dsh-permission-presets](../../packages/interaction/permission-presets) 的权限预设层（`ctx.permissionPresets`，`PermissionPresetService`）把两个相互独立的强制执行 knob，即[沙箱模式](sandbox.md)（`sandbox/mode`）与[审批策略](approval.md)（`approval/policy`），捆绑成具名预设，供客户端作为单个权限（Permissions）选择器提供。它是一项可选能力，不属于 agent loop（智能体循环）主干，也不拥有任何强制执行：执行、提示词叙述与回放仍然读取各自 knob的折叠结果，预设切换只记录意图，并通过每个 knob各自的规范 setter 写入。[包 README](../../packages/interaction/permission-presets/README.md) 负责组合状态与限制；[沙箱切换设计](../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)负责决策依据。

源码：[`packages/interaction/permission-presets/src/index.ts`](../../packages/interaction/permission-presets/src/index.ts)

## 预设表

预设是一个表键，映射到一个沙箱／审批组合，外加可选的客户端展示信息；默认预设表自带 `workspace-write`（`workspace-write` + `ask`）和 `danger-full-access`（`danger-full-access` + `never`）。

```ts type-equiv
/** One preset's sandbox/approval bundle and optional client presentation. */
interface PresetSpec {
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

```ts type-equiv
/** The {@link PermissionPresetService} config: preset table and composition default. */
interface Config {
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
```

该服务要求一个施加隔离的 `ctx.shell` 执行器和 `ctx.approval`，配置错误在插件加载时即失败：名为 `custom` 的表项会抛出异常（该名称保留给派生的「非预设」状态）；在不施加隔离的 bash 执行器（没有 `sandboxMode` 能力事实）之上组合同样抛出异常，因为预设捆绑了一个沙箱模式。

## 当前预设与派生的 `custom`

`current(events)` 从 knob 派生实际生效的预设，而不是只看自身事件：它折叠会话的生效沙箱模式（回退到执行器配置的模式）与生效审批策略（先回退到审批服务配置，再回退到 `ask`），优先取仍然匹配的已记录选择，其次取声明顺序中第一个匹配的表项，否则返回 `CUSTOM_PRESET`（`'custom'`）。`custom` 只是派生值：客户端可以把它显示为当前值，但它绝不是切换目标，也绝不出现在事件 payload 中。

`names` 按预设表声明顺序列出可切换的预设；`optionOf(name)` 为某个表键（label 回退为该键）或 `custom` 构建客户端渲染的选项，传入其他任何名称都会抛出异常。

```ts type-equiv
/** The select-option shape a presentation layer advertises for one preset (or for the derived `custom` state). */
interface PresetOption {
  /** Stable option value: the table key, or `custom`. */
  value: string
  /** The display label. */
  name: string
  /** One user-facing sentence on what the value means; omitted when not configured. */
  description?: string
}
```

## 切换与 `permission/preset` 事件

`set(session, name)` 解析预设（未知名称抛出异常），在 `name` 尚不是生效预设时追加一条仅记日志的 `permission/preset` 事件，然后通过各旋钮自己的 setter（[dsh-sandbox-policy](../../packages/sandbox/sandbox-policy) 的 `setSandboxMode` 与 [dsh-user-approval](../../packages/interaction/user-approval) 的 `setApprovalPolicy`）写入，且仅当该 knob的生效值发生变化时才写。同一轮次内，选择事件先于旋钮事件出现；重新选择当前生效的预设则什么都不追加。

`permission/preset` 是持久、仅记日志的用户意图：它不进入模型 transcript（文本记录），模型可见的后果由 knob 事件经各自消费方承担；它存在是为了在两个预设共享同一个旋钮组合时，让 `current()` 仍能保住用户选择的究竟是哪一个预设；`effectivePermissionPreset(events)` 折叠最后一条，回放不需要任何追赶状态。完整事件声明见[持久化日志事件目录](../persistence-catalog.md)；方法签名见生成的[服务目录](#ctxpermissionpresets--permissionpresetservice)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpermissionpresets--permissionpresetservice"></a>

### `ctx.permissionPresets` — `PermissionPresetService`

Owns the deployment's permission presets and their write path. Requires a confining `ctx.shell` executor and `ctx.approval`; unmatched knob values are reported as CUSTOM_PRESET, not an error.

```ts cordis-catalog
/**
 * Resolve the preset matching the effective knob values. A still-matching
 * last selection wins shared-bundle ties; otherwise the first table match
 * wins, or {@link CUSTOM_PRESET} when no entry matches.
 * @param events - the session's events in log order.
 * @returns the effective preset name, or `custom` when nothing matches.
 */
current(events: readonly SessionEvent[]): string

/**
 * Build the whole select value for one folded knob state: every table
 * option in declaration order, `custom` appended exactly while derived.
 * @param state - the folded knob overrides.
 * @returns the `permissions` projection payload.
 */
selectFor(state: KnobState): PermissionSelect

/**
 * Resolve a preset's knob bundle.
 * @param name - the preset name to resolve.
 * @returns the configured bundle.
 * @throws when `name` is not in the table.
 */
resolve(name: string): PresetSpec

/**
 * Build the client option for a table entry or {@link CUSTOM_PRESET}. A
 * missing label falls back to the table key.
 * @param name - a table key, or `custom`.
 * @returns the option a client renders.
 * @throws when `name` is neither a table key nor `custom`.
 */
optionOf(name: string): PresetOption

/**
 * Record a changed preset, then update each changed knob through its own
 * setter. Selecting the effective preset again appends nothing.
 * @param session - the session the switch belongs to.
 * @param name - the preset to switch to; unknown names throw.
 */
set(session: Session, name: string): void
```

Types: [Session](session.md) · [SessionEvent](session.md)

Source: [`packages/interaction/permission-presets/src/index.ts:159`](../../packages/interaction/permission-presets/src/index.ts)
<!-- END GENERATED cordis-surface -->
