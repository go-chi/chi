# Agent Note: `dsh migrate`/`dsh upgrade` 以 skill 播种首轮

Status: implemented
Archived: 2026-08-03

[English](2026-07-28-dsh-guided-skill-session-commands.md) | 中文

## 问题

有两个反复出现的流程都以用户手动调用某个 skill 并回答其问题开始：从其他编码 agent 迁移，以及升级本 checkout。二者都要求用户知道该 skill 存在，并把 `/skill:dsh-migrate` 或 `/skill:dsh-upgrade` 作为会话首轮键入。一个专用入口命令若能让用户直接进入该引导式会话，便可省去这一发现步骤。

## 决策

`dsh migrate` 与 `dsh upgrade` 以全新会话启动普通 TUI，其首轮自动调用一个内置 skill（`dsh-migrate`、`dsh-upgrade`），效果等同于用户键入 `/skill:<name>` 并回车。

播种复用现有的 TUI skill 路径，而非新增一条。`createTuiChat` 已有 `invokeSkill(name, instructions)`——即键入 `/skill:<name>` 所走的代码，包含“未知 skill”通知。启动器通过一个新的启动上下文槽 `INITIAL_SKILL_KEY`（`tuiInitialSkill`）把 skill 名称传给 TUI，与 `CONFIGURED_AGENT_IDENTITIES_KEY`/`TUI_GOODBYE_MESSAGE_KEY` 一致：`ctx.provide` 是从启动器 argv 进入 Loader 挂载插件的唯一通道。TUI 的 `apply()` 读取该槽并折叠进 `config.initialSkill`；`ui.start()` 成功后，`createTuiChat` 在其被设置时调用一次 `invokeSkill(config.initialSkill, '')`。

**新鲜性在启动器而非 TUI 中把关。** `runSkillSession` 总是创建全新会话，且仅在 `resumeSessionId === undefined` 时提供该槽，因此之后 `dsh --resume <id>` 恢复该会话时是普通 TUI 会话，不会重复注入。TUI 保持通用：它只是把接到的 skill 在启动时调用一次。

**`migrate`/`upgrade` 不接受任何默认界面选项**（`upgrade` 另带[实验性门槛](2026-07-31-experimental-subcommand-gate.md)的 `--experimental`）。它们不带 `--resume`、`--config` 或 `-p`；引导式全新会话入口没有可恢复或可重配置的内容。任何泄漏的默认界面选项都会明确报错，与 Commander 适配器中 `web`/`meta` 的拒绝模式一致。两个 mode 共用一个 `SkillSessionInvocation` 判别式（`mode: 'migrate' | 'upgrade'`）；`bin.ts` 将 mode 映射为 `dsh-${mode}`。

`dsh-migrate` skill 内置于 `skills/`（经 `DSH_BUNDLED_SKILL_DIR` 交付，与 `dsh-upgrade` 相同）。若未说明源 agent，它会先询问是哪个（opencode/pi/Claude Code/Codex），再把每项能力——workspace 指令、个人覆盖、skills、hooks、MCP、API/env——映射到对应的 DSH 等价物，并基于仓库实际的表面（`hooks-claude`/`hooks-codex` 桥、`~/.dsh/{config.yaml,.env,AGENTS.md,skills/}`、`AGENTS.md`/`CLAUDE.md`、`mcporter`）落地；当某能力无等价物时明确说明。

## 测试

`apps/cli/tests/args.spec.ts` 新增 `migrate`/`upgrade` 的路由（裸判别式），以及每个子命令两侧任一泄漏选项的退出码 1。

`packages/ui/tui/tests/tui.spec.ts` 在既有 skill describe 块中新增两个伪终端用例：设置 `config.initialSkill` 时无需用户输入即把渲染后的 skill 正文作为首轮投递；未知的初始 skill 以通知形式报告且不发送。`runSkillSession` 本身是模块 `v8 ignore` 块内的组装，与 `runTui`/`runMeta` 相同。

无 keyless PTY 快照：依据维护者对本次改动的范围裁定，单元覆盖加交互式验证已足够，且播种走的是已有快照的 `/skill:` 渲染路径。两个命令均已在 tmux 中从临时 cwd 交互式验证：`dsh migrate` 加载 `dsh-migrate` 并询问源 agent；`dsh upgrade` 加载 `dsh-upgrade`，后者引入 `dsh-customize` 并开始 checkout 发现。

## 考虑过的替代方案

**预填输入框并让用户按回车。** 已否决：需要新增编辑器预填 seam，且仍需一次按键。自动提交复用 `invokeSkill`，实现预期的一命令入口。

**播种自然语言指令（“使用 dsh-migrate skill……”）而非 `/skill:<name>`。** 在此否决：字面 skill 调用路径会确定性地把 skill 正文渲染进首轮，与手动命令完全一致，而不依赖模型自行选择加载该 skill。

**在 `migrate`/`upgrade` 上支持 `--resume`。** 已否决：它们是一次性引导入口。恢复的会话是可经默认界面 `dsh --resume <id>` 到达的普通 TUI 会话；恢复时重新注入 skill 会重复首轮。

**在 TUI 之外读取 `INITIAL_SKILL_KEY`（如同 `agent-loop` 读取 `CONFIGURED_AGENT_IDENTITIES_KEY` 那样），而非在 TUI 的 `apply()` 中。** 无此必要：`initialSkill` 是在 `createTuiChat` 中消费的 TUI `Config` 字段，因此在 TUI 入口处把该槽位折叠进配置，可以让它与其他由启动器持有的运行时读取（`tuiResumeHost`、`tuiGoodbyeMessage`）并列，且不触及任何其他插件。

## 后果

迁移或升级从任何位置都只需一条命令，且引导 skill 已被调用。启动器→TUI 的初始 skill 槽可被未来任何引导式会话命令复用；TUI 的契约是“在启动时调用一次这个具名 skill”，而新鲜性/恢复策略留在拥有会话身份的启动器一侧。[TUI skill 斜杠命令](2026-07-21-tui-skill-slash-command.md)仍是该机制；本 note 在其之上新增了一个由启动器驱动的自动调用，并未取代它。
