# Agent Note: 实验性子命令由 `--experimental` 或 `DSH_EXPERIMENTAL=1` 把守

Status: implemented
Archived: 2026-08-03

[English](2026-07-31-experimental-subcommand-gate.md) | 中文

## Problem

`meta` 与 `upgrade` 两个入口把实验性状态写在名字里：`dsh experimental-meta` 和 `dsh experimental-upgrade`。前缀让每次调用都变得冗长，而在稳定时重命名命令会破坏对它的所有引用——肌肉记忆、脚本与文档皆然。这种状态应当由一个显式选择加入的门槛承载，而不是由名字承载。

## Decision

`dsh experimental-meta` 改为 `dsh meta`，`dsh experimental-upgrade` 改为 `dsh upgrade`。二者只有在调用时传入各自的 `--experimental` 标志、或环境中带有 `DSH_EXPERIMENTAL=1` 时才会运行；否则命令在 stderr 上明确报错并以退出码 1 结束，同时指明两种选择加入方式。依据发布前立场，旧名称已移除且没有别名，`args.spec.ts` 钉住了对它们的拒绝。

该门槛分为两半，各有其归属。按调用的一半是每个实验性子命令上的 Commander `--experimental` 选项，在其 action 内、泄漏父级选项的拒绝之后检查。环境的一半是 `parseDshArgs` 的一个布尔参数：`bin.ts` 在进程边界读取 `process.env.DSH_EXPERIMENTAL === '1'`（在 `loadEnv` 之后，因此项目 `.env` 也可以设置它）并向下传递结果，因此解析器对环境的依赖显式体现在签名中，测试也无需改动环境变量。`1` 是唯一的启用值——该变量是显式的选择加入，而不是真值判断。

之后要稳定某个命令，只需删除它的 `--experimental` 选项和 `requireExperimental` 调用；名字不再变动。

## Testing

`args.spec.ts` 钉住两条准入路径、裸名称拒绝、旧名称拒绝，以及在环境选择加入下对泄漏选项的拒绝。`built-bin.e2e.ts` 端到端地证明组装后的入口：stderr 上的门槛诊断与退出码 1，以及 `--experimental`、`DSH_EXPERIMENTAL=1`（而非 `DSH_EXPERIMENTAL=0`）会到达 TUI 的管道 stdio 拒绝——即此门之后的下一道关卡。两个被把守的命令还在 tmux 中做了交互式验证：`dsh meta --experimental` 与 `DSH_EXPERIMENTAL=1 dsh meta` 以检出目录为 workspace 启动 TUI，`DSH_EXPERIMENTAL=1 dsh upgrade` 播种 `dsh-upgrade` skill。

## Alternatives considered

**保留 `experimental-` 名称前缀。** 按用户的指示拒绝：前缀让每次调用都付出代价，稳定时也会变成破坏性的重命名，而不是删除一个门槛。

**父级 `--experimental` 标志（`dsh --experimental meta`）。** 拒绝：默认界面刻意保持纯选项形式并启用 `enablePositionalOptions`，跨子命令边界泄漏的父级选项都被视为拼错的调用。一个只被两个子命令消费的父级标志，恰恰就是适配器在其他所有地方都拒绝的泄漏选项形态。

**在 `parseDshArgs` 内部读取 `process.env`。** 拒绝：本仓库在进程边界做验证，并保持类型化接缝的纯粹性；否则测试必须在每个用例前后修改并恢复 `process.env`。

**接受任何非空的 `DSH_EXPERIMENTAL`。** 拒绝：遥测开关作为隐私控制倾向于误关而非误开，但实验性门槛是一种确认——`DSH_EXPERIMENTAL=0` 绝不能启用它所指名的命令。

## Consequences

日常调用缩短为 `dsh meta --experimental` 和 `dsh upgrade --experimental`；在环境中设置了 `DSH_EXPERIMENTAL=1` 的开发者可以直接使用 `dsh meta`/`dsh upgrade`。`dsh --help` 将这两个命令标注为 `(experimental)`。在命令稳定之前，门槛的代价是一个额外的标志或环境变量；稳定时删除门槛即可，名字已是最终形态。
