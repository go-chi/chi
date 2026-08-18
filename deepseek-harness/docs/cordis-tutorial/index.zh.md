# Cordis 教程

[English](index.md) | 中文

Cordis 是 DeepSeek Harness 底层的插件框架：它是一个小型运行时，其中的每项能力，包括工具、LLM（大语言模型）适配器、文件访问乃至 agent loop（智能体循环）本身，都是挂载到共享上下文中的插件。本教程通过动手实践讲解 Cordis：每一章都是一个可以运行的示例，你将在本仓库内的临时目录中逐步构建它，最后把一个插件接入真实的 harness 服务。

本教程面向 agent 开发者。你不需要深入掌握 TypeScript；下文的 [TypeScript 说明](#typescript-notes)会解释可能陌生的语法，并且每一章都会给出确切命令和预期输出。

如果你想阅读精简的概念参考，而不是逐步实践，请参阅 [Cordis 入门](../cordis-primer.md)。详尽的 API 参考见[子系统页面](../subsystems/core.md)上生成的 `cordis-surface` 区块，以及 [Cordis 核心 API](../cordis-api/context.md) 页面。

如果你要为 harness 本身编写插件——由 `cordis.yml` 加载、在 Web UI 中驱动，而不是下面这个启动器——请从[第一个 Harness 插件](../user/develop/basic/index.md)开始。

<a id="setup"></a>

## 准备工作

你需要克隆本仓库并安装依赖；[开发指南](../development.md#setup-tutorial)列出了前置条件。本教程不需要 API 密钥；所有示例均可在无密钥环境中运行。

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
```

创建各章使用的临时目录。`tmp/` 已被 git 忽略，因此你在其中写入的任何内容都不会进入版本控制：

```sh
mkdir -p tmp/cordis-tutorial
cd tmp/cordis-tutorial
```

每一章都从该目录运行同一条命令：

```sh
node --import tsx ../../vendor/cordis/bin.js
```

这个单文件启动器（见 [vendor/cordis/bin.js](../../vendor/cordis/bin.js)）会创建根 `Context`、挂载 Loader 插件，并让它从当前目录加载 `./cordis.yml`。其余所有内容，包括有哪些插件以及如何配置它们，都来自你稍后将编写的 YAML 文件。`--import tsx` 标志让 Node 无需构建步骤即可运行配置所指向的 TypeScript 文件。

## 章节

1. [你的第一个插件](01-first-plugin.md)：插件是函数，由 loader 挂载。
2. [生命周期与 effect](02-lifecycle-and-effects.md)：由 Cordis 管理的注册会在所属插件卸载时撤销。
3. [服务](03-services.md)：在 `ctx` 上公开一项能力，并通过 `inject` 依赖它。
4. [事件](04-events.md)：类型化事件、广播分发和 waterfall（瀑布式事件）的短路行为。
5. [配置](05-config.md)：读取 `cordis.yml` 中经过校验的配置，并在输入错误时明确报错。
6. [组合与 HMR（热模块替换）](06-composition-and-hmr.md)：把配置文件作为插件树，使用热重载，并诊断始终无法加载的插件。
7. [进入 harness](07-into-the-harness.md)：基于真实的 harness 服务注册一个可由模型调用的工具。

<a id="typescript-notes"></a>

## TypeScript 说明

这些示例使用了普通现代 JavaScript 之外的三项 TypeScript 功能：

- **类型注解**描述值，但不会改变运行时行为：`ctx: Context` 表示 `ctx` 具备 Cordis 上下文 API，`who: string` 接受文本，而 `string[]` 表示字符串数组。
- **`import type { Context } from '@deepseek-ai/cordis'`** 只导入类型信息。它在运行时会消失，因此仅为类型注解使用 `Context` 的插件文件不会增加运行时依赖。
- **声明合并**（`declare module '@deepseek-ai/cordis' { ... }`）会为 Cordis 已经声明的接口添加你的条目，例如新 `ctx.greeter` 属性的类型或事件名称。它不会生成任何运行时接线；插件必须另行提供服务或发出事件。第 3 章会完整展示该模式。

第 5 章还会使用 `interface` 描述配置对象的字段，并使用 `Schema<Config>` 这类泛型表示 schema 校验哪些对象字段。你可以直接照写这些声明；周围的正文会解释每项声明连接了什么。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
