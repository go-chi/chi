# dsh-launch-environment

[English](README.md) | 中文

把本次运行的环境冻结为一份不可变快照，并记住**每个值来自哪一层**。消费方用它而不是 `process.env` 解析面向用户的值，因为各层的可信程度并不相同，而压平后的视图无法区分它们。

| 层 | 来源 id | 它是什么 |
|---|---|---|
| 继承的进程环境 | `process` | 启动 shell、CI 任务或容器传入的东西——本次运行的明确意图 |
| `<invocation cwd>/.env` | `project-env` | harness 被启动于其中的项目；产品信任它配置自己的 agent（智能体） |
| `$DSH_HOME/.env` | `user-env` | 用户自己的机器级默认值 |

这些值同样会进入 `process.env`——用户自己的 `--config` 树和第三方库要读它——但那份压平的视图不是 harness 解析任何值的依据。

## 解析

`get(name)` 按可信度从高到低搜索所有层。`getFrom(name, sources)` 只搜索指定的层，不改变这一可信顺序。

**省略某一层是拒绝，不是降级**——绝不能接受某一层的调用方直接不把它列进去，后续任何重新排序都无法让它回来。提供方适配器三层全列，因为产品信任它所运行的项目；该机制是为那些「并非如此」的决策准备的。

变量名按平台自身的规则匹配：POSIX 上精确匹配，Windows 上不区分大小写。在 Windows 上做大小写敏感的查找会选错层——shell 里的 `deepseek_api_key` 与项目 `.env` 里的 `DEEPSEEK_API_KEY` 对操作系统而言是同一个变量，把它们当成两个就会让项目胜出。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'

declare const ctx: Context
const endpoint = launchEnvironmentOf(ctx).get('DEEPSEEK_BASE_URL')?.value
```

当产品 CLI（命令行界面）启动了这棵树时，`launchEnvironmentOf(ctx)` 返回启动器的快照；否则返回只含继承环境的那一层。该回退并不削弱规则：SDK 宿主或裸 `cordis.yml` 从未发现过任何文件，因此它拥有的一切确实就是它被启动时的环境。

## 已知限制与暂缓事项

- **快照不是子进程边界**：每一层同样会被物化进 `process.env`，因此项目里的普通变量会按 [`dsh-subprocess`](../../subprocess/subprocess/README.md) 的清洗规则抵达子进程。产品启动器的 [`.env` 约定](../../boot/app-boot/README.md#profiles) 会在物化之前拒绝 bootstrap 变量。
- **没有按工作区划分的层**：项目层是*调用*目录，在启动时固定。之后在 Web UI 中选择的工作区不贡献任何内容，这是刻意的：跟随它等于让模型自己的工作区在会话中途改变 harness 的环境。
