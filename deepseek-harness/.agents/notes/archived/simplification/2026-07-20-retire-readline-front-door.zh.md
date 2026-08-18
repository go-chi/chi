# Agent Note: 退役 readline 前端与 repl-agent 示例

Status: implemented
Archived: 2026-07-26

[English](2026-07-20-retire-readline-front-door.md) | 中文

## 问题

仓库同时提供两个交互式终端前端：面向行的 readline 通道（`@deepseek-ai/dsh-stdio`）和全屏的 [`@deepseek-ai/dsh-tui`](../feature/2026-07-17-dedicated-full-screen-tui-front-door.md)。TUI 落地之后，readline 的交互角色已经冗余——`demo:tui` 作为编码 agent 体验取代了 `demo:repl`——而它剩下的真实角色（管道与自动化）已由单次任务的 `@deepseek-ai/dsh-cli-demo` 应用以更好的方式承担（任务输入、DSH 原生 `text`/`json`/`stream-json` 输出、持久化、信号处理）。

这种重复是结构性的，不只是表面问题：`dsh-stdio-demo` 携带一个 `TerminalMode`（`auto`/`readline`/`tui`）选择接缝、约 1,000 行 readline 单元测试、一套被 CI 演示冒烟测试和两个 built-bin e2e 用 grep 匹配的 readline 文本记录语法（`[tool call] …` 行），以及一个倒置的示例组合：旗舰 `tui-agent` 叶节点被定义为对它所取代的 `repl-agent` 叶节点的 include patch。

## 决定

删除 readline 前端和 repl-agent 示例；只保留三类前端原型：**交互式 TUI**（仅 TTY，管道下快速失败）、**单次任务 CLI**（`-p`/位置参数任务，服务管道与自动化）以及**服务器**（ACP / JSON-RPC）。

- `packages/ui/stdio` 与 `examples/repl-agent` 已删除。`packages/examples/stdio-demo` 更名为 `@deepseek-ai/dsh-tui-demo`（`packages/examples/tui-demo`）并始终挂载 `dsh-tui`；`TerminalMode`/`resolveTerminalMode`/`ui.mode` 接缝随之删除。bin 在**启动 loader 之前**就拒绝非 TTY 流（Loader 树内组合期抛出的异常按条目记录日志而不会重新抛出，管道启动否则会沉降为一个空闲的无 UI 进程而不是以非零码退出）。
- `examples/tui-agent/cordis.yml` 现在内联拥有编码组合（include patch 倒置消失）；其 Code Mode 覆盖层 include 自己的基础配置。`examples/cordis-agent` 迁移到 TUI 应用。
- `examples/echo-agent` 迁移到单次任务的 `dsh-cli-demo` 应用；`dsh-cli-demo` 新增 `-p/--prompt` 作为单个任务的旗标形式（与位置参数互斥）。
- 与 UI 无关的带密钥编码 e2e（`full-loop`、`coding-task`、`resume`、`compaction`、`todo-write`、`code-mode` 及其共享 harness）原样从 `examples/repl-agent/tests/` 移入 `examples/tui-agent/tests/`——它们以编程方式组装整个栈，从不接触任何 UI。
- SDK 向导的 `stdio` 运行接口改为 `tui`（`RunInterface = 'acp' | 'tui' | 'embed'`），贡献 `dsh-tui` 配置项而不是 `dsh-stdio`；生成的 `index.ts` 在 `startSDK` 之前检查 TTY，理由与 tui-demo bin 的启动前快速失败相同。

### 测试策略：PTY 仅用于 TUI

管道仍是默认测试介质。PTY 驱动的子进程测试**仅**在被测对象就是 TUI 本身时获准使用：`examples/tui-agent/tests/tui-keyless-smoke.e2e.ts`（新增 Code Mode 覆盖层启动场景，取代 repl-agent 的管道冒烟测试成为该覆盖层的无密钥组合证明）和 `examples/cordis-agent` 中最小的 PTY 启动冒烟测试（其前端就是 TUI）。其余全部改为通过单次任务 bin 走管道：

- `examples/echo-agent/tests/echo.e2e.ts` 通过 `stream-json` 记录证明 Loader 启动 + mock 模型的工具往返，而不是匹配 readline 文本记录行。
- CI 演示冒烟门禁（`scripts/run-gates.ts`、AGENTS.md）运行 `demo:echo --output-format stream-json -p "echo ci smoke"` 并结构化解析记录。
- TUI 对管道启动的拒绝（非零退出 + 指向单次任务 CLI 的提示）由 `apps/cli/tests/built-bin.e2e.ts`（纯 Node 下的 `dsh` TTY 守卫）覆盖；纯 Node 下的 echo 往返证明与缺失配置的快速失败证明位于 `cli-demo` 的 built-bin 套件。
- `packages/context/time-context/tests/time-context.e2e.ts` 运行一个单次任务轮次；多轮 elapsed 渲染仍由其单元测试覆盖。

## 接受的损失

- **单进程内的管道多轮对话**——readline 通道可以通过 stdin 脚本化多个轮次；单次任务 bin 每个进程只运行一个任务。多轮连续性由 `RESUME_SESSION_ID`/resume e2e 和 TUI 的脚本化 PTY 对话覆盖。
- **非 TTY 的 `ask_user_question`**——readline 提供方是 `ctx.userInteraction` 唯一的非 TTY 终端实现。模型调用 `ask_user_question` 的 headless 或 ACP 自动化运行会让该工具调用失败，除非其组合提供相应的 provider；Web 拥有已交付的非终端 provider。

## 曾考虑的替代方案

- **保留 `dsh-stdio` 作为纯管道/自动化通道而只删 repl 演示**——不予采纳：它的自动化角色以更弱的契约重复了 `dsh-cli-demo`（非结构化文本记录、EOF 退出的启发式判断，对比后者的一次持久轮次结束和格式纯净输出）。
- **把管道冒烟测试改写为 PTY 驱动**——不予采纳：PTY 是更易波动、更复杂的介质，仅保留给管道无法证明的那一个表面（真实 TTY 的接管/恢复）。

## 后果

- 一个交互式前端（TUI）、一个自动化前端（单次任务 CLI）、两个服务器；终端应用不再有模式选择接缝。
- 约 1,000 行 readline 单元测试随其行为一起删除；readline 文本记录语法从所有门禁中消失。
- 本决定取代 [fold the stdio UI helper](2026-07-04-fold-stdio-ui-helper.md) 的打包部分（被折叠的包现已删除），并修订 [TUI 前端 Agent Note](../feature/2026-07-17-dedicated-full-screen-tui-front-door.md) 描述的组合（不再有 `auto` 选择；`tui-agent` 拥有编码组合）。
