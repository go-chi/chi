# @deepseek-ai/dsh-client-ui-model-selection

[English](README.md) | 中文

模型选择插件（浏览器侧）：**两个入口共用一份会话级目录**，由 `ModelDirectoryResolver`（`ctx.modelDirectories`）持有。对于普通会话，`/model` popupSelect 贡献项（经 `ctx.commandUi` 注册）与 composer 的具名 `conversation.input.model` slot 都通过同一个 `ModelDirectory` 实例，经 `session.models` 加载会话的建议目录，并经 `session.selectModel` 提交。紧凑型 composer 触发器会打开两级 Model/Effort 菜单：模型仍按提供方分组，所选具体模型则提供由其适配器持有的推理强度名称、说明和默认值。`/model` 应用所选模型的默认推理强度，composer 随后可以选择任一已公布的推理强度。

Host 报告的 `ModelSelection` 是唯一的选择事实，其中包含提供方、模型与推理（reasoning）强度；但只有当该提供方／模型对仍在已公布分组中时才会回显。目录行缺席时，可路由的选择保持不变，但触发器会提示 `Select model`；系统不会合成陈旧行，且在用户选择已公布的模型之前不会显示 Effort 行。目录加载与选择共享一个代次计数器，旧响应不会覆盖新结果；连接重置会丢弃所有常驻目录投影，并在显示前重新拉取 Host 恢复的选择。各提供方的元数据获取失败会内联列出，同时可用分组仍可选择；选择失败会保留先前的选择和目录。

当宿主报告没有适配器服务该会话的路由（`session.models.routable`）时，本插件经 `ctx.conversation.blocks` 注册一个 composer 阻塞块，输入框随之停用并显示本插件自己的文案；恢复后无需重新加载即自动清除。它只跟随 `routable`：`null`（首次加载之前，或加载失败之后）绝不阻断，否则一个慢的宿主就会锁死一个本来可用的 composer；目录成员关系同样不阻断，因为一条仍在服务、只是不再公布该模型的路由不在分组里，却完全可用。触发器自己的 `Select model` 回退仍然覆盖那种情形——那是显示，不是闸门。

目录按会话惰性解析（`ctx.modelDirectories.directoryFor(sessionId)`），随会话作用域一并 dispose（资源释放）。已寻址 subagent 会话不公开任一入口，其目录会拒绝加载、选择与重新连接刷新，因为绑定到 agent（智能体）的普通模型 RPC 会在直接 parent 继续执行路径之外激活持久化 child 历史。

每一份常驻目录都会直接在转发的 owner 事件 `llm/adapters-updated` 与 `settings/document-updated` 上重拉。因此提供方拓扑、提供方目录与默认选择都能收敛，Host 与 client runtime 无需再派生一个单独的模型变更别名。

`/client` 导出面为插件本体（`apply`/`inject`）、`ModelDirectoryResolver`、`ModelDirectory` 及其状态形状、slot 注入面类型。

## 模型体验

间接影响。两个入口都通过仅供普通会话使用的 `session.selectModel` RPC 提交完整的 `ModelSelection`；Host 会在下一次提示词组装边界对其进行快照，因此后续请求采用所选提供方、模型与推理强度，而运行中的步骤保留已组装选择。只有当现有请求头记录一次实际采用该选择的请求后，选择才会持久化；菜单交互不会添加提示词内容。

#### KV Cache 影响

切换路由可能减少提供方侧后续请求的缓存复用，或使其失效；提示词前缀本身不受影响。

## 已知限制与暂缓事项

- **无创建期或已寻址 subagent 选择**——两个入口都要求既有普通会话的 agent；没有可纳入会话创建的草稿阶段模型选择，subagent 继续执行也有意不公开独立的模型选择约定。
- **目录名仅供呈现**——选择与持久化使用提供方／模型／推理强度 id；目录查询或确切模型元数据查询失败的提供方以不可选失败行列出，重新加载前保持原样。
- **不能任意输入推理强度**——composer 仅提供确切模型由适配器公布的推理强度；适配器没有推理元数据时不显示 Effort 行。
