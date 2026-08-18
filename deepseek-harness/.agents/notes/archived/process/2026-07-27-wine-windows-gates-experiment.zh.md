# Agent Note: 在 Linux runner 上用 Wine 运行 Windows 阻断门禁

Status: implemented
Archived: 2026-08-08

[English](2026-07-27-wine-windows-gates-experiment.md) | 中文

## 问题

Pull request 的 Windows 通道旨在验证两个阻断性 win32 表面，即 workspace 构建与生产站点。该通道此前运行在托管 `windows-2025` 上，是必需矩阵中最慢的作业：耗时 7–9 分钟，而 Linux 作业耗时 1.5–2.5 分钟，因此 Windows VM 的启动、准备与文件系统开销主导了每个 pull request 的关键路径。

实验回答的问题是：一台普通 Linux runner 能否以 Linux 作业的墙钟时间为这些阻断表面产出等效的 win32 信号，让 pull request 路径上完全没有 Windows VM？

## 决策

[ci.yml](../../../../.github/workflows/ci.yml) 中必需的 pull request `windows` 作业（`windows node 24 / wine blocking`）在 `ubuntu-latest` 上通过 Wine 用真实 Windows 二进制运行阻断门禁命令：校验和验证过的 win-x64 Node.js 执行 `tsc -b`、`tsdown` 与 VitePress 生产构建，因此工具链的 win32 分支——反斜杠路径处理、`CreateProcess` 派生语义、`@esbuild/win32-x64` 的 PE 加载、以及 rolldown/rollup 的 MSVC `.node` 插件——都真正执行。master 的 `serial-windows` 作业原封不动：完整的原生内核清单，包括本通道不运行的观察性可移植性门禁，仍在每次 master push 时于真实 `windows-2025` 上执行。

依赖在 Linux 上原生安装，`supportedArchitectures` 扩展到 win32-x64，使 Windows 平台包物化进同一个 store；通过直接调用各工具的 JavaScript 入口绕开 cmd-shim 层，这正是 `run-gates` 最终派生的那些进程。`nodeLinker: hoisted` 是承重的，不是风格问题：一个独立原型保留了 pnpm 默认的 isolated 布局——包括在 Linux 预取的 store 上忠实地用 Windows pnpm 离线重装——而 Wine 下的 Windows Node 依然无法穿过 isolated 符号链接链解析 `@esbuild/win32-x64` 或加载 koffi 预编译产物，在任何仓库门禁运行前就失败了。扁平的真实文件布局才让门禁变得可达；本通道采纳了该原型的校验和固定，同时明确放弃其「Windows pnpm 安装依赖树」的目标（安装契约在此仍由 Linux 侧验证）。

该通道靠四个杠杆把墙钟时间保持在与 Linux CI 作业相当的水平：master 刷新的 pnpm store 缓存（只恢复，与 Linux 作业同键）、Wine 供给（apt 安装、Windows Node 下载、`wineboot`）与 `pnpm install` 并发运行、两个阻断表面并发运行——与 `run-gates` 在原生 Windows 上给它们的形状相同——以及按 runner 镜像为键的 apt 归档缓存，由 master 的 `wine apt cache` 作业播种，使每个 pull request 都能从默认分支作用域恢复。

门禁逻辑集中在一个脚本里，[scripts/wine-windows-gates.sh](../../../../scripts/wine-windows-gates.sh)：ci.yml 作业只供给 runner 状态（缓存、apt Wine）然后调用它，可选的本地门禁 `pnpm run check:windows-wine` 在装有 Wine 的开发机上运行同一个脚本——单一实现，因此本地复现红色 CI 通道不需要在环境之间做任何转译。该本地门禁是诊断工具而非例行检查：仅在排查已知的 Windows 相关失败时运行；日常 win32 信号归 CI 所有，[dsh-pre-push-checks](../../../skills/dsh-pre-push-checks/SKILL.md) 也从不选择它。脚本从不改动工作树：把已跟踪文件和未跟踪但未忽略的文件快照进一个临时目录，只对快照施加 Wine 特有的 pnpm 覆盖，并在那里对着共享 store 安装；Wine prefix 与校验和验证过的 Windows Node zip 持久存放在 `.cache/wine-windows/` 下，本地重跑跳过供给，nodejs.org 不可达时回退到最新的已缓存 zip。

