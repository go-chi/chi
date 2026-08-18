# Agent Note: parseCmdline 运行 program 自己的 commander action

Status: implemented

[English](2026-08-11-cmdline-program-action.md) | 中文

## Problem

`dsh-cmdline`（[应用自有命令行](../architecture/2026-08-06-app-owned-command-line.md)）的 `parseCmdline` 曾带着一个自造的回调：`CmdlinePlan<T> = (program, ctx) => T`，在解析成功后于该适配器的 catch 之内调用，使 plan 的 `program.error(...)` 与 help/解析错误共用同一条退出路径；它还带有只被测试使用、类型不健全的默认值 `(() => ({}) as T)`，以及没有任何 plan 读取的 `ctx` 参数。这整条接缝复制了 commander 本就定义的席位：命令的 action 处理器在 `parse` 内部运行，从中抛出的 `program.error(...)` 与语法拒绝一样遵循 `exitOverride`。

## Decision

`parseCmdline(ctx, program): void` 只把 commander 的控制流适配到启动器：它解析不可变的 `cmdlineArgs` 快照，并把 help、version、解析错误与 action 的拒绝转换为一次 `ctx.appExit` 请求。应用代码——commander 语法表达不了的校验，以及应用自有服务的 `ctx.provide`——放在 program 自己的同步 `.action()` 里，commander 在解析成功时运行它，在 help 或拒绝时绝不运行。`CmdlinePlan` 导出、其 `ctx` 参数、默认 plan 与 `T | undefined` 返回值全部删除；两个组合包提供方都在各自的 action 中发布。由于 `Command` 类型无法表达 action 前置条件，`parseCmdline` 按结构读取处理器（如同 `isCommanderError` 按结构识别 commander 的控制流错误），在加载时拒绝整棵命令树中没有任何命令声明 action 的 program 并点名它——若无此守卫，漏写 action 的提供方（或仍在传已删除第三参数的陈旧调用方）会解析成功、什么也不发布，只在 settlement 时以依赖行 pending 等待缺席服务的形式浮现。该适配器在整棵命令树而非仅根命令上配置 `exitOverride` 与输出：commander 只在注册时把这些设置复制进子命令，只配置根命令会让已注册子命令的拒绝绕过 `ctx.appExit` 直接调用 `process.exit`。action 必须先拒绝后发布；写在 `program.error(...)` 之前的语句已经执行。

交付前已在 commander 15 上验证：action 在 `parse` 内部运行，其 `program.error(...)` 经 `exitOverride` 抛出 `CommanderError`；help 与 version 在 action 之前短路；有无 action 时的多余参数处理完全一致。

## Alternatives considered

- **保留自造的 `resolve`/plan 回调**：它存在的唯一理由是让应用侧的拒绝共用适配器的 catch，而 commander 的 action 席位本就提供这一点；为解析生命周期的同一时刻再造第二条回调接缝属于重复。
- **返回解析后的 `Command` 交调用方读取**：调用方在解析之后调用 `program.error(...)` 会以未捕获的 `CommanderError` 逃出适配器的 catch，把一次用法拒绝变成插件加载失败；每个带校验的应用都得重建适配器持有的那套 try/catch。
- **把全部校验移进 commander 的 option/argument 解析器**：`InvalidArgumentError` 覆盖逐值检查，但 headless 组合包用自己的用法信息拒绝拼接后的可变参数（"任务不得为空白"），逐参数解析器表达不了。
- **接受没有 action 的 program，依赖 settlement 诊断**：组装好的启动器确实会大声失败（`pending (waiting for service: …)`），但那个错误点名的是消费者而非配置错误的提供方，且没有 settlement 断言的嵌入宿主会静默挂起；加载时守卫直接报出肇事的 program。
- **用裸的冻结 `readonly string[]` 服务替换 `CmdlineArgs` 访问器**：维护者保留该访问器对象作为服务的具名接口。

## Consequences

- `parseCmdline` 失去泛型、回调参数与 `undefined` 哨兵值；调用方不再需要 `if (values !== undefined)` 的发布守卫。
- 应用的命令是自包含的——flag、help 文本、校验与发布效果一起挂在 `Command` 上。
- action 必须是同步的：适配器调用的是 `parse` 而非 `parseAsync`，返回的 promise 会在无人观察的情况下逃出 catch。
