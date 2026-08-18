# Agent Note: 通过单个 Commander 适配器解析 `dsh` 的 argv

Status: implemented
Archived: 2026-07-26

[English](2026-07-24-dsh-commander-argument-adapter.md) | 中文

## 问题

`dsh` 的 CLI（命令行界面）入口（`apps/cli`）以三种手写方式解析 argv，这些方式无法组合，也不提供 `--help`/`--version`。`bin.ts` 通过原始检查进行分发：先判断 `argv[0] === 'web'`，再判断 `argv.includes('-p') || argv.includes('--prompt')`，否则走 TUI。这种方式对位置不敏感：位置错误的 prompt 标志或配置路径可能把模式路由错，而 `argv.includes('-p')` 无法区分真正的标志和偶然出现的 token。`headless.ts` 和 `web.ts` 各自运行自己的 `node:util` `parseArgs`，并内联校验 host/port，而 `dsh-app-boot` 携带 `parseResumeArg`——一个约 30 行的定制扫描器，为 `--resume` 重新实现了标志、`=` 形式、取值和重复的处理。用法说明只有一行硬编码的 `usage: dsh -p "task"`；既没有版本标志，也没有渲染出的帮助信息。

## 决策

argv 只在 `apps/cli/src/args.ts` 中解析一次，并使用 Commander 适配器（SDK bin `create-sdk`、`dsh-scripts` 已经统一采用的同一解析器）。`parseDshArgs(argv, version)` 返回仅包含三种实际模式的判别式 `DshInvocation` 联合类型：`{ mode: 'tui', config?, resume? }`、`{ mode: 'headless', prompt }` 或 `{ mode: 'web', host?, port?, dev }`。它**不会**将帮助、版本信息或错误建模为数据：这些情况由 Commander 处理，在触发处打印用法或诊断信息并退出。`exitOverride()` 会将每种情况转为抛出的 `CommanderError`，并携带预期退出码（帮助或版本为 0，解析错误或领域错误为 1）；唯一一处 `try/catch` 位于 `parseDshArgs` 中，捕获错误后调用 `process.exit`。

`bin.ts` 只调用适配器一次，并对 `mode` 做分支切换（封闭联合类型，默认分支为 `satisfies never`），仅动态导入所选模式对应的模块；只有合法的非帮助请求才会进入这段分支逻辑，因此其中没有帮助、版本或错误分支。每个模式模块只消费已解析好的值：`runTui(config, resume)`、`runHeadless(task)`、`runWeb(host, port, dev, workspaceRoot)`，都不会再次读取 argv。整个 CLI 由**单个 Commander 程序**实现：默认接口（不使用子命令时）只包含选项标志——`--config <path>`、`-p/--prompt <task>`、`--resume <id>`——而 `web` 是通过 `program.command('web')` 定义的真正子命令。默认接口不接受位置参数，因此 `web` 可以成为真正的子命令且不会发生位置参数冲突，`dsh --help` 也会原生列出 `web`，无需手工拼接命令文本。默认命令和 `web` 子命令的处理函数会设置解析得到的模式，随后对 Commander 无法表达的领域校验调用 `command.error(...)` 立即终止（打印信息并以退出码 1 退出）：`--prompt` 选择 headless 模式；如果任务为空，或调用中还包含 `--config` 或 `--resume`，它会拒绝调用，而不会静默丢弃 TUI 输入；空的 `--resume=` id 会显式失败（agent-loop 把 `''` 视为不恢复）。Commander 会将 `web` token 前后的默认接口选项都解析进 `program.opts()`；由于 `web` 不与默认接口共用任何选项，`web` 子命令的处理函数会拒绝误入的 `--config`/`-p`/`--resume`（`dsh web -p x`、`dsh --config c.yml web`），而不是静默启动服务并丢弃这些选项。`dsh web` 的 `--host`/`--port` 是未经校验、直接透传的覆盖值：适配器既不设置默认值，也不执行校验，只使用 `Number` 将端口字符串转换为数字（schema 要求该值为数字）。`dsh-host-webserver` 的 schemastery `Config`（`host` 是 `127.0.0.1`/`0.0.0.0` 字面量联合类型，`port` 是不大于 65535 的自然数）是默认值与有效性的唯一真源：未提供标志时，随产品提供的 `apps/cli/cordis.yml` 中 `webserver` 配置项保持原值；`AppCLIEntry` 将显式标志的值直接写入该配置项，因此无效的 host/port 会在启动时触发 schema 校验并显式失败，而不是在参数解析阶段失败。`--dev` 会挂载客户端 HMR（热模块替换）驱动，并启用构建产物监视，`--workspace-root <path>` 则是直接透传给 `AppCLIEntry` 的选项（按名称创建 workspace 时使用的父目录）。重复提供 `--resume`，或后续标志被捕获为 `--resume` 或 `--prompt` 的值，都是 Commander 的标准行为（最后一次取值生效／将下一 token 作为值），本适配器不作干预；无效 id 会在下游无法加载会话时显式失败。`--version` 读取本应用的 `package.json`。

