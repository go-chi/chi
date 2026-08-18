# 包

[English](README.md) | 中文

npm scope 为 `@deepseek-ai/dsh-*`；Cordis `Service` 子类和函数插件通过 `ctx.effect()`、`ctx.on()` 或 `ctx.waterfall()` 注册。规则见[包](AGENTS.md)与[根规则](../AGENTS.md#conventions)。

## 层级结构

包按组置于 `packages/<group>/<pkg>/`；包名仍为 `@deepseek-ai/dsh-<pkg>`。**组 README 负责包／ctx 键映射。**

| 组 | 职责 | 发布预期 |
|---|---|---|
| [`core/`](core/README.md) | 产品 API 主干：会话、提示词、工具、agent（智能体）服务与具体循环 | 产品：稳定 API |
| [`api/`](api/README.md) | Remote BFF 装配与 Typert RPC 网关 | 产品：稳定 API |
| [`typert/`](typert/README.md) | 类型图生成、产物加载与运行时注册表 | 产品：稳定 API |
| [`goal/`](goal/README.md) | 同会话 goal 的持久化与生命周期 | 产品：稳定 API |
| [`schedule/`](schedule/README.md) | 仅限会话内的定时后续操作 | 产品：稳定 API |
| [`feedback/`](feedback/README.md) | 人类反馈 | 产品：稳定 API |
| [`identity/`](identity/README.md) | 共享匿名身份 | 产品：稳定 API |
| [`llm/`](llm/README.md) | LLM（大语言模型）能力系列：抽象服务 + 提供方适配器 | 产品：稳定 API |
| [`e2b/`](e2b/README.md) | E2B 提供方 | POC |
| [`subprocess/`](subprocess/README.md) | 子进程能力系列：Service Definition + 本地进程树提供方 | 产品：稳定 API |
| [`shell/`](shell/README.md) | Bash 能力系列：执行器 seam、本地实现、面向模型的工具 | 产品：稳定 API |
| [`terminal/`](terminal/README.md) | 持久 PTY 能力系列：限定所有者范围的会话、本地实现和面向模型的工具 | 产品：稳定 API |
| [`code-runtime/`](code-runtime/README.md) | 代码执行能力系列：Service Definition + worker 线程提供方 + Code Mode Consumer | 产品：稳定 API |
| [`sandbox/`](sandbox/README.md) | 进程限制 seam；bwrap/Landlock/Seatbelt 后端 | 产品：稳定 API |
| [`fs/`](fs/README.md) | 文件系统能力系列：seam、本地实现、面向模型的文件工具、由 bash 支持的发现工具 | 产品：稳定 API |
| [`lsp/`](lsp/README.md) | LSP 能力系列：seam、通用 stdio 提供方和 `lsp` 工具 | 产品：稳定 API |
| [`skill/`](skill/README.md) | skill（技能）能力系列：提供方注册表、本地提供方和面向模型的目录／loader | 产品：稳定 API |
| [`compaction/`](compaction/README.md) | 压缩（compaction）能力系列：Service Definition + 基础提供方 + 命令 Consumer | 产品：稳定 API |
| [`context/`](context/README.md) | 模型可见请求上下文，包括 workspace 指令和时间上下文 | 产品：稳定 API |
| [`subagent/`](subagent/README.md) | subagent 能力系列：提供方注册表约定和面向模型的委托工具 | 产品：稳定 API |
| [`jobs/`](jobs/README.md) | 通用后台任务运行时和面向模型的 `job_*` 控制工具 | 产品：稳定 API |
| [`workflow/`](workflow/README.md) | 工作流 seam、worker 线程引擎和面向模型的 `workflow`/`ralph` 工具 | 产品：稳定 API |
| [`web/`](web/README.md) | Web 能力系列：seam、搜索／获取提供方实现和面向模型的 Web 工具 | 产品：稳定 API |
| [`attachment/`](attachment/README.md) | 持久附件标识、校验、本地内容寻址存储 | 产品：稳定 API |
| [`spill/`](spill/README.md) | spill 能力系列：存储 seam、本地实现、工具结果 spill 策略 | 产品：稳定 API |
| [`todo/`](todo/README.md) | 面向模型的 `todo_write` 工具 | 产品：稳定 API |
| [`plan/`](plan/README.md) | Plan 协作状态，提供直接进入命令与经评审的退出 | 产品：稳定 API |
| [`preset/`](preset/README.md) | 由 preset `cordis.yml` 按会话组装 agent | 产品：稳定 API |
| [`guard/`](guard/README.md) | 循环卫生守卫：建议性重复调用提醒 + `tools/execute` 截止时间强制执行器 | 产品：稳定 API |
| [`bundle/`](bundle/README.md) | 可安装的 `dsh --profile` 补丁层 | 产品：稳定 API |
| [`extensions/`](extensions/README.md) | agent 运行时自修改：实时插件／服务检查和模型所写插件挂载／卸载（[设计](../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md)） | 产品：稳定 API |
| [`hooks/`](hooks/README.md) | 钩子桥接 + 共享的 Claude Code／Codex 线协议库 | 产品：稳定 API |
| [`session/`](session/README.md) | 持久会话数据平面：持久化 seam + JSONL/SQLite 后端、投影 seam、基于日志的标题、会话上报 | 产品：稳定 API |
| [`session-query/`](session-query/README.md) | 会话检索系列：逻辑语料库、有界读取、血缘、事件关系、语义过滤和 SQLite 全文搜索 | 产品：稳定 API |
| [`settings/`](settings/README.md) | 用户设置 seam + 基于文件的提供方 | 产品：稳定 API |
| [`credentials/`](credentials/README.md) | 凭据引用 seam + 环境变量优先于 `.env` 的提供方 | 产品：稳定 API |
| [`storage/`](storage/README.md) | 非会话存储中枢 + 后端 + 领域形式 | 产品：稳定 API |
| [`workspace/`](workspace/README.md) | Workspace 实体 | 产品：稳定 API |
| [`sdk/`](sdk/README.md) | 进程外运行时 SDK：JSON-RPC 协议、TypeScript 客户端和服务器插件 | 产品：稳定 API |
| [`acp/`](acp/README.md) | 仅面向自动化的 ACP（Agent Client Protocol）服务器 | 产品：稳定 API |
| [`interaction/`](interaction/README.md) | 人机协作平面：批准／交互 seam、权限预设、命令、询问用户的工具 | 产品：稳定 API |
| [`boot/`](boot/README.md) | 共享的 app bin 启动粘合层 | 产品：稳定 API |
| [`host/`](host/README.md) | web GUI 宿主半侧：API 网关 + HTTP 路由服务器 | 产品：稳定 API |
| [`client/`](client/README.md) | web GUI 浏览器半侧：shell、协议层、对象服务、slot、`ui-*` 插件 | 产品：稳定 API |
| [`examples/`](examples/README.md) | 演示组合包（agent-spine + CLI（命令行界面）/ACP/JSON-RPC bin），由叶节点加载 | 支持：示例基础设施 |
| [`test-support/`](test-support/README.md) | 支持基础设施（testkit、不变式、回放、Loader 冒烟测试） | 支持：兼容性预期较低 |
| [`util/`](util/README.md) | 组间共享的低层零依赖工具（`Branded<B>`、Harness home／路径辅助函数、超时、留存） | 支持：小型、稳定、无 harness 依赖 |

新包加入现有组；新组更新其 README 和此表。

## 依赖

依赖图由工具生成：[docs/module-graph.md](../docs/module-graph.md)（`pnpm run gen-module-graph`，CI 中有新鲜度门禁）。

**扩展插件依赖 Service Definition，绝不依赖具体提供方。** `dsh-agent-loop` 可替换；UI、钩子和工具插件使用 `dsh-agent`。包括 `dsh-agent-spine-demo` 在内的组合包可以依赖主干插件。能力会将需要独立演进的 Service Definition／Service Provider／Consumer 角色分离；详见[能力 seam](../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)。

包 README 覆盖用途、API、扩展点和[模型体验](../docs/cookbook/adding-a-package.md#4-write-the-package-readme)；列入模型无关[省略允许清单](../scripts/verify-package-readme-model-experience.ts)的包除外。它们还要包含 `## Known Limitations and Deferred Work`，或列入其[允许清单](../scripts/verify-package-readme-limitations.ts)。
