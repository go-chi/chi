# @deepseek-ai/dsh-storage

[English](README.md) | 中文

非会话数据的存储中心（`ctx.storage`）：具名后端注册表加已挂载的数据形式设施。中心自身不执行 IO：后端拥有介质，数据形式拥有语义。[存储家族概述](../README.md)列出了这些包；[领域 KV 存储 Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)记录了设计理由。

## 结构

- `ctx.storage.backend`：名称 → 后端表。多个后端并排保持挂载（`json`、`sqlite`）；为消费方提供服务的后端由该消费方自身的配置决定（领域层的路由表），绝非中心的全局选择。`register()` 返回资源释放函数；注册重复名称或查找未知名称时都会明确报错。
- `ctx.storage.mount(form, facility)`／`ctx.storage.form(form)`：数据形式挂载。`StorageForms` 可通过合并扩展；领域层合并 `domain`，并通过 `ctx.storage.domain` 访问。
- 后端拥有一种介质，并公开其支持的数据形状**分面**。当前分面为 `kv`；`src/backend.ts` 负责定义其确切约定。

## 模型体验

### 后端与形式注册

#### 模型看到的内容

无。`ctx.storage` 是主机侧注册表；中心不注册工具、不注入提示词，也不写入会话事件。

#### Token 影响

每次请求都不会直接增加 token。

#### KV Cache 影响

与实时请求相互独立：中心绝不触碰请求前缀，因此无法使提供方缓存复用失效。

## 已知限制与暂缓事项

- **`kv` 是唯一的数据形状**：后端目前只有一个分面需要实现。
- **数据形式按需解析**：在领域插件挂载前读取 `ctx.storage.domain` 会抛出 `form-not-mounted`；组装会按相应顺序排列插件（错误配置会明确报错，而不是静默推迟处理）。
