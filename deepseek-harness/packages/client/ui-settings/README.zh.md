# @deepseek-ai/dsh-client-ui-settings

[English](README.md) | 中文

设置领域的底座，承担两项职责，本身不含任何呈现内容。它提供 `ctx.settingsScope`——每个偏好设置行绑定自己那份持久化命名空间分区所用的宿主传输层；并声明由注册方填充的设置 slot 类型：`settings.trigger`／`settings.header`／`settings.close`（界面框架内容）、`settings.action`（内容标题栏中的有序操作）、`settings.section`（每项功能一页）、`settings.plugins.tab`（“插件”分区内由各功能持有的页面）和 `settings.onboarding`（由各功能持有的有序页面）。它不依赖任何 `ui-*` 呈现包，因此任何持有偏好设置的功能都能够到它；设置**外壳**——`sidebar.settings` 占位方、它的导航与界面框架——位于 ui-settings-general，因为外壳一旦依赖 ui-sidebar，就会经 ui-layout 与 ui-theme 闭合出一条引用图环路。外壳自身的契约类型出于同一原因与外壳放在一起。

该插件不注入任何服务、也不等待任何服务：`ctx.settingsScope.bind(spec)` 在调用时经**调用方**的 context 解析线路面，因此绑定所得 scope 的 disposer 归调用方 fiber 所有，而由调用方注入 `connection` 取得传输层、注入 `remote` 取得失效通知。监听器在首次后台读取启动之前就已存在，因此某一行的激活绝不会阻塞在设置传输层上。已绑定的 scope 会在收到属于自己命名空间的转发 `settings/document-updated` 事件时、以及在 `connection/reset` 时重新读取。写入携带单一字段路径以及最近已知的命名空间 revision 作为 `expectedRevision`；被拒绝或失败的写入会重新读取，除非已有更新的写入取代了它，而过期的读取绝不会覆盖发布更新的结果。若 spec 未提供 `decode`，则分区不是普通对象、未通过其重建后的 schema 校验、或携带本客户端无法重建的 schema 信封时，一律不发布任何值，于是行渲染自己的缺失状态，而不是一份半解码的值。

## 模型体验

无。设置领域底座为浏览器提供偏好设置存储与 slot 声明；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **远程浏览器没有持久化设置**：设置 RPC 仅限 loopback，因此在非 loopback 浏览器中绑定的 scope 以 `unavailable` 起步且从不跨线路，它支撑的每一行在那里都是无效的。
- **每次写入仅一个字段**：`set` 只发送单个 `set` op，因此需要同时改动两个字段的行没有事务可用，会发布两个 revision。
