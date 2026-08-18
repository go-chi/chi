# Agent Note：Python 极简组合的模型可见快照

Status: implemented

[English](2026-08-13-python-minimal-model-visible-snapshot.md) | 中文

## 问题

Python 通道从未比对极简组合实际展示给模型的内容。动态运行时上下文以 user 消息进入历史，因此 mock 模型"system 角色消息等于部署 persona"的断言看不见它；而进阶可执行文件快照会把每个请求头中已组装的系统提示词换成占位符、把每个工具 schema 换成其名称。于是 sandbox-policy 的运行时上下文消息一直搭车留在签入的[极简组合](../../../../examples/jsonrpc-agent/minimal.cordis.yml)里，而 `python-runtime` 始终是绿的；任何新增系统分段、工具或其他上下文消息的插件都能照此蒙混过关。

## 决策

[打包运行时冒烟测试](../../../../scripts/smoke-python-runtime.py)的 `sdk-minimal` 场景会录制 `scripts/snapshots/python-sdk-single-exe/minimal/model-visible.json`：对该回合的每个模型请求，逐字记录对外公布的工具 schema 与消息列表。system 与 user 消息保留全文，仅将场景的临时目录替换为占位符；assistant 与 tool 消息只保留调用标识，因为它们的 PTY 与文件系统文本在期望输出需要重放的各平台上并不相同。

有一条模型可见消息被排除在外：agent loop 的动态运行时上下文快照。同一组合在 macOS 上会发出它，在必需车道所用的 Linux 上不会，因此任何单一期望输出都无法承载它。该差异本身就是缺陷（[#2488](https://github.com/deepseek-harness/deepseek-harness/issues/2488)）——这份期望输出覆盖其余全部模型可见消息，而不是等它先被修复。

mock 模型不再断言极简场景的工具与系统提示词——该面由快照拥有，并给出完整差异而非首个不匹配项。快照比对以目录与文件集合为参数，因此 `minimal` 与 `advanced` 两份期望输出共用一套实现，且 `--update-snapshots` 接受 `sdk-minimal`。

## 曾考虑的替代方案

**像进阶场景那样对极简会话日志做快照。** 极简回合驱动真实 PTY 与编辑器，持久化的工具结果带有平台相关文本。期望输出会因与模型可见组装无关的原因变红；而把这些文本归一化掉之后，日志所承载的内容也就所剩无几。

**扩展 mock 模型中的内联断言。** 每新增一项模型可见贡献都要再手写一条期望，且失败只会指出一处不匹配而非整个面。工具描述还会从组合复制进脚本，形成重复。

**依赖 TypeScript SDK 快照。** 其 `persistent-tools` 场景固定了同一组合的系统提示词、工具 schema 与运行时上下文，但走的是重放的模型响应与 source 或 `lib` 运行时，且位于另一个必需任务中。它无法体现已部署可执行文件的闭包为 Python 调用方组装出什么。

## 后果

极简组合模型可见面的改动——系统分段、工具、工具描述或新增的 user 消息——现在会让 `python-runtime` 带着精确差异失败；要让它落地，就必须重新运行 `--scenario sdk-minimal --update-snapshots` 并审阅该差异。极简组合的工具描述由此成为经过审阅的期望输出。

assistant 与 tool 消息文本不再参与比对，运行时上下文快照则完全不参与比对。持久 shell 状态、编辑器输出与最终响应仍由该场景自身的断言拥有；被排除的那条消息由 [#2488](https://github.com/deepseek-harness/deepseek-harness/issues/2488) 负责，直到其平台差异得到解决。

[AGENTS.md](../../../../AGENTS.md) 与[测试政策](../../../../docs/testing.md)现已点明两个 SDK 都是 agent loop、会话生命周期与 `SessionEventMap` 的独立投影，因此改动其中任何一项都要连带更新两侧的期望输出，而不只是贡献者恰好会运行的那一侧。
