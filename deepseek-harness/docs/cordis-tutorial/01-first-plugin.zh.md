# 1. 编写第一个插件

[English](01-first-plugin.md) | 中文

在本教程使用的 loader 配置中，Cordis 插件模块通过命名导出提供 `apply` 函数。Cordis 加载模块时，会用一个 **上下文** 调用 `apply`；该上下文就是 `ctx` 对象，插件通过它注册自己贡献的所有内容。

## 编写插件

在 `tmp/cordis-tutorial` 目录中（参见[环境设置](index.md#setup)）创建 `hello.ts`：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello'

export function apply(ctx: Context) {
  console.log('hello from my first plugin')
}
```

`name` 导出项是可选的显示元数据；它用于在诊断信息中标识插件。

## 组合应用

本教程的启动器通过配置组装应用。创建 `cordis.yml`：

```yaml
- name: './hello.ts'
```

该文件是一组 Cordis 配置项的列表。`name` 是模块指定符，可以是相对路径或 NPM 包名；loader 会挂载每个配置项。各项会并发启动，因此它们在列表中的位置不保证插件的加载先后；顺序由服务依赖（`inject`，参见[第 3 章](03-services.md)）决定，而非文件中的位置。

## 运行

```sh
node --import tsx ../../vendor/cordis/bin.js
```

预期输出：

```
hello from my first plugin
```

当没有任何内容继续运行时，进程会自行退出。具体过程如下：

1. 启动器创建根 `Context`，并挂载 **Loader** 插件。
2. Loader 读取 `cordis.yml`，解析 `./hello.ts`，然后将其作为子插件挂载。
3. Cordis 调用你的 `apply(ctx)`。

你的文件中没有框架启动代码：插件描述自己的贡献，`cordis.yml` 则组合应用。例如，[`dsh` base](../../packages/bundle/base/cordis.patch.yml) 就是一份更长的插件组合，由部署 overlay 对它进行修补。

## 其他两种插件形态

函数是最常见的形式，但 Cordis 接受三种形式：

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

// 1. Function plugin (what you just wrote).
export function apply(ctx: Context) {}

// 2. Object plugin: an object with an `apply` method.
export const objectPlugin = {
  name: 'object-plugin',
  apply(ctx: Context) {},
}

// 3. Class plugin: a Service subclass (covered in chapter 3).
export class MyService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myTutorialService')
  }
}
```

在你需要公开服务之前，请一直使用函数形态；[第 3 章](03-services.md)介绍了何时应当使用类形态。

## 尝试制造错误

让 `apply` 抛出异常：

```ts ignore-check
export function apply(ctx: Context) {
  throw new Error('apply exploded')
}
```

再次运行：进程会因该错误而终止。插件加载失败会明确报错，不会仅跳过该配置项。

还需要尽早了解一个例外：如果某个配置项的模块无法被 **解析**，例如路径或包名拼写错误，Cordis 会通过 logger 服务报告错误，而不会使进程崩溃。在启动阶段，这条报告可能在 console 导出器开始观察之前丢失。如果新增配置项似乎没有任何效果，请先检查拼写。

下一章：[生命周期与 effect](02-lifecycle-and-effects.md)：插件卸载时会发生什么。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