五条环境约束塑造了 CI 与本地执行，每条都以一次红色运行被发现：Ubuntu 的 `wine64` 包本身不往 PATH 放任何东西（要装 `wine` 调度器）；Wine 下的 Node 无法把 stdio 接到调用方的管道上（引导期 `Socket open EBADF`——所有调用都经文件中转 stdio）；Wine 不对 pnpm isolated 布局的 Unix 符号链接做 realpath（即上文的 hoisted 布局）；macOS Wine 也会把 hoisted workspace 链接暴露为普通目录，因此 client 测试聚合会纳入每个包自己的 CSS 模块声明，而不依赖 project-reference realpath；Wine 无法创建 Windows 符号链接（VitePress 的 `linkVue` 报 `ENOTSUP`——`vue` 链接在门禁前由宿主侧铺好）。

## 实测结果

2026-07-27 实测，热缓存，pull request 触发，标准 2 核 `ubuntu-latest`：端到端 2 分 46 秒——准备与缓存恢复约 17 秒，并发安装+供给 33 秒，并发门禁 110 秒——对照 Linux CI 作业的 1.5–2.5 分钟与被替换的 `windows-2025` 作业的 7–9 分钟。冷缓存约多付一分钟。实验期间定义过 8 核基准测试作业，但它从未离开受限 `dsh-ubuntu-*` 池的队列；标准 runner 的数字已达标，故不使用更大的机器。

## 考虑过的替代方案

**保留托管 `windows-2025` 的 pull request 作业（现状）。** 其信号没有问题，问题只在延迟：为两条构建命令花 7–9 分钟，是必需矩阵中最慢的作业。它作为 master 串行参照存续——在那里完整性比延迟更重要。

**在 Linux runner 内用 QEMU/KVM 跑完整 Windows 客户机。** 真实 NT 内核，保真度完整，包括大小写不敏感的 NTFS 与 ConPTY——但首个门禁运行前要花数十分钟下载镜像并做无人值守安装（兄弟实验分支 `exp/kvm-windows-ci` 实测端到端 40 分 19 秒）。只有配上会挤压 Actions 缓存预算的磁盘镜像缓存才可投入使用。

**在 Wine 下由 Windows pnpm 执行安装。** 同一想法的更高保真度变体：把 MinGit 与 pnpm 放进 prefix，用 Linux 预取填充 store，再由 Windows Node 运行 `pnpm install --offline`，让安装契约本身以 win32 身份执行。它到达了安装但没到达门禁——Wine 的网络无法直接访问 registry，且 isolated 的 `node_modules` 布局即便在干净的离线安装后也挫败了 Windows 平台包的解析。本通道牺牲这份保真度（hoisted 布局、Linux 侧安装）来换取门禁可达；两份记录是同一裁决互补的两半。

**Linux 上的文件系统语义通道（casefold ext4、文件名 lint）。** 以近零成本捕获最高频的 Windows 故障类别，但对 win32 二进制什么也证明不了。作为兄弟实验分支 `exp/casefold-windows-ci` 探索；与本通道互补而非竞争。

**Windows 容器。** 不可行：Windows 容器要求 Windows 宿主内核；托管 Linux runner 无法运行。

**砍掉 Windows 通道。** 已否决——win32 是一等产品目标：基于 koffi 的 DACL 与持久命名空间模块、基于 ConPTY 的 PTY 会话、以及 Windows 路径策略都随 `packages/` 交付。

## 后果

每个 pull request 的 Windows 裁决现在都能在 Linux 作业的耗时范围内、利用免费的标准 runner 容量得出，pull request 关键路径上不再有任何 Windows VM 分配；`all checks passed` 消费的仍是原来的 `windows` 作业 id。

这笔交易的代价：Wine 在大小写敏感的 ext4 之上重实现 Win32——NTFS 大小写不敏感、真实 DACL、ConPTY 与崩溃持久性语义在此都未被证明，且观察性可移植性清单（duplication、publint、node-next 类型、win32 上已构建包的不变量）完全不再于 pull request 上运行。这一切均由 master 的 `serial-windows` 参照负责验证：Wine 绿灯的 pull request 仍可能在原生内核的 master 运行上失败，项目接受这种失败可能在合并后才出现。该通道还将 Wine 特有的差异固化为永久的作业结构——文件中转的 stdio、宿主侧的 `vue` 链接、hoisted 布局——因此未来依赖 isolated 布局语义或进程内符号链接创建的工具链变更会先在这里以 Wine 失败而非产品失败的形式浮现，分诊必须如此归类。若 Wine 红灯在无产品原因的情况下反复出现，记录在案的退路是把 `windows` 作业还原为 git 历史中保存的 Wine 之前的 `windows-2025` 定义。
