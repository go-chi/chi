# 实操手册：添加 LLM（大语言模型）适配器

[English](adding-an-llm-adapter.md) | 中文

如何接入一个新的模型提供方。参考实现：`packages/llm/llm-deepseek`（直接 HTTP，SSE（Server-Sent Events）由 `eventsource-parser` 分帧）与 `packages/llm/llm-pi-ai`（封装 LLM 库）。请先阅读 `packages/llm/llm/src/types.ts` 中的 `StreamChunk` 文档——它记录了两个适配器都经过验证的协议约定。

## 基本形态

```ts ignore-check
class MyAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> { … }
}

export const name = 'llm-myprovider'
export const inject = ['llm']
export const Config: z<Config> = z.object({ apiKey: z.string(), … })

export function apply(ctx: Context, config: Config) {
  ctx.llm.registerAdapter(['my-provider'], new MyAdapter(…))
}
```

注册基于副作用，可安全支持 HMR（热模块替换）；每个提供方路由仅对应一个适配器，重复注册会抛出异常，多路由注册要么全部成功，要么全部失败。`options.provider` 用于选择适配器，`options.model` 是提供方模型 ID，因此动态模型目录适配器无需重新配置生命周期即可提供新模型。密钥采用 Cordis 原生方式管理：schemastery Config 带环境变量回退，通过 cordis.yml 的 `!!js process.env.MY_KEY` 注入。切勿在代码中读取自行约定的密钥文件。

## 协议义务（两个实现共同验证的约定）

- 在 `finish` **之前**发出 `usage`；`finish` 之后**不再发出任何内容**。稳健做法：缓冲 finish/usage 直到提供方的流结束标记，再统一 flush（可处理提供方在末尾发送仅含 usage 的分片的情况）。
- 工具调用的 `arguments` 全程为原始 JSON 字符串；流式片段以 `argumentsDelta` 发送。如果你的提供方返回已解析的对象，请在 `block-end` 时重新 stringify。
- 按首次出现的流顺序分配块 `index`；同一个块的每次 delta 复用该 index。
- 错误有且仅有两条合法路径：从 `stream()` **抛出**（传输与协议故障——使用带稳定 code 的 `LlmError`），或以 `finish {kind: 'error' | 'aborted'}` 结束流（提供方带内故障）。消费方两者都处理；按故障类别选择路径并加以文档化。
- 遵守 `options.signal`（将其传递给 fetch 或你的 SDK）。
- 如果 `GenerateOptions` 中某个字段你的提供方无法支持（例如提供方不支持 stop sequences 时收到 `stop` 列表）：抛出 `LlmError(..., 'UNSUPPORTED')`，而非静默丢弃。
- 如果提供方在后续调用中需要响应 ID、签名或其他原生元数据，请将其最小无损 JSON 投影作为 `finish.replayState` 发出。重建历史时验证该状态。只有历史提供方路由和目标提供方路由当前由完全相同的适配器实例拥有时，`LlmRuntime` 才会传递该状态；由适配器决定同模型、跨模型或跨提供方恢复是否合法。状态缺失时，切勿仅根据提供方/模型名称推断原生回放。

提供方特有的思考模式开关仍放在适配器的 Config 中。确切模型元数据使用一处提供方无关的能力 seam：实现 `resolveModel()`，返回提供方/模型身份以及可选的 `context` 和 `reasoning` 字段；仅当存在配置指定的默认值时才声明 `defaultEffort`；遵守解析模型时传入的可选 `AbortSignal`。推理（reasoning）强度是由适配器映射到提供方请求的有序不透明 ID。请保留适配器给出的权威可选列表，包括适配器在支持时定义的 `off`；不得暴露最终协议值的具体拼写，也不得自动调整不支持的值。ID 无需与其协议表示相同。

## 实现结构

让协议格式（wire format）类型、请求序列化、传输解析、分片转换和适配器类分别承担独立职责；[`llm-deepseek`](../../packages/llm/llm-deepseek/README.md) 是参考布局。

## 验证

遵循[仓库测试策略](../testing.md)，该策略负责适配器覆盖、真实提供方检查和已发布入口要求。
