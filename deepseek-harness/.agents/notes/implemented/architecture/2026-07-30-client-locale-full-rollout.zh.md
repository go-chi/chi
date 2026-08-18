# Agent Note: client 文案全量接入 typed locale 席位与不翻译边界

Status: implemented

[English](2026-07-30-client-locale-full-rollout.md) | 中文

## Problem

typed locale 标准席位（`locale:` 注册声明 → 框架注入强类型 `t`）落地后，只有四个先行包接入；其余 client 包的文案仍是硬编码的中英混杂字面量。全量迁移需要几个先行包没有触及的机制与边界决定：注册期文本（导航行、视图 tab 的 label）在语言切换时如何刷新；zero-cordis 的 ui-primitives 原子组件如何拿到文案；哪些字符串**刻意不**本地化——没有记录的边界会诱使未来的 agent（智能体）「补完」翻译。

## Decision

**注册期文本走 label thunk。** ui-slots 的 list 注册项 `label` 接受 `SlotLabel = string | (() => string)`；owner 投影 ledger 行时必须经 `resolveSlotLabel` 解析（不裸读 `options.label`），并让读取点跟随 locale revision（outlet 自身订阅 revision；ledger 外的投影如 ui-settings 导航把 revision 并进缓存键、订阅双源）。thunk 每次读取时求值，语言切换零 ledger churn——没有重注册、version 不动，`locale/change` 重注册接线全部删除。

**组件文案走标准 `t` 席位；深层子组件用 prop 下传**，类型写 `XxxProps['t']`。字典规范形态不变：`zh satisfies Record<string, string>` 为 key 源、`en satisfies Record<XxxKey, string>` 锁双语平衡。

**zero-cordis 原子组件（ui-primitives）文案 props 化**：`HoverCard` 的 `copyLabel`/`copiedLabel`、`TerminalBlock`/`JsonTree` 的 `labels`、`CodeBlock` 的 `copyLabel`/`copiedLabel`、`MarkdownText` 的 `codeLabels`、`JsonBlock` 的 `truncatedLabel`、`ConnectionBanner` 的 `label`、`Modal` 的 `closeLabel`——默认值即原硬编码字符串，不传 props 的消费方渲染逐字节不变。已本地化的插件从自己的 `t` 席位传字典驱动的 label；传对象 props 的调用点按 `t` 身份 memo（`MarkdownText` 的组件表按 `codeLabels` 身份缓存）。

**不翻译边界（刻意决定，不是欠账）：**

- **错误/失败类字符串一律英文**：client 自产的兜底串（`command failed`、plan 切换失败）、RpcError 消息、wire 透出的 `error.message (code)` 原样呈现。
- **设计字面量不进字典**：工具行 variant 标题（Think/Bash/…）、SYSTEM/USER 类 kind 徽标、Plan chip 字标、整个 StatsLine——中英界面显示一致。
- **ui-trajectory 整包缓做**（开发者检查面，术语密集，单独裁决）。
- **boot 文案保持硬编码**（AppRoot 渲染早于 locale 服务可用）。

**派生层保持纯函数，本地化只在渲染层**：ui-workspace 的 `relativeTime` 返回结构化 `{unit, n}` 由渲染组合字典模板；blank 会话/未分组桶的存储标题不变，渲染按 `blank` 标志/`workspaceId` 缺席替换本地化文案；**搜索态 blank 行一律排除**（双语标题无法与单语查询稳定匹配）。日期不引 Intl：格式模板进字典（消息时钟 `clock.md`/`clock.ymd`，workspace hover `date.ymd`），格式化函数吃 `t` 参数保持纯。

**测试与 e2e 口径**：`makeTranslate(...dicts)`（dsh-client-test-runtime）镜像服务查找链（首个命中字典胜出、key 兜底、`{name}` 插值），组件测试的 `t` 桩统一用它并以真实 props 席位定型。web e2e 统一通过 `newEnglishPage`（`en-US` 浏览器）打开，built-boot 快照 同样固定 navigator 语言：golden 因而不受语言迁移影响。settings 语言切换用例绕开该 helper 并开启 `zh-CN` 浏览器，因为在显式 Host 偏好到达前，暂定 locale 会跟随 `navigator`（[由浏览器推导初始 locale](../feature/2026-07-31-browser-derived-initial-locale.md)）。

[settings/locale/theme 分层 Note](../../proposed/architecture/2026-07-25-client-settings-locale-theme.md) 中「apply 层订阅 `locale/change` 重注册刷新 label」的机制已被本决定取代（thunk + revision 生命周期）。

## Alternatives considered

- **label 保持 string、语言切换时重注册**（先行包的旧形态）：boot 已经为每个包注册一次，`locale/change` 监听者重注册会放大成风暴；ledger version 抖动还会击穿一切按 version 缓存的投影。thunk 把刷新成本移到读取点，读取点本来就跟随 revision。
- **给 ui-primitives 造 locale 上下文/注入通道**：破坏 zero-cordis 边界（原子组件从此依赖运行时），且强迫未本地化消费方（ui-trajectory）陪跑。props 化让每个消费方独立决定。
- **错误串进字典**：错误面是排障面，英文原样最利于搜索与上报比对；且 wire 透出串本就不可译，半译反而制造混合语言。
- **日期用 `toLocaleString()`/Intl**：跟随浏览器/OS 语言而非应用语言，切换后必然产生混合文本；字典模板量小且与消息时钟同构。
- **blank 行参与搜索（匹配本地化标题或存储标题）**：任一选择都在某个语言下「看得见搜不到」；占位行本无信息量，整体排除语义最稳。

## Consequences

- 语言切换全 UI 即时刷新且零重注册；新包接入 = 字典 + declare-merge + `locale: NS` 三步，无手写胶水。
- 代价：list label 的消费方必须知道 `resolveSlotLabel`（裸读 `options.label` 现在可能拿到函数）；类型上 `SlotLabel` 已挡住多数误用。
- ui-primitives 的中文默认值在英文语言下依旧是中文，**直到消费方传入 labels**——未迁移的 JsonTree 消费方（ui-trajectory）显示其英文默认值，恰好符合其整包英文现状。
- e2e 英文钉死意味着 zh 默认态主要靠包级组件测试与 settings 语言切换用例覆盖，浏览器 e2e 不再验证 zh 文案。
