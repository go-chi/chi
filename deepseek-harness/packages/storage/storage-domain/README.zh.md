# @deepseek-ai/dsh-storage-domain

[English](README.md) | 中文

DeepSeek Harness 存储中心的领域数据形式：在所有已配置的后端注册后，公开可注入的 `ctx.storageDomain` 服务及对应的 `ctx.storage.domain` 投影。一个领域通过 `defineDomain`（zod 记录 schema、从 `z.infer` 派生的类型）声明一次，通过 `DomainFacility.open` 打开，并由具有最终决定权的内存状态提供服务：读取同步执行；写入在每个领域各自的一条链上串行化，先在已路由后端达到持久状态，再更新内存并发出 `domain/changed`。打开领域的消费方负责管理句柄的生命周期，并通过 `Domain.close()` 释放它（幂等；通常作为其自身的 `ctx.effect` 资源释放函数）；插件卸载时，该设施会关闭仍处于打开状态的领域。

设计原理、打开语义和存储／领域分层见 [Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md)。

## 配置

| key | 含义 |
| --- | --- |
| `backend` | 每个领域的默认后端名称（必填；不存在普遍适用的存储介质）。 |
| `routes` | 逐领域覆盖：领域名称 → 后端名称。 |

## 模型体验

### 持久领域状态

#### 模型看到的内容

无。该包不注册工具、不注入提示词，也不追加会话事件；它在 `ctx.storageDomain` 后面存储非会话数据（工作区记录、未来的会话伴随数据），只发出进程内 `domain/changed` 事件。只有 Consumer 包通过自身有文档说明的接口呈现该事件时，它才会到达模型。

#### Token 影响

为零。该包的文本不会进入任何模型请求。

#### KV Cache 影响

相互独立：领域读写绝不触碰请求前缀，因此这里没有任何内容能使提供方缓存复用失效。

## 已知限制与暂缓事项

- **变更只在单进程内可见**：`domain/changed` 是进程内事件；在 Agent Note 暂缓的跨进程修订模式落地前，第二个主机进程或重新连接的 GUI 无法观察变更。
- **没有跨表事务、二级索引或多段键**：每次写入只触碰一条记录；这些扩展的触发点和返工点列在 Agent Note 的暂缓工作清单中。
