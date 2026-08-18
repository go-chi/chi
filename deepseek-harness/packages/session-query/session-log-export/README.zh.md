# @deepseek-ai/dsh-session-log-export

[English](README.md) | 中文

Web Session 日志下载控制，使用 `dsh-host-apiproxy` 拥有的 Host 流式 ZIP 端点。Host 半包注册 `/export`；浏览器半包在 Session Header 中提供 111×32 的 `Session log` 操作，以及一个供该按钮与斜杠命令共用的下载控制器和弹窗。ZIP 生成、原始 JSONL/zstd 读取、子 Session、附件、背压和 HTTP 错误语义仍由 [ApiProxy 下载实现](../../host/apiproxy/README.md)负责。

## 命令约定

| 输入 | 结果 |
|---|---|
| `/export` | 记录一组用户命令生命周期；提交命令的浏览器收到本地执行确认后，下载 `GET /api/session.export?sessionId=<id>&includeDescendants=true`。 |
| `/export <path>` | 返回错误。浏览器下载通过浏览器的普通下载行为选择目标位置。 |

该命令只由 Web bundle 挂载。只有 `/export` 返回成功时，本地 `command/executed` 确认才会在提交命令的浏览器中触发斜杠下载；其他标签页仍会渲染持久命令行，但不会重复执行浏览器副作用。Header 按钮直接调用同一个控制器。两种入口都会先发出 `HEAD` 预检，再把 GET URL 交给浏览器下载管理器，JavaScript 不会缓冲 ZIP；它们共用并发折叠、插件释放时取消预检、准备阶段错误处理、浏览器保存行为和同一个 Modal。

Host 下载端点会在 `readRaw` 前 flush 活动的根 Session，因此斜杠命令触发的 ZIP 会包含启动下载的 `command/run` 与 `command/done` 事件对。冷持久化 Session 不需要 flush。

弹窗报告准备中、开始下载或失败。关闭弹窗不会取消正在进行的下载；该操作随后完成时也不会重新打开弹窗。每个 Session 同时只允许一项下载，重复操作会共用该任务。

## 组合

```yaml
- id: session-log-download
  name: '@deepseek-ai/dsh-session-log-export'
```

Web bundle 将本包与 `dsh-host-apiproxy`、`dsh-commands`、`dsh-client-ui-commands` 和 `dsh-client-ui-conversation` 一起挂载。本包把按钮和弹窗贡献到最右侧的 `conversation.session.header.utilities` 列表，与标题旁 `conversation.session.header.actions` 中的模式、Subagent 和 Task 配置项相互独立；Trajectory 不包含导出入口。

## 模型体验

### 用户 `/export` 控制

#### 模型看到什么

无。`/export` 留在用户命令平面，ZIP 下载不会进入模型历史。

#### Token 影响

为零。该命令不创建模型轮次。

#### KV Cache 影响

无。仅日志命令生命周期和浏览器下载不会改变派生请求前缀。

## 已知限制与暂缓事项

- 下载端点要求持久化后端具有逐 Session 原始工件。随附 JSONL 后端支持明文和 zstd 工件；本次改动不包含 SQLite 导出。
- 这是浏览器下载，不是 Host 路径写入。目标位置由浏览器选择，不会返回 Host 路径或原生文件夹操作。
- 预检只报告 ZIP 开始流式传输前发现的失败。浏览器接受 GET 后发生的子 Session 或附件读取失败由浏览器下载管理器报告，不通过弹窗报告。
