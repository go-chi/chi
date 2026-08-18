# 开发一个工具

[English](tool.md) | 中文

本教程会在 Web UI 中添加一个 `greet` 工具。请先完成[第一个插件](./)，并保留其中的 `scratch-plugin` 目录。

## 创建工具插件

将 `scratch-plugin/src/my-plugin.ts` 替换为：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'greet-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: {
      name: { type: 'string', required: true, description: 'The name to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}!`
    },
  }))
}
```

`inject` 让 Cordis 等待工具注册表就绪。`defineTool` 根据 `parameters` 推导并校验 `args`；`execute` 返回 `output.schema` 声明的规范值，`output.render` 再将该值转换为面向模型的内容。

## 运行并调用工具

如果开发命令未在运行，请重新启动：

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

打开 `http://127.0.0.1:3080`，然后输入：`Use the greet tool to greet Ada.` 模型可以调用 `greet`，并收到 `Hello, Ada!` 这一工具结果。

## 下一步

- [插件配置](./config.md) — 让问候语可配置。
- [工具编写参考](../../../cookbook/adding-a-tool.md) — 查阅嵌套 schema、规范值、后台工作、策略钩子、Code Mode 和 UI 卡片。
- [能力分层](../practice/) — 将可替换能力拆分为 Service Definition、Service Provider 和 Consumer 三类包。
