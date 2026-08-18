# Agent Note: `dsh meta` 以 harness 检出为 workspace 启动 TUI

Status: implemented
Archived: 2026-08-03

[English](2026-07-28-dsh-meta-source-workspace.md) | 中文

## Problem

`dsh` 把调用目录视为 workspace，这正是它能作用于任意项目的原因。但因此，开发 dsh 自身就得先 `cd` 到检出目录——而该目录并不是一个好记的路径：源码安装会把它放在一个容器目录下、作为带时间戳的 staging 工作树（`~/.dsh/source/staging-<timestamp>`），并由 `current` 符号链接指向，因此每次升级后目标都会变化。`harness:source` 提示词段已经*告知* agent 其源码位置，`cordis` 工具集也能修改该运行时，但人类仍需手工定位该目录才能在其中开始会话。

## Decision

`dsh meta` 在任意目录下都以 harness 检出为 workspace 启动普通 TUI。

目标是 `apps/cli/src/tui.ts` 中的 `SOURCE_ROOT`——`fileURLToPath(new URL('../../..', import.meta.url))`，从 `apps/cli/{src,lib}` 向上三级——与 `harness:source` 提示词段所用的常量完全相同，因此 workspace 与告知模型的路径不可能发生偏离。它跟随启动器的真实路径，所以经由 `current` 的 PATH 符号链接会解析到当前生效的那个 staging 工作树。

机制是 `runTui` 内的一次 `process.chdir(workspace)`，由一个可选第三参数把守，只有 `meta` 分派会传入。在已交付的配置树中，cwd *就是* workspace 的接缝：`examples/tui-agent/cordis.yml` 由它派生出会话 cwd（`!!js process.cwd()`）、`./.sessions` 持久化根目录以及 HMR 监视根目录（`root: ['.']`），因此一次 chdir 会让三者一并移动，meta 会话则落在检出目录中被 gitignore 的 `.sessions/` 内。它在两层 `.env` 都加载之后执行——bin 对调用目录的加载与个人层加载——因此“环境中已有的值 > 项目 > 个人”的优先级不受影响。`DEFAULT_CONFIG` 与 `SOURCE_ROOT` 都是绝对路径，且 TUI 模式不传 snapshot mode，所以配置解析与 chdir 无关。

`meta` 始终启动新会话，且不接受任何默认界面选项；它唯一的选项是[实验性门槛](2026-07-31-experimental-subcommand-gate.md)的 `--experimental`。`--config` 会针对 harness workspace 启动其他配置树，那是默认界面的 `--config` 场景，而不是该命令的场景；`-p` 并非交互式，恢复则通过 `dsh --resume <id>` 重新进入已持久化会话自身的 workspace。任何泄漏的默认界面选项都会明确报错。

## Testing

`apps/cli/tests/args.spec.ts` 钉住 `meta` 的路由、对每个泄漏的默认界面选项的拒绝，以及对旧名称 `experimental-meta` 的拒绝。该分派本身是 `bin.ts` 既有 `v8 ignore` 块内的组合代码。

该 mode 没有 keyless PTY 冒烟测试。冒烟框架会为每次运行提供临时 cwd，但 `dsh meta` 刻意 chdir 到真实检出目录，因此冒烟测试会在测试中途把 `.sessions/` 写入实际工作树。要正确覆盖它需要一个可注入的目标目录——为了一行 chdir 而引入的测试专用 seam，本 note 不予采纳。

取而代之的是交互式验证。从 `$HOME` 启动后，`pwd` 工具调用报告的是该检出目录，git 解析到其分支，会话日志落在该检出的 `.sessions/` 下（`~/.sessions` 未被触及，工作树也没有未被忽略的残留），并且从其他目录运行的普通 `dsh` 仍使用调用目录。

## Alternatives considered

**通过 `boot` 与配置树显式传递 workspace。** 这可避免修改进程级状态，但已交付的配置在三处读取 cwd（`!!js process.cwd()`、`persistenceRoot`、HMR `root`），每一处都需要各自新增管线与配置键才能保持一致。启动前 chdir 只在本就表达该含义的接缝上表达一次“这就是 workspace”。

**在默认界面上加一个 `--experimental-meta` 标志。** 拒绝：默认界面是纯选项形式，以免子命令与位置参数冲突；而一个会静默改变 workspace 的标志读起来像是对当前目录的修饰，而非另一个目标。`meta` 与 `web` 并列符合既有形态。

**解析 `~/.dsh/source/current` 而非启动器自身路径。** 拒绝：当直接调用某个非安装检出的 `bin/dsh` 时，它会与 `harness:source` 提示词路径产生偏离——告知模型一个源码根目录，却在另一个目录中工作。

## Consequences

在 dsh 自身源码上开启会话变成了在任意位置执行 `dsh meta --experimental`（在 `DSH_EXPERIMENTAL=1` 下可直接执行 `dsh meta`），且该 workspace 必然就是告知模型的那个检出目录。该命令始终启动新会话；之后，普通的 `dsh --resume <id>` 会恢复该会话并进入其已持久化的 workspace。

`runTui` 新增一个可选第三参数，因此 workspace 覆盖是在拥有 TUI 组合逻辑的那唯一一个函数上可见的，而不是隐藏在它的第二份副本中。
