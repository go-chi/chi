# 第一个插件

[English](index.md) | 中文

本教程会创建一个最小的 Harness 插件，并将其加载到 Web UI 中。请从已完成[从源码运行路径](../../../../README.md#run-from-source)的仓库检出开始。

## 创建本地项目

在仓库根目录创建本教程使用的临时项目：

```sh
mkdir -p scratch-plugin/src
```

## 插件是什么

在 Harness 中，插件是一个导出 `apply` 函数的 TypeScript 模块。框架在加载时调用 `apply`，传入一个 `ctx`（上下文对象），你通过 `ctx` 注册能力：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'

export function apply(ctx: Context) {
  // Register capabilities here.
}
```

这就是完整配置。

## 创建插件文件

创建 `scratch-plugin/src/my-plugin.ts`：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello-plugin'

export function apply(ctx: Context) {
  // Required dependencies are ready before apply runs.
  console.log('[hello-plugin] plugin loaded!')
}
```

## 注册到 cordis.yml

在仓库根目录运行 `pwd`，然后创建 `scratch-plugin/cordis.yml`，作为插入本地插件的 Web 覆盖层。请将下文的 `/absolute/path/to/deepseek-harness` 替换为命令打印的路径：

```yaml
- insert:
    - id: hello
      name: '/absolute/path/to/deepseek-harness/scratch-plugin/src/my-plugin.ts'
```

插件路径必须是绝对路径。patch 文件只贡献配置，不会改变 loader 解析模块路径时使用的 profile 目录。

使用该覆盖层启动 Web UI：

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

打开 `http://127.0.0.1:3080`。启动期间，终端会打印 `[hello-plugin] plugin loaded!`。

## 自动清理

通过 `ctx` 注册的任何东西——事件监听、工具、定时器——在插件卸载时都会被自动清理。你不需要手动 removeListener 或 clearInterval。

如果你有需要手动清理的资源（比如一个网络连接），用 `ctx.effect()` 告诉框架怎么清理：

```ts
import type { Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context) {
  ctx.effect(() => {
    const timer = setInterval(() => {
      console.log('heartbeat')
    }, 5000)

    // The returned function runs when the plugin unloads.
    return () => clearInterval(timer)
  })
}
```

## 声明依赖

如果你的插件需要使用其他服务（如 `tools`、`llm`），需要声明 `inject`：

```ts ignore-check
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-tool-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  // ctx.tools is ready here.
  ctx.tools.register(/* ... */)
}
```

框架会确保依赖的服务就绪后才加载你的插件。

## 插件的三种形态

除了函数形式，插件还支持对象形式和类形式：

### 对象形式

```ts
import type { Context } from '@deepseek-ai/cordis'

export default {
  name: 'my-plugin',
  inject: ['tools'],
  apply(ctx: Context) {
    // ...
  },
}
```

### 类形式

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

export default class MyService extends Service {
  static inject = ['tools']

  constructor(ctx: Context) {
    super(ctx, 'myService')
    // Perform synchronous initialization in the constructor.
  }
}
```

大多数情况下，函数形式足够了。当插件需要向其他插件提供服务时，可使用类形式（见 [服务与依赖](../framework/service.md)）。

## 下一步

- [开发一个工具](./tool.md) — 了解工具定义 DSL
- [插件配置](./config.md) — 让插件接受用户配置
- [Cordis 框架教程](../../../cordis-tutorial/index.md) — 底层的插件框架，在临时目录中动手构建，无需 API 密钥