`dsh` 不接受位置参数。`--config <path>` 指定一份替代 Cordis 配置树，系统启动该配置树而不是随产品提供的默认配置树；该标志仅用于让演示和测试调用点（`demo:cordis`、`demo:code-mode`、无密钥 PTY 冒烟测试）通过随产品提供的 bin 启动一份示例树。直接运行 `dsh` 会启动随产品提供的配置树，并叠加 `~/.dsh/config.yaml` 个人覆盖；实际用户从不传入 `--config`。

CLI 解析完全位于 `apps/cli` 中。`dsh-app-boot` 提供启动、环境变量、配置和个人覆盖辅助函数，不包含 argv 扫描器。

## 通过启动上下文恢复会话

`dsh --resume <id>` 是恢复持久化会话的唯一方式，无需环境变量。`runTui` 通过 `boot` 的 `prepare(ctx)` 钩子，在启动上下文中提供已解析的 id：`ctx.provide(RESUME_SESSION_ID_KEY, id)`（`dsh-app-boot` 的一项导出，值为 `'resumeSessionId'`）；随产品提供的 tui-agent/cordis 配置将该值作为裸标识符读取：`resumeSessionId: !!js "typeof resumeSessionId === 'string' ? resumeSessionId : undefined"`。这个表达式需要加引号，否则 YAML 会把 `?` 和 `:` 解析为映射；`typeof` 守卫使从未提供该槽位的启动器也能正常运行。`/resume` 原地交接（`process.execve`）根据已解析的值将重新执行时的 argv 构造成 `dsh --resume=<id> [--config <path>]`。

## 唯一的终端入口：`dsh`

`dsh` 是唯一的终端入口；`dsh-tui-demo` 包（package）提供 TUI 应用组合插件，随产品提供的配置会挂载该插件，而该包不提供自己的 bin。`demo:cordis`、`demo:code-mode` 以及 tui-agent 和 cordis-agent 的无密钥 PTY 冒烟测试都通过 `apps/cli/src/bin.ts` 启动，并传入 `--config <path>`。`dsh` 的 TTY 守卫会在启动前拒绝标准输入输出接入管道的调用，并提示自动化场景使用 `dsh -p`；`apps/cli/tests/built-bin.e2e.ts` 锁定了这一行为：该测试将标准输入输出接入管道，并通过普通 Node 运行构建后的 `lib/bin.js`（e2e Vitest 的 include 包含 `apps/cli/tests`）。`cli-demo`、`acp-demo` 和 `jsonrpc-demo` 保留各自的 bin，因为它们分别提供 `dsh` 所没有的独立接口（headless、ACP（Agent Client Protocol）、JSON-RPC）。

## 包拓扑

参数解析留在 `apps/cli`（组装层）内，而不是 `packages/*` 库中：它是这一个应用自身的路由，而非可复用的 seam。`dsh-app-boot` 收缩为纯粹的 boot 胶水代码，不再承担 CLI 解析职责。`commander@^15` 被加入 `apps/cli/package.json`，与 SDK bin 锁定的版本一致。

## 考虑过的替代方案

**保留 `node:util` `parseArgs`，只统一分发。** 已否决：`parseArgs` 没有子命令模型、没有渲染出的帮助、也没有版本标志，因此 `web` 路由和 `--help`/`--version` 仍将保持手写。本仓库其他 CLI 已经选择了 Commander；单独为 `dsh` 引入第二套解析器方式，正是这次变更要消除的碎片化。

