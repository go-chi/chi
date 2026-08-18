# Agent Note: Web composer stats detail and input-zone polish

Status: implemented
Archived: 2026-08-07

[English](2026-07-30-web-composer-stats-and-input-polish.md) | 中文

## Problem

Web 编辑器页脚原本以独立 stack 行显示一条拼接的统计字符串（cache／tokens／turns／steps），视觉上与输入卡脱节，且缺少设计稿中的耗时与 token 拆分细节。输入区自身也积累了逐条目的间距补丁：dock 条各带自己的 margin，sticky 座位下是硬切消息流的纯色填充，「回到底部」控件用硬编码偏移躲避编辑器、草稿一长高就失效，goal 与 todo 条的底色和列宽也互不一致。

## Decision

**统计行经由新的 `footer` owner prop 渲染进 InputBar 的宽度列内，并扩展为设计稿的分组细节行；composer stack 拥有唯一的 6px 节奏；座位以固定 36px 的 token 绑定渐变淡出消息流；「回到底部」控件跟随实时的 `--dsh-composer-height`；goal、todo 与 queue 共用一条 752px 的 tip 填充列。**

- `'conversation.composer.dock'` 条目以 `ComposerBarOwnerProps.footer` 席位到达页面，渲染在卡片下方、bar 的 `.root` 之内，统计行与卡片因此共享同一宽度约束。`StatsLine` 全部在客户端从快照推导：turns／steps、由 assistant `timing`（`completedTime - stepStartTime`）折算的 LLM 墙钟时间、由 tool-result 的 `time - callTime` 配对折算的工具墙钟时间、把 cache-read 并入输入侧的提示／输出 token 拆分，以及缓存命中率。各组以竖线分隔、无数据时整组消失；`formatTokens`（517 / 12.2K / 1.2M）与 `formatDuration`（45.2s / 2m42s）导出供测试。耗时只覆盖窗口内节点——该限制由 README 记录。
- `.composerStack` 采用 Figma 组合矩阵中的 6px 间距。Goal 与 Todo 保持为独立卡片；末端的 Queue 条目减去这段间距及具名的 5px 布局重叠量，使后渲染的 composer 卡片只覆盖 Queue 边缘。[composer 上下文堆栈决策](../bug-fix/2026-07-30-composer-context-stack-order.md) 规定顺序与重叠契约。
- sticky 座位的背景是从 0px 处的 `color-mix(bg-base 0%, transparent)` 到 36px 处纯色 `bg-base` 的 `linear-gradient`——像素节点而非 figma 导出的百分比，草稿长高只扩大纯色区域；`color-mix` 让两个主题都从各自的底色淡出。
- 座位上的 `useCallback` ref 挂 ResizeObserver，把 `--dsh-composer-height` 发布到滚动体上；ChatView 的回到底部席位据此计算 `bottom`（首帧回退 152px），替换先前硬编码的 168px。
- textarea 的 52px 两行下限只保留在 hero 变体；停靠态编辑器折叠到内容高度。Goal、Todo 与 Queue 面板统一使用 44px 边距／752px 上限的列，并采用 `tip` 填充和 l1 边框；独立的 Goal 卡片与折叠后的 Todo 卡片高度分别为 36px 和 44px。

## Alternatives considered

**百分比渐变节点（figma 导出的 24%）。** 否决：节点随座位高度缩放，长草稿会把过渡带拉伸到消息流的大半；固定 36px 过渡带等于设计稿在静息 ~150px 编辑器下的 24%，且随编辑器长高保持恒定。

**通用「最底条目贴卡」契约。** 不予采纳，因为 Goal 和 Todo 即使成为最后一个可见 dock 条目，也仍是独立卡片。Queue 拥有唯一一处有意的 composer 重叠，而 stack 拥有共享的间距和重叠量。

**由后端为统计行提供耗时字段。** 不必要：assistant `timing` 与工具 call/result 配对已经到达快照，墙钟时间可在客户端折算，无需新的会话事件或 host 投影。

**统计行保持为 composer stack 的兄弟节点。** 否决：作为 stack 行它携带独立的宽度约束、与卡片漂移；作为 bar 的 `footer`，两者共享一列，统计行也天然落在座位的 sticky／渐变区域内。

## Consequences

统计行现在一眼可读 turns／steps、LLM 与工具耗时、缓存命中和输入／输出 token，代价是耗时只覆盖已加载事件窗口（README 已知限制）。stack 的固定顺序使独立的上下文卡片彼此分离，并让 Queue 成为唯一与 composer 相接的面板；未来新增 dock 条目时，必须选择自己相对于这些角色的顺序。过渡带恒为 36px，未来设计调整只改一个节点值。`chat-stats-bash-sample.spec.tsx` 钉住推导（timing／工具折算、token 拆分）、两个格式化器、分组渲染，以及流式期间零重渲染的验收。
