# @deepseek-ai/dsh-anonymous-user-id

[English](README.md) | 中文

会话遥测、直接反馈确认与 DeepSeek 提供方请求共用的匿名身份。`getOrCreateAnonymousUserId()` 返回一个限定于单个 harness home 的随机 UUID v4，并以裸行形式持久化到 `$DSH_HOME/.anonymous-user-id`（未设置 `DSH_HOME` 时为 `~/.dsh/.anonymous-user-id`）。OpenTelemetry 后端将其作为 Resource 的 `user.id` 上报；`/feedback` 在确认文本中包含同一个值；`dsh-llm-deepseek` 则通过 `x-deepseek-harness-user-id` 发送该值，使接收系统无需独立生成身份即可关联记录。

该身份绝不从 hostname、网络地址、git remote 或其他可用于识别身份的来源派生。删除 `.anonymous-user-id` 后，下次启动进程时会重置身份。不同 harness home 拥有不同身份。

## 存储约定

读写采用同步方式，因为启动时构造遥测和直接执行命令都需要使用同一个 API。结果在进程生命周期内按解析后的文件路径缓存。首个写入方采用独占创建；并发竞争中失败的一方会采用已持久化的胜出值。损坏的文件会被替换。持久化采用 best-effort，因此即使 home 不可写，系统仍会返回进程本地 UUID，而不会阻塞遥测或反馈。

## 组合

本包是共享库，并非 Cordis 插件。消费方直接导入 `getOrCreateAnonymousUserId()`。其不变式伴生插件刻意留空，因为本包既不拥有事件流，也不拥有任何可以在不触发创建身份这一副作用的情况下检查的公开可变关系。`DSH_TELEMETRY_DISABLED` 只会停止遥测导出，不会禁止直接反馈确认或 DeepSeek 提供方标头。

## 模型体验

无，因为该标识符只会作为模型不可见的 HTTP 传输元数据发送给 DeepSeek，绝不会进入请求正文、提示词或模型可见内容。

#### KV Cache 影响

无；该传输标头既不会改变 token，也不会改变模型可见前缀。

## 已知限制与暂缓工作

- **删除后无法恢复**：身份丢失后会按设计生成新的匿名身份；若要恢复身份，就需要稳定的派生材料，这会削弱匿名性。
- **Best-effort 并发**：如果读取方恰好落在并发进程完成独占创建但尚未写完的狭窄时间窗内，本次运行可能使用不同的内存 UUID；后续启动会收敛到已持久化的值。
- **没有跨 home 身份**：不同 `$DSH_HOME` 值之间无法关联。
- **已配置的 DeepSeek gateway 会收到该 id**：`dsh-llm-deepseek` 会把稳定标头发送至解析后的 `baseURL`（包括部署覆盖），且不受遥测共享模式影响。
