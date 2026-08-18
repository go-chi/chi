# 能力的三种角色设计

[English](index.md) | 中文

本文分为两部分：先参考三种角色能力模式的概念，再通过高级教程构建一项能力。请先完成[基础插件路径](../basic/)和[服务教程](../framework/service.md)。

## 概念参考

当一项能力足够通用，需要支持可替换的提供方时（例如 Bash 执行），harness 会区分三种角色：**Service Definition**、**Service Provider** 和 **Consumer**。角色需要独立演进或替换时，将它们放入不同包；否则一个包可以承担多个角色。完整能力构成其 seam。任何单一角色都不是 seam。

## 以 Bash 为例

以 Bash 执行能力为例：

- **Service Definition** (`dsh-shell`)：定义 Cordis 服务以及 Bash 请求和结果类型
- **Service Provider** (`dsh-bash-local`)：在本地计算机上执行命令
- **Consumer** (`dsh-tool-bash`)：将该能力公开为模型可调用的工具

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│  dsh-shell   │────▶│  dsh-bash-local  │     │ dsh-tool-bash│
│(definition) │     │    (provider)     │     │(consumer/tool)│
└─────────────┘     └──────────────────┘     └──────────────┘
       ▲                                            │
       └────────────────────────────────────────────┘
                    inject: ['shell']
```

## 拆分的好处

### 提供方可替换

同一个 Service Definition 可以有多个提供方，可通过 `cordis.yml` 选择：

```yaml
# Local execution
- name: '@deepseek-ai/dsh-bash-local'

# Replace this row with another package that provides the same service.
```

更换提供方时，Service Definition 和工具均保持不变。

### 独立演进

- 调用方开始依赖 Service Definition 的约定后，Service Definition 很少改动。
- Service Provider 可以独立优化性能和安全性。
- Consumer 可以调整能力向模型呈现的方式。

### 依赖解耦

- Service Provider 依赖 Service Definition。
- Consumer 依赖 Service Definition。
- Service Provider 和 Consumer **互不依赖**。

当前内置系列及其包链接由[能力 seam 参考](../../../capability-seams.md)负责。

## 教程：开发三种角色的能力

### 第一步：编写 Service Definition

```ts ignore-check
// packages/my-cap/my-cap/src/index.ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    myCap: MyCapService
  }
}

export abstract class MyCapService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myCap')
  }

  /** Execute the capability. */
  abstract execute(request: MyCapRequest): Promise<MyCapResult>
}

export interface MyCapRequest {
  input: string
}

export interface MyCapResult {
  output: string
}
```

### 第二步：编写 Service Provider

```ts ignore-check
// packages/my-cap/my-cap-local/src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { MyCapService, type MyCapRequest, type MyCapResult } from '@deepseek-ai/dsh-my-cap'

class MyCapLocal extends MyCapService {
  async execute(request: MyCapRequest): Promise<MyCapResult> {
    // Local provider behavior.
    return { output: request.input.toUpperCase() }
  }
}

export const name = 'my-cap-local'

export function apply(ctx: Context) {
  ctx.plugin(MyCapLocal)
}
```

### 第三步：编写消费方

```ts ignore-check
// packages/my-cap/tool-my-cap/src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-my-cap'
export const inject = ['tools', 'myCap']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'my_cap',
    description: 'Execute my capability.',
    parameters: {
      input: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const result = await ctx.myCap.execute({ input: args.input })
      return result.output
    },
  }))
}
```

### 在 cordis.yml 中组合

```yaml
- name: '@deepseek-ai/dsh-my-cap-local'
- name: '@deepseek-ai/dsh-tool-my-cap'
```

## 设计要点

- **不要预防性拆分**：只有角色需要独立演进时，才使用不同包。简单的工具插件无需拆分。
- **Service Definition 拥有 Request/Result 类型**：Service Provider 和 Consumer 只依赖 Service Definition 包。
- **显式优于隐式**：实现应通过显式的 `resolve(request): Spec` 步骤处理默认值，而不是在 `run()` 中隐藏 `?? default`。

## 下一步

- [LLM（大语言模型）适配器](./llm-adapter.md)：实现一个 LLM 提供方
