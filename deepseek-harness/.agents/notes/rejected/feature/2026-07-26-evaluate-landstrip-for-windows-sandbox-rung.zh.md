# Agent Note: 在构建 Windows 沙箱启动器之前先评估 landstrip

Status: rejected — landstrip 未经实战检验（驳回时问世仅数天，只有一名维护者，GitHub 星标约 48 个）；关系到安全不变量的依赖必须经过广泛采用的验证，因此 win32 层级维持自研启动器的原计划

[English](2026-07-26-evaluate-landstrip-for-windows-sandbox-rung.md) | 中文

## 问题

[沙箱决策](../../implemented/feature/2026-07-06-sandbox.md)将 `PLATFORM_CHAINS.win32` 留空，并计划用「AppContainer/受限令牌（restricted-token）家族的一个约束运行器，按 `node-addon-landlock-run` 模板从其独立仓库发布」来填充——一个估计约 1,500 行、需要自研编写并维护的新仓库（landlock-run 子树约为 1,460 行 C／TS／脚本／测试，外加文档与 CI）。

自那份决策记录写成以来，出现了一个持续维护的第三方运行器：`@landstrip/landstrip`（npm 包，活跃开发中，Rust 内核，附带按平台预构建的 `optionalDependencies`）覆盖 Linux 上的 Landlock + seccomp、macOS 上的 Seatbelt，以及 Windows 上的 AppContainer/受限用户，支持 JSON／YAML 策略输入和基于 trap-fd 的拒绝上报通道。它与 bwrap 一样采用 exec 包装方式，因此无需触碰 Linux/macOS 层级即可契合链的 `confine(argv)` 形态。

## 提案

当 Windows 沙箱阶段启动时，在动手编写自研 AppContainer 启动器仓库之前，先评估将 landstrip 的 Windows 后端包装为 `win32` 链运行器。评估必须回答：

- **探测合成。** landstrip 没有 `--probe`；链所要求的功能探测约定必须从一次 trap 运行中合成出来。
- **方言映射。** 拒绝与运行器失败两类 stderr 方言，以及失败关闭的退出码分类，都需要显式映射到链的词汇中。
- **许可证。** 其二进制文件采用 LGPL-2.1-or-later 许可；在进入随产品发布的依赖闭包之前需要先做分发审查。
- **源码与构建记录。** 每个自研启动器二进制都逐字节锁定到一个约 300 行、可完整评审的 C 文件的原生 CI 构建；而 landstrip 是单一维护者手中的一组 Rust 二进制文件。对*既有的 Linux 层级*而言，这笔权衡早有定论——不要替换它（见[沙箱 Agent Note](../../implemented/feature/2026-07-06-sandbox.md)以及该启动器自身移除 Rust 依赖的迁移记录）。而对一个我们尚未构建的层级，在第三方维护与第二个自研原生仓库之间如何取舍，是一个真正悬而未决的问题。

## 曾考虑的替代方案

- **按原计划构建自研 AppContainer 启动器。** 若评估在许可证、源码／构建可审计性或探测契合度上不通过，这仍是默认选项；代价是要长期维护第二个原生安全启动器仓库。
- **把 Linux Landlock 层级也换成 landstrip。** 直接否决：沙箱正确性是安全不变量，当前启动器有可审阅的 C 源码，其二进制逐字节锁定到原生 CI 构建，而且它正是出于这一原因才迁移摆脱了 Rust 依赖。

## 验收标准

- 在任何 Windows 层级实现开始之前，先有一份评估记录下探测、方言、许可证、源代码仓库、发布流程和二进制构建问题的答案，并把「采用／不采用」（go/no-go）结论加入沙箱 Agent Note 的延后阶段计划。

## 风险

- 处于安全关键位置的单一维护者供应链——这正是本提案定为一道评估门禁、而非采用决定的原因。
- 该包尚且年轻；在 Windows 阶段启动之前其 API 与打包方式可能反复变动，届时需对照在线注册表重新核验。
