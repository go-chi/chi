# Agent Note: `dsh run` 负责一次性 headless 执行

Status: implemented
Archived: 2026-08-10

[English](2026-08-08-dsh-run-headless-command.md) | 中文

> **命令语法已被取代。** [应用现在持有自己的命令行](../architecture/2026-08-06-app-owned-command-line.md)：headless 启动行从 `dsh --profile headless <task...>` 解析任务，启动器不再包含 `run` 调用，也不再把任务文本 patch 进配置行。本笔记保留被否决的启动器持有设计背景；它选定的直接执行与完成约定仍由 [headless 是直接 core 入口](../architecture/2026-08-09-headless-direct-core-entry-point.md)持有。

## 问题

通用 profile 启动与一次性任务执行具有不同的生命周期约定。若根语法接受可选任务文本，同一种 argv 形态会表示常驻进程或终止式任务，具体含义取决于组合完成后才发现的插件配置行。它还会把 profile 实现细节暴露成主要用户命令，并使自定义 profile 缺少明确的一次性入口。

`run` 动词必须只有一种顶层含义。与应用文件执行共用该动词，或根据位置参数形态推断含义，都会产生相同的歧义。

## 决策

一次性执行采用以下语法：

```text
dsh run [--profile <name>] [--patch <path>...] <task...>
```

`--profile` 默认为 `headless`，并支持自定义一次性组合。`--patch` 可重复使用，并占据正常的 overlay 层。Commander 用空格拼接可变数量的任务参数，并在启动前拒绝缺失或空白任务。

`RunInvocation` 是单独的 `DshInvocation` 成员。通用 profile 调用不携带任务状态，也不接受位置参数。两条分派路径都使用 `runProfile`：profile 启动省略 `task`，而 `run` 提供该字段。缺少 `headless-runner` 的一次性 profile 会触发组合行检查；如果启动的 profile 包含该行却未提供任务，错误会指向 `dsh run --profile <name> "<task>"`。

[profile 插件组合包决策](../architecture/2026-08-05-profile-plugin-bundles.md)负责组合。[Headless 是直接 core 入口](../architecture/2026-08-09-headless-direct-core-entry-point.md)负责执行约定：一个新的持久化会话、stdout 上的最终 assistant 文本、completed／非 completed 的退出状态映射、成功时为空的 stderr、无监听端口，以及 Agent 完全停稳且会话 flush 后的有界信号关闭。

`run` 动词只负责一次性任务执行。应用文件启动需要不同的命令名。

## 考虑过的替代方案

| 替代方案 | 约定不匹配之处 |
|---|---|
| 把任务文本放在根 profile 启动命令上 | 生命周期含义依赖解析后才发现的插件配置行。 |
| 接受 `dsh -p` 等根命令别名 | 预发布语法获得不属于任何当前命令的兼容分支。 |
| 要求指定 `--profile headless` | 随附的一次性 surface 失去最短的规范写法。 |
| 将 `dsh run` 用于应用文件 | 一个顶层动词具有两种含义，主要任务命令也变得间接。 |
| 添加仅转发的 `apps/cli/src/run.ts` | 命令归属被拆分，却没有隐藏任何复杂度。 |

## 后果

帮助信息、文档、解析器测试、构建后二进制验收、PTY 关闭覆盖和组装应用的无密钥快照均使用 `dsh run`。自定义一次性 profile 使用 `--profile`；常驻 profile 启动与配置 dump 使用根 profile 语法。应用文件执行是独立的命令关注点。
