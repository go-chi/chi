# Agent Note: doc-sync 走门禁调度器

Status: implemented
Archived: 2026-07-26

[English](2026-07-21-doc-sync-through-gate-scheduler.md) | 中文

## 问题

`pnpm run doc-sync` 原本是把 24 个 `pnpm run` 子命令用 `&&` 串起来的链。每一环都要先付一次完整的 pnpm 包装层启动（workspace 解析、脚本查找、tsx 启动）才轮到脚本本体；在开发机上实测，24 个脚本本体合计约 34 秒即可跑完，而链式形态耗时约 3 分钟，且包装层的停顿在本地磁盘上同样复现，因此每位开发者和每条 CI 车道都在付这笔开销，并非只有网络文件系统上的检出受影响。这条链还是串行执行的，尽管各成员门禁只读且相互独立；它也在悄悄偏离 [scripts/run-gates.ts](../../../../scripts/run-gates.ts)：运行时 API 目录落地时 `verify-cordis-api` 加入了链，却从未加进 `docSyncLeafGates`，导致 CI 从未把关该目录的新鲜度。

## 决策

`package.json` 中的 `doc-sync` 委托给既有的有界调度器——`tsx scripts/run-gates.ts doc-sync`——与各 `check:ci:*` 脚本的做法一致（[并行门禁调度](2026-07-06-parallel-pre-push-gates.md)、[当前 CI 拓扑](2026-07-22-evidence-based-larger-hosted-runners.md)）。`doc-sync` 模式恰好展开为 `docSyncLeafGates()`，使 `run-gates.ts` 里的叶子列表成为成员集合的唯一真源。本地模式把默认并发上限设为四个 worker，因为多个文档门禁各自要构建完整的 `ts.Program`；`DSH_GATE_CONCURRENCY` 仍可覆盖。

`docSyncLeafGates` 包含 `verify-cordis-api`，因此相关的本地文档检查与 CI 会同其他生成文档一起把关生成的运行时 API 目录。

## 考虑过的替代方案

- **保留 `&&` 链，只补缺失的叶子**——能修好今天的漂移，但保留了两份还会再漂移的成员列表，也保留了 24 次串行的 pnpm 包装层启动。
- **专门的 `scripts/doc-sync.ts` 在单进程内 import 各校验模块**——连每个门禁的 tsx 启动也能省掉，但需要把全部 24 个脚本从 import 即执行改造成可调用入口，还会失去调度器的按门禁计时、隔离和失败分组；而调度器已经避免的包装层启动才是开销的大头。
- **用 shell 循环跑 `tsx scripts/*.ts`**——以低成本避开 pnpm 包装层启动，却在 CI 已经使用的调度器旁边增加了第二套执行词汇，且没有它的任何调度与报告能力。

## 结果

一次 `pnpm run doc-sync` 的成本从 24 次包装层启动加全部成员之和，变为一次包装层启动加成员门禁中最慢的依赖链。新增文档门禁只需在 `docSyncLeafGates` 改一处（外加 package script 本身以便手工单独运行）；`package.json` 保留各 `verify-*` 脚本作为手工运行单个门禁的词汇。调度器输出按门禁计时，doc-sync 变慢时能直接指向占大头的门禁。`pnpm run doc-sync` 的输出从逐命令顺序输出变为调度器的交错输出；解析该输出的工具必须以 `run-gates:` 摘要行为准。
