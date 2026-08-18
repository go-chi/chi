# Agent Note: 并行 pre-push 门禁

Status: implemented

[English](2026-07-06-parallel-pre-push-gates.md) | 中文

本记录中的本地钩子部分已由[快速本地 Git 钩子](2026-07-22-fast-local-git-hooks.md) 取代。有界门禁调度器和包级 `publint` 并行机制仍用于 CI、`doc-sync` 和显式本地命令。

## 问题

文档同步等聚合任务隐藏了很长的串行链，其中各项检查只读且相互独立。在工作流 YAML 中重复这些叶子清单，会使未来脚本变更有多个位置可以发生漂移；而串行运行包发布检查，会使一道门禁的耗时与包数量成正比。

## 决策

[scripts/run-gates.ts](../../../../scripts/run-gates.ts) 拥有 CI、`doc-sync` 和按需启用的 `check:all` 命令所使用的有界调度器。它将具名模式展开为叶子门禁，在启动子进程前拒绝空的或有歧义的依赖图，遵守产物依赖，缓冲可归因的输出，分别报告进程退出与信号终止结果，并在调用方需要不同 worker 上限时接受 `DSH_GATE_CONCURRENCY`。

Node 24 消费方任务采用单个包含七道门禁的模式，而非由 shell 管理的进程池。其默认 worker 数等于门禁数，但门禁是否就绪由依赖关系控制：`publint` 先于已构建包不变式验证运行，快照回放、NodeNext 类型检查、built-bin 冒烟测试和 lint 则等待该验证完成。lint 之所以等待，是因为不变式验证器会临时暂存包视图，而 linter 不得遍历这些视图；源码兼容性检查可以与这条验证链重叠运行。

[scripts/publint-all.ts](../../../../scripts/publint-all.ts) 从 `packages/<group>/<pkg>` 发现包，并以根据 `availableParallelism()` 确定大小的 worker 池运行 `publint`。`DSH_PUBLINT_CONCURRENCY` 可以针对资源配置不同的本地机器和 CI runner 限制或提高 worker 数量。结果按包缓冲，并按确定性的包顺序打印，因此并行执行不会打乱各包的日志块。

各门禁的包脚本仍是临时本地运行所用的命令入口。`hygiene` 继续作为聚合 `&&` 链，而 `doc-sync` 的成员列表由调度器管理（[通过门禁调度器运行 doc-sync](../../archived/process/2026-07-21-doc-sync-through-gate-scheduler.md)）。

## 验证

[scripts/run-gates.spec.ts](../../../../scripts/run-gates.spec.ts) 在执行器运行前拒绝无效图，锁定消费方清单和依赖边，并通过真实子进程验证信号终止。[scripts/publint-all.spec.ts](../../../../scripts/publint-all.spec.ts) 在下游产物消费方运行前拒绝缺失的公开导出。

## 曾考虑的替代方案

- **保持聚合 job 串行**：执行更简单，但墙钟时间等于各独立检查之和，并重复启动命令包装器。
- **每个叶子门禁声明一个 CI job**：暴露最大工作流并行度，但会重复 checkout、设置和安装开销，并在 YAML 中复制调度器清单。
- **在 shell 脚本内后台运行子命令**：可以并行处理，但会失去各门禁计时、确定性的失败分组和直接的信号处理。
- **每个包声明一个 `publint` job**：暴露最大包级并行度，但会创建手工维护的包清单，包发生变化时就会漂移。
- **以无界并发运行 `publint`**：虽能最大限度缩短小型仓库的耗时，却会拿进程数量、内存压力、包 tarball 创建开销和日志可读性冒险。

## 后果

由调度器支持的命令耗时取决于最慢的依赖链，而非各独立门禁耗时之和，并会报告决定总耗时的门禁。无效图会直接失败，不会先执行其中一部分。代价是维护一个具有显式模式清单的定制调度器。

这条验证链会让使用已恢复产物的下游消费方和 lint 延后启动，直至共享产物视图经确认有效且临时暂存已清除；这些下游门禁仍可彼此重叠运行。

`publint-all.ts` 采用异步执行并缓冲命令输出，而不是实时继承 stdio。换来的是具有稳定输出顺序的包级并行，以及用于资源调节的单一环境变量。
