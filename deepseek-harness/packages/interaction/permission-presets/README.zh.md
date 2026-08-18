# @deepseek-ai/dsh-permission-presets

[English](README.md) | 中文

通过 `ctx.permissionPresets`（[`PermissionPresetService`](src/index.ts)）提供面向用户的权限预设。每个配置名称都会将 `sandbox/mode` 与 `approval/policy` 组成一组；默认项为 `workspace-write`（`workspace-write` + `ask`）和 `danger-full-access`（`danger-full-access` + `never`）。UI 适配器可以将该表作为单个选择器公开，而沙箱执行与审批仍分别消费各自的调节项。

`set(session, name)` 会先在仅写日志的 `permissionPresets/preset` 事件中记录已变更的选择，再仅对实际值发生变化的调节项调用 setter。选择事件先于调节项事件，并在多个预设共享同一组取值时保留用户意图；净变化为零的选择不会追加任何内容。`current(events)` 优先返回仍与当前调节项匹配的已记录选择，其次返回表中第一个匹配项，否则返回 `custom`。客户端可以把 `custom` 显示为当前值，但不能选择它。

该服务拥有 `permissionPresets` Settings namespace。其 `defaultPreset` 是未来会话的默认值：组合项使用 `Config.defaultPreset`；省略时，则推断与组合后的沙箱和审批默认值匹配的 preset。已提交的 Settings 变更会在下一个会话创建时读取；创建过程将 `permissionPresets/preset`、`sandbox/mode` 和 `approval/policy` 固定到该会话中，因此后续变更绝不会改变现有会话。恢复的 seed，包括由 `session/end-seed` 标记的显式空 seed，都会保留其有效权限，只补齐缺失的持久事实，而不会采用最新的用户默认值。挂载服务时还会遍历所有已存活会话，因此 HMR（热模块替换）会固定插件缺席期间创建的所有会话。

该服务要求存在具有约束能力的 `ctx.shell` 执行器和 `ctx.approval`。表中名为 `custom` 的条目会在加载时抛出异常。当组合默认值与任何 preset 都不匹配时，插件要求显式配置 `defaultPreset`；独立构造的零事件会话仍可能推导出 `custom`。详见[沙箱切换设计](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)。

两个可选子功能在同一服务之上提供产品界面：`permissions` 会话投影单元（`src/types.ts` 声明该 key；单元以组合默认值为基础折叠三个全量值可调参数事件，并生成选择器视图，其中包含表内选项和仅作当前值的 `custom`）与 `/permissionPresets` 命令（不带参数调用时报告当前预设与表；预设参数经 `set` 切换）。每个子功能仅在其注册表（`ctx.sessionProjections` / `ctx.commands`）被组合时激活。

## 模型体验

间接地，通过 `dsh-user-approval` 和 `dsh-tool-bash`：二者会渲染由此服务的可调参数事件所选择的审批策略提示词、切换通知和沙箱工具结果；`permissionPresets/preset` 本身只写入日志。

#### KV Cache 影响

不会直接使缓存失效；具名消费方拥有所有请求前缀变更。

## 已知限制与暂缓事项

- **只组合两个机制级可调参数**：预设选择沙箱模式和审批策略；agent（智能体）／profile 选择尚未纳入 `PresetSpec`。
- **`custom` 只能推导得出**：调用方可以从不匹配的调节项组合切换出去，但无法通过此服务选中或持久化一个名为 custom 的预设。
- **预设表是进程级配置**：配置在插件生命周期内固定；更改可用预设必须重新加载插件。
- **已存储的默认值必须保留在 preset 表中**：移除被引用的 preset 会导致权限设置注册失败，直到更新或重置 `settings.yaml` 中的 `permissionPresets` 分节。
