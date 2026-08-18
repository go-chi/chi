# Agent Note: dsh 告知 agent 其自身源码所在位置

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-dsh-system-prompt-source-path.md) | 中文

## Problem

`dsh` CLI 是自我引用的接口：其 `cordis` 工具包让 agent（智能体）得以查看并修改它自身运行其上的 harness（智能体框架）运行时。但 agent 此前无从得知这份源码在磁盘上的位置。`dsh` 通常以符号链接的形式挂到 PATH 上，并从任意工作目录（正在处理的项目）启动，因此无论是 cwd 还是 `argv` 都无法可靠地指向 harness 检出目录。缺了这个路径，"读取你自己的源码"便只能靠猜。

## Decision

`dsh` 启动器（`apps/cli/src/tui.ts`）从它自身的模块 URL 计算 harness 检出根目录——`fileURLToPath(new URL('../../..', import.meta.url))`，从 `apps/cli/{src,lib}` 向上三级——因此无论 `dsh` 以何种方式启动（PATH 符号链接、任意 cwd），它都能解析到真实的源码位置。在 `boot()` 使插件树就位之后，启动器调用来自 `dsh-app-boot` 的新辅助函数 `addHarnessSourceSection(ctx, sourceRoot)`，它注册一个全局 `harness:source` 提示词段，内容为 `Your own source code is the checkout at <path>; you can read it there to learn how dsh works and how to extend it.`。该段的 order 为 `-99`，恰在 harness 身份开场（`-100`）之后、部署 persona（`0`）之前。

可测试的逻辑放在 `dsh-app-boot` 而非 `apps/cli` 中，因为 `apps/*` 不受覆盖率门禁约束，而 `packages/*` 受约束。解析可选的 `systemPrompt` 服务、注册该段、返回 dispose（资源释放）器，这些都属于按文件 100% 覆盖率生效的地方；启动器只保留那层薄薄的黏合——计算路径、调用辅助函数——由 CLI 的 PTY e2e 覆盖。当就位的插件树没有 `systemPrompt` 服务时，该辅助函数是一个返回 `undefined` 的空操作。

## Scope

只有 `dsh` CLI 会加入这一段。demo bin（`dsh-cli-demo`、`dsh-acp-demo`）原样引导它们已提交的插件树，不会获得 source 段：它们不是自我修改的接口，其检出根目录也不是模型需要知道的事实。

## HMR

该段是针对就位后的 `systemPrompt` 服务自身的 fiber 注册的（通过 `ctx.get('systemPrompt')`），因此对 system-prompt 插件做一次开发态 HMR（热模块替换）重载会丢弃它，直到下一次引导为止。生产环境的 HMR 监视的是配置而非构建产物 lib，所以这只是一个仅限开发态的小瑕疵，可以接受。

## Alternatives considered

**在 system-prompt 服务的构造函数内注册该段。** 那样它会出现在每一个部署中，而不只是自我引用的 CLI，而且源码根目录还得穿过配置才能到达构造函数。这个路径是启动器的事实，所以由启动器负责注入它。

**把整件事都留在 `apps/cli/src/tui.ts` 里。** apps 不受覆盖率门禁约束，因此注册逻辑与服务缺失分支会以未受测的形式发布。把受测的辅助函数抽取到 `dsh-app-boot` 让门禁保持有效；启动器的黏合部分由 CLI 的无密钥 PTY 冒烟测试演练。

**为该路径新增一个 cordis.yml 配置键。** 这个路径不是一项部署选择——它在机制上就是启动器自身的位置。配置键会招致手工填入的路径变陈旧，并新增一个没有合理变化空间的旋钮。

**从 `process.cwd()` 或 `process.argv[1]` 解析。** cwd 是用户的项目，而 PATH 符号链接会使 `argv[1]` 成为符号链接自身的路径；`import.meta.url` 是唯一能抓住真实源码位置的把手。

## Consequences

agent 的系统提示词现在会写明它自己的检出目录，因此 `cordis` 工具包无需一个发现步骤就能读取并编辑 harness 源码。`dsh-app-boot` 为 `ctx.get('systemPrompt')` 的声明合并新增了一个对 `dsh-system-prompt` 的仅类型依赖（peer dependency（对等依赖）+ dev，与 acp 包的副作用型类型 import 模式一致）；不存在运行时依赖。该段是模型可见文本，在 app-boot 单元测试中逐字锁定，并通过 CLI 的无密钥 PTY 冒烟测试端到端断言——该测试以脚本化配置引导 `dsh`、运行一个轮次，再从持久化的 `request/header` 系统提示词中把路径读回来。这一行位于按请求变化的内容之前，所以它不会在多个轮次间扰动 KV Cache。
