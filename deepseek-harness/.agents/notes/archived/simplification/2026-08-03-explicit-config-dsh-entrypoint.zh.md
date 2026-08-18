# Agent Note: 显式配置的 dsh 入口

Status: implemented
Archived: 2026-08-08

[English](2026-08-03-explicit-config-dsh-entrypoint.md) | 中文

## 问题

裸 `dsh` 会隐式选择产品 TUI。这使一条命令负责终端生命周期、会话身份与恢复移交、onboarding、源码 workspace 快捷入口、引导式升级会话、个人配置监听，以及一整套规模庞大的应用级 PTY 和 transcript（文本记录）快照测试。该默认行为还隐藏了真实的组合边界：`--config` 是 TUI overlay 之上的可选第三层，而不是 raw 启动器所需的部署定义。

共享 base 有意保持中性：它提供各项能力，但不会创建启动 agent（智能体）或交互入口。将中性 base 与隐式应用配对，使 raw 配置组合缺乏明确边界，也使产品政策留在 CLI（命令行界面）中，而不是由调用方选定的 overlay 持有。

## 决策

raw 执行方式为 `dsh --config <path>`。指定文件必须是一份 Include 补丁列表，并在同一 include 层级直接应用到 `apps/cli/config/base.cordis.yml` 之上。启动时必须提供该文件；它不是完整的替换配置树，也不会继承 `apps/cli/config/web.cordis.yml` 或 `$DSH_HOME/config.yaml`。相对路径从调用目录解析。启动错误会明确报错；SIGINT 和 SIGTERM 会先对根上下文执行 dispose（资源释放），再退出。

raw 诊断形式仍然无需启动：`dsh --dump-default-config` 打印 base，`dsh --config <path> --dump-config` 则打印 base 与必需 overlay 的合成结果。转储过程使用 Include 实现的补丁算法和 YAML 方言。

CLI 不再交付 TUI 应用。TUI overlay、启动器、首次运行 onboarding 资产、应用级 TUI fixture（测试前置数据）、PTY harness、终端流程和快照均已删除。`meta` 与 `upgrade` 子命令、对应的实验功能门禁、默认 surface 恢复入口，以及整棵配置树的 `--config-replace` 路径也随该应用一并删除。安装器不再提供界面选择器，只构建并启动 Web。

`dsh web` 保留共享 base、Web overlay 与个人或显式用户层。`dsh -p` 保留一次性 Web/headless 组合。可复用 TUI 包（package）在本入口变更后起初保留，随后[全包移除决策](2026-08-04-remove-tui-package.md)将其及 SDK 接口删除。

本决策取代以下记录中专用于 `dsh` 的部分：[独立 TUI 入口](../../archived/feature/2026-07-17-dedicated-full-screen-tui-front-door.md)、[个人配置](../feature/2026-07-20-dsh-cli-personal-config.md)、[引导式 skill 命令](../../archived/feature/2026-07-28-dsh-guided-skill-session-commands.md)、[meta workspace](../../archived/feature/2026-07-28-dsh-meta-source-workspace.md)、[共享配置 overlay](2026-07-29-shared-base-config-overlays.md)、[配置转储](../../archived/feature/2026-07-30-dsh-dump-config.md)、[首次运行欢迎页](../../archived/feature/2026-07-30-versioned-tui-first-run-welcome.md)和[实验性子命令门禁](../../archived/feature/2026-07-31-experimental-subcommand-gate.md)。后续的[全包移除决策](2026-08-04-remove-tui-package.md)取代了其中关于可复用包的决策，并整合了已删除的启动器身份记录。

## 验证

解析器测试要求 raw 启动提供 `--config`，并拒绝已删除的命令名和不兼容的选项组合。构建后二进制验收测试在不使用 tsx 的情况下运行已发布的 JavaScript 入口，检查仅含 base 及 base 加 overlay 的转储，并传入无效的 raw 提供方 overlay，以证明启动失败能够结束并退出，而不会挂起。源码启动兼容性测试通过 `bin/dsh` 检查同一条缺少必需配置的诊断。`apps/cli` 不再包含任何 TUI demo 或测试。

## 曾考虑的替代方案

**保留裸 `dsh` 作为 TUI，并新增显式配置子命令。** 不予采纳，因为 CLI 仍需持有两套互不相关的应用政策，并保留仅供 TUI 使用的启动器、onboarding 和测试基础设施。

**允许裸 `dsh` 启动中性 base。** 不予采纳，因为 base 不会创建 agent 或交互入口。进程成功结束启动但没有可用入口，会掩盖缺失的部署决策。

**保留 `--config-replace` 以支持完整配置树。** 不予采纳，因为 raw 执行现在只有一份组合契约：在产品 base 之上施加一份必需的 overlay。完整配置树部署可以使用通用 Cordis loader 或专用应用二进制文件，无需为 `dsh --config` 增加第二种含义。

**随产品入口一并删除 TUI 包。** 最初不予采纳，因为仅移除一项已交付应用本身并不要求移除可复用 UI 实现。当已交付组合与独立消费方均不复存在后，[全包移除决策](2026-08-04-remove-tui-package.md)采纳了这一方案。

## 后果

调用 `dsh` 时如果既不指定模式，也不提供 raw 配置，将产生用法错误。既有的 TUI 启动、`meta`、`upgrade`、恢复和整棵配置树替换调用会停止工作，且不提供兼容别名。根据发布前兼容性立场，这是可以接受的，并能使支持的命令语法保持精简。

raw 部署必须在 overlay 中声明 agent 和入口配置项，使应用边界可供评审，并能继续吸收底层 base 的更新。它们不会隐式接收个人配置；需要该政策的部署必须自行组合。Web 仍是安装后提供的交互式产品 surface，headless 与自动化入口仍保持独立。

重新引入已交付的终端应用，需要有具体产品需求，采用具名入口模式而非隐式 raw 默认值，并建立自身当前有效的快照与生命周期验收面。
