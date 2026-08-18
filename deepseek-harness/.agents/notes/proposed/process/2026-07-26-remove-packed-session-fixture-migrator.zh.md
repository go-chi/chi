# Agent Note: 移除打包会话 fixture 分支迁移器

Status: proposed

[English](2026-07-26-remove-packed-session-fixture-migrator.md) | 中文

## 问题

仓库的默认写入器和快照检查会使会话 fixture（测试前置数据）保持规范打包行布局。在永久强制机制之外仍保留 `pnpm run migrate:packed-session-fixtures`，唯一原因是让携带旧版 fixture 改动的在途分支可以合并当前 `master`，并在不重新录制模型输出的情况下通过机械转换收敛。

一旦每个此类分支均已合并、关闭或符合规范，写入命令及其分支收敛指引便不再有持续维护者。过渡结束后继续保留会修改仓库内容的命令，会在永久只读快照检查旁增加第二条看似有效的维护路径。

## 提案

在实时清单确认不再有任何开放 PR（Pull Request）需要转换会话格式 JSONL 后，移除临时 CLI `scripts/migrate-packed-session-fixtures.ts`，以及根包提供的 `migrate:packed-session-fixtures` 命令。在同一变更中，移除测试政策、ACP 快照 README 和已实现打包行 Agent Note 中指向该过渡命令的链接，并将 `scripts/session-fixture-layout.snapshot.ts` 中仅适用于该命令的修复指引替换为与具体命令无关的规范布局指引。

保留 `scripts/session-fixture-layout.ts`、其单元测试和 `scripts/session-fixture-layout.snapshot.ts`。它们定义并强制执行永久规范布局；只有面向分支的写入器是临时机制。

移除命令前，每个受影响分支都要合并当前 `master`，运行一次迁移器，将由此产生且仅包含 fixture 重写的改动单独提交，并验证仓库级快照布局检查通过。已关闭或被取代的分支无需迁移。

## 曾考虑的替代方案

**无限期保留该命令。** 这会让旧 fixture 转换更方便，但也会在唯一已知迁移窗口关闭后，留下一个仓库级写入工具。只读门禁已经提供可长期保留的行为与诊断。

**随 CLI 一同移除规范布局转换模块。** 该模块不是过渡残留：快照 CI 使用它发现未来 fixture、解码混合物理记录，并与规范打包表示进行比较。移除该模块也会移除强制机制。

**打包行进入 `master` 后立即删除命令。** 较旧的开放分支在调整目标分支后，只能使用临时脚本或手动重新生成快照，这会增加冲突风险，也会让解码事件保真度更难评审。

## 验收标准

- 实时开放 PR 清单未发现任何仍依赖临时迁移命令处理会话格式 JSONL 改动的分支。
- 临时 CLI、根包命令、所有分支收敛链接与仅适用于该命令的门禁诊断均不存在；永久规范布局转换器、单元测试和快照检查仍然保留。
- `pnpm run test:snapshot`、`pnpm run doc-sync`、lint 和空白校验在没有临时命令的情况下通过。
- 当前文档仅描述打包默认值和永久规范布局强制机制。

## 风险

若开放分支清单不完整，命令消失后，贡献者可能会陷入大规模的非打包 fixture 冲突。因此，移除操作取决于实时 PR 证据，而不是经过的时间。保留命令过久的运维成本较低，但会模糊哪一种机制才是永久机制。
