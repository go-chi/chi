# Agent Note: 版本化 GUI 欢迎引导

Status: implemented

[English](2026-07-30-versioned-gui-welcome-onboarding.md) | 中文

## 问题

GUI 的凭据引导从 DeepSeek 专用的就绪状态检查开始，但内部测试通知适用于每位用户，即使凭据已经配置，也必须先于提供方设置显示。若把两者作为独立浮层处理，多个对话框可能同时出现；仅存于进程内的关闭标记既无法区分通知已完成确认还是窗口在确认前已关闭，也无法在文案有意修订后重新显示一次通知。

## 决策

**设置外壳协调有序步骤。** `settings.onboarding` 仍是根作用域 list，但 `ui-settings` 会把其中各条目的 id 和顺序投影到一个协调器中，并且只挂载第一个未完成的步骤。当前注册方会收到 `complete()` 和 `openSection(id)`；所有权转移前，不会挂载后续步骤。`ui-settings-models` 现在以顺序 `-100` 注册恢复后的欢迎声明，以顺序 `0` 注册 DeepSeek 条件式凭据步骤；两者当前的共用展示由[共用弹窗引导决策](2026-08-13-shared-modal-product-onboarding.md)持有。

**产品欢迎步骤按版本管理并归功能插件所有。** 该声明曾由[移除首次启动内测声明](../simplification/2026-08-13-remove-first-run-beta-notice.md)历史决策移除，现在以新的测试阶段文案恢复在 `ui-settings-models` 中。`ui-settings-general` 仍不注册任何引导步骤；持有当前两个步骤的插件也持有文案、store 和共用弹窗。

**持久化的 `ui-onboarding` 分节持有确认状态。** 宿主端在 user-settings seam 中注册它，存入当前 `$DSH_HOME/settings.yaml`；当前欢迎 store 通过既有公开 settings API 读写其中的 `welcomeNoticeVersion`。connection 插件通过 `ctx.connection.isLoopback` 统一发布当前页面是否使用 loopback authority；hostname 判定留在 connection 包内，其他客户端插件只消费服务状态，而不导入其实现。API Proxy 在可配置提供方 namespace 之外，通过封闭的允许列表暴露这一个产品 namespace，同时不会把它的变更视为模型目录失效事件。

**可见引导使用同一个弹窗契约。** 当前两个步骤都通过 body portal 的同一个 `OnboardingModal` 渲染，且只在弹窗可见期间把下层应用根节点设为 inert。步骤加载私有事实时，外壳不渲染任何包装。明确操作会移交协调器所有权；Escape 和点击遮罩都不会确认或跳过步骤。

## 曾考虑的替代方案

**浏览器本地存储**：不予采用，因为确认状态会跟随某个浏览器 profile，而不是 `$DSH_HOME`；全新的 Harness profile 可能错误继承此前的确认状态，外部 profile 编辑也没有权威更新流。因此，非 loopback 的回退保持为进程内状态，而不是浏览器 profile 状态。

**在 `ui-settings-general` 中再增加一个独立模态窗口**：不予采用，因为欢迎通知和凭据就绪状态同时为真时，list 注册方仍会堆叠。声明并渲染该 list 的外壳应当持有有序所有权。

**在渲染或窗口关闭时持久化**：不予采用，因为看见通知不等于确认，窗口关闭事件也无法可靠送达。只有显式提交「继续」才能阻止通知在下次启动时再次显示。

**通用的公开设置暴露标志**：不予采用，因为一个产品 namespace 不足以证明应当扩大每个 settings 注册方的公开配置面。该 API Proxy 保留显式的封闭允许列表。

## 后果

全新 profile 会先看到当前测试阶段声明；当没有任何可用提供方时，再看到条件式 DeepSeek 密钥弹窗。定向 store 与 React 测试固定精确版本确认、协调器顺序、条件式移交、共用弹窗行为与 HMR 清理。真实 Chromium 场景会在隔离的 harness 家目录下启动已发布 Web 组合，验证两个弹窗，通过既有凭据边界写入密钥，并检查 secret 未进入 DOM、ARIA 或浏览器控制台。
