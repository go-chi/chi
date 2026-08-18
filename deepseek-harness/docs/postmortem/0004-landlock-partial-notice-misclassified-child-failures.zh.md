# 事故复盘（postmortem） 0004：Landlock 部分强制执行通知导致子进程失败被误归类

[English](0004-landlock-partial-notice-misclassified-child-failures.md) | 中文

Status: resolved

## 摘要

在 Landlock ABI 较旧的内核上，launcher 会在执行每个子进程前打印一条无害的部分强制执行通知。harness 把共享的 `landlock-run:` 前缀与任意非零子进程退出组合起来，判定为 launcher 失败，因此 ripgrep 在没有匹配项时以 1 退出等普通结果会呈现为 `SANDBOX_UNAVAILABLE`；当时仍由 bash 支撑的文件系统搜索还会用 `SEARCH_FAILED` 遮蔽这个结构化错误。过于宽泛的签名规则，以及缺少较旧 ABI 下部分强制执行的组合测试覆盖，让该缺陷得以流入。runner 分类现在会先精确排除信息性行，再要求由退出状态门控的致命证据，并由一个组装后的无密钥场景固定仍然存在的 bash 路径。文件系统搜索通过 subprocess seam 运行打包的 ripgrep，不经过沙箱化 bash。

## 概述

原生 launcher 约定区分两类 stderr 行。内核只能部分强制执行时，会精确打印 `landlock-run: partial enforcement (older Landlock ABI)`，然后继续执行子进程。launcher 失败则打印另一行 `landlock-run:` 诊断，在不执行子进程的情况下以 125 退出。

harness 用一个不区分大小写的 `landlock-run: ` 子串表示这两种情况。消费方只要发现非零退出同时携带该子串，就会归类为 runner 失败。因此，子进程的退出状态被错误地关联到 launcher 的信息性行：`false`、ripgrep 无匹配时的退出码 1、无效 pattern 的退出码 2，乃至由子进程自行选择的退出码 125，都可能在约束与执行均成功的情况下被错误归因为沙箱故障。

事故发生时，文件系统搜索又造成第二处归因错误。当时由 bash 支撑的 `runRipgrep()` 会捕获 bash 执行器除中止外抛出的所有错误，并将其替换为关于 cwd 或 shell 启动的通用 `SEARCH_FAILED`，其中也包括沙箱执行器产生的结构化 `SandboxUnavailableError`。

## 影响

在 Landlock ABI 只能部分强制执行的主机上，合法的非零子进程结果可能表现为沙箱基础设施故障。`glob` 和 `grep` 尤其容易暴露该问题，因为 ripgrep 把退出码 1 用作成功的空搜索。当文件系统搜索中确实发生沙箱故障时，调用方也会丢失其 `SANDBOX_UNAVAILABLE` 错误码，转而收到错误的启动诊断。

该缺陷没有削弱约束，也没有让命令在无约束状态下运行。其安全影响在于可用性与诊断完整性：有效的受限结果会被拒绝或错误标记。

## 时间线

- 原生 launcher 约定规定：launcher 失败使用退出码 125，每次此类失败都会打印一行致命的 `landlock-run:` 诊断；成功执行子进程时则打印精确的部分强制执行通知。
- 沙箱提供方把该约定简化为 `runnerFailureSignatures: ['landlock-run: ']`；bash 消费方将此前缀与任意非零退出组合，并报告 stderr 的第一行。
- 单元测试覆盖了无诊断的成功、拒绝诊断和致命 runner 前缀。真实 runner 测试在没有可用内核时会自行跳过，也没有强制构造「部分强制执行通知后跟非零子进程退出」的情况。
- 一个最小 POSIX 包装脚本会打印该通知并 `exec` 其负载；它通过 `false` 与 ripgrep 无匹配场景复现了故障。
- 结构化规则、前台与后台共享的分类逻辑和组装后的回放覆盖共同弥补了仍然存在的沙箱归因缺口。文件系统搜索通过 `ctx.subprocess` 运行打包的 ripgrep；本修复让该路径继续位于沙箱化 bash 之外。

## 根因

公开的沙箱结果类型只能表达一组子字符串。它无法表示 Landlock 失败必须使用退出码 125、证据必须出现在一行致命诊断内，或同一前缀下有一行精确文本属于信息性通知。消费方的布尔判定逻辑因此把来自不同进程且互不相关的事实组合在一起；即便致命证据位于后续行，它仍选用 stderr 的第一行作为详细信息。

测试矩阵与这种表示方式一致。模拟提供方要么不输出 runner 行，要么输出含义明确的致命前缀，从不在由子进程控制的非零退出前输出无害 runner 行。真实 Landlock 覆盖依赖主机 ABI，因此使用完整 ABI 的主机无法覆盖该通知。在事故发生时的搜索实现中，文件系统搜索测试模拟了原始 spawn 错误，却没有覆盖真实沙箱化 bash 组合抛出的结构化错误。

stderr 仍是带内归因通道。受限子进程可以故意复现 runner 的门控致命诊断行与退出状态，造成可用性或诊断误归因。更严格的多项证据合取可以避免本次事故中的意外冲突，但无法验证写入者身份；带外状态协议仍属于独立的加固工作，而非沙箱绕过修复。

## 已添加的防护措施

- [`RunnerFailureRule`](../subsystems/sandbox.md#wrapped-argv-and-classification-dialects) 携带可选的允许退出码、不区分大小写的逐行致命签名，以及按不区分大小写的整行精确匹配排除的信息性行。
- [`dsh-sandbox-local`](../../packages/sandbox/sandbox-local/) 把 Landlock 映射为退出码 125 加一行非通知的 `landlock-run:` 诊断，而 bwrap、Seatbelt 和自定义 runner 仍仅依据签名。
- [`dsh-bash-sandbox`](../../packages/shell/bash-sandbox/) 直接 spawn 提供方 argv，因此启动前遭拒时使用 spawn 错误通道，而非本地化的 shell 诊断。已结算的前台与后台执行共用一个返回证据的分类器；致命证据优先于拒绝，前台错误会报告匹配到的致命行，同时保持捕获的 stderr 不变。
- [`dsh-tool-fs-search`](../../packages/fs/tool-fs-search/) 通过 `ctx.subprocess` 运行打包的 ripgrep，并继续位于沙箱化 bash seam 之外。
- 原生边界回归用例位于 [`partial-landlock.spec.ts`](../../packages/shell/bash-sandbox/tests/partial-landlock.spec.ts)，包括信息性通知、致命证据和前台／后台分类。
- 组装后的产品路径由 [`partial-landlock` 快照组合](../../examples/acp-agent/partial-landlock.cordis.snapshot.yml)固定，独立于文件系统搜索的实现选择。

## 教训

- 进程归因需要多项独立证据同时成立；共享前缀不是协议。
- 信息性诊断与致命诊断可以共享同一命名空间，因此排除规则必须精确且范围狭窄，同时对未知的致命行保持失败关闭。
- 适配器必须保留下层 seam 所拥有的结构化失败，而不能用自身最接近的通用类别将其替换。
- 平台相关行为需要在原生边界放置确定性的模拟实现，并覆盖一条组装后的产品路径；会自行跳过的真实内核测试无法独自固定该回归。