**保留 `parseResumeArg` 作为共享辅助函数，并向它喂入 Commander 的残余参数。** 已否决：整件事的核心就是要退役这个定制扫描器。Commander 原生解析 `--resume`（空格和 `=` 形式、缺值、位置无关性）；为这一个标志保留一条平行的手写路径，只会保留这次变更要终结的重复。

**使用裸 `dsh <config>` 位置参数指定替代配置树。** 已否决：根级位置参数与真正的 `web` 子命令无法在同一个 Commander 程序中共存（子命令会占用第一个位置参数）。位置参数会迫使系统把位于首位的 `web` 作为保留 token 分发给另一个解析器，并手工维护一行 `web` 文本，供 `--help` 显示。只有演示和测试调用点需要指定替代配置树，因此 `--config` 标志既能满足这些调用点，又能让默认接口不包含位置参数；这样，`web` 就能在单个程序中成为普通子命令，并由原生 `--help` 展示。

**把参数解析做成 `packages/*` 的 seam。** 已否决：`dsh` 之外没有任何消费方使用它，而能力 seam 不应被提前拆分。这个 Commander 适配器是 `apps/cli` 自身的事务。

**保留 `RESUME_SESSION_ID` 作为恢复通道**：不予采纳。`--resume` 已被解析成 bin 当前持有的值；若再通过环境变量传递并由配置重新读取，只会引入无益的间接层，还会使演示 bin 保留第二条仅依赖环境变量的恢复路径。在启动上下文中提供 id，与 `boot` 的 `prepare` 钩子为 `tuiResumeHost` 提供值所采用的是同一通道。

**保留 `dsh-tui-demo` bin**：不予采纳。它与 `dsh --config <path>` 的功能完全重复；保留它还会迫使演示专用的 `RESUME_SESSION_ID` 回退路径继续存在。配置实际挂载的是该包的插件；冗余的只有作为终端入口的 bin，而 `dsh` 是唯一的终端入口。

## 测试

`apps/cli/tests/args.spec.ts`（新增；`apps/*/tests` 加入 vitest include，`apps/cli/tests` 加入 `tsconfig.host.json`）覆盖适配器的关键行为：根据参数形态进行模式路由（包括 `web --dev` 和 host/port 透传），并通过 `process.exit` spy 捕获适配器的显式报错检查（恢复 id 或提示词为空、`--prompt` 与配置或 `--resume` 混用、未知选项、多余的位置参数）以及 `--help`/`--version` 的退出码。host/port 的有效性由 webserver schema 负责，并由 web 冒烟测试在启动时验证，不属于适配器测试的覆盖范围。`examples/tui-agent/tests/tui-keyless-smoke.e2e.ts` 中的两组 PTY 冒烟测试现在都驱动真实的 `apps/cli/src/bin.ts`：`tui-agent` 组通过 `--config` 启动示例树，`dsh CLI` 组覆盖默认启动、个人覆盖、无效配置、配置对 `--resume` 的接收、通过 `process.execve` 原地恢复交接，以及包含源码路径的系统提示词。`examples/cordis-agent/tests/keyless-smoke.e2e.ts` 同样通过 `dsh` 启动。`packages/ui/app-boot/tests/app-boot.spec.ts` 移除其 `parseResumeArg` 和 `replaceResumeArg` 测试块；TUI 单元测试和快照 fixture（测试前置数据）使用 `dsh --resume {session}` 恢复命令。

## 影响

`dsh` 会渲染 `--help`/`--version`，并以一致方式显式报告解析错误；模式路由不依赖标志位置。argv 解析集中在一处，并与 SDK bin 共用一套解析器方式，代价是 `apps/cli` 依赖 `commander`，且 Commander 的解析语义（错误字符串和 `exitOverride` 契约）成为 CLI 入口的一部分。`dsh-app-boot` 不提供任何 CLI 解析接口；需要 `--resume` 式解析的消费方通过组合 Commander 来实现。会话恢复通过启动上下文完成，而不使用环境变量；`dsh` 是唯一的终端入口；`dsh-tui-demo` 包是由配置挂载的插件组合包。
