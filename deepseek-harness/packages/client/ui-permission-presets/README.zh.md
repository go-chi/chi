# @deepseek-ai/dsh-client-ui-permission-presets

[English](README.md) | 中文

面向两种不同生命周期的浏览器权限界面。「通用」设置行读取显式暴露的 `permission` Settings 描述符，从 host 的动态 `defaultPreset` enum 中推导选项，并携带描述符的 revision 写入一条 `settings.mutate` 路径操作。它的 observable 经 slot 系统的 `hooks` 格传递，因此 React 钩子由渲染器绑定；推送的失效通知会重新获取描述符。这个值仅在后续会话创建时生效；改变它不会切换当前会话。选择 Full access 时必须先显式确认风险，该行随后才会写入。

当前会话界面仍是挂在 host `/permission` 命令上的 popupSelect **装饰**（`ctx.commandUi.decorate`）。装饰不是第二条命令——host 命令保留斜杠菜单行、带参路径（`/permission <preset>` 直接切换）与持久生命周期记账；装饰只把裸调用替换为选择框：一张扁平预设列表，当前值标记为 active，kebab-case 预设名渲染为 Title Case 标签（`workspace-write` → `Workspace Write`，与 composer chip 的显示变换孪生），选中即提交 `/permission <preset>` 命令行。选项与 active 标记读取会话的 `permissions` 投影（与 composer chip 渲染的同一份 host 计算 select），因此两个当前会话界面共享同一读源与同一写路径，推送的投影帧是两者共同跟随的唯一确认。装饰恰在投影 key 存在时可用；无权限组合既不显示选择框，也不显示 Settings 行。

`/client` 导出面为插件本体（`apply`／`inject`）。

## 模型体验

通过两个界面写入的权限事实间接影响：Settings 行使未来会话带着全量值旋钮事件（`permission/preset`、`sandbox/mode`、`approval/policy`）启动，而 `/permission` 选择框切换当前会话时会追加相同的事实；这些事件决定后续工具调用解析到的沙箱模式与审批策略，选择框交互本身不添加任何提示词内容。

#### KV Cache 影响

无直接失效；请求前缀的变化由旋钮消费方自行承担。

## 已知限制与暂缓事项

- **Settings 行仅在 Web 中可用**：非 Web 客户端仍可通过 `/permission` 切换当前会话，但不会获得这项浏览器贡献。
