# Agent Note: 产品 subagent 提供方位于共享 profile 宿主

Status: implemented

[English](2026-08-10-product-subagent-providers-in-shared-host.md) | 中文

## 问题

[Codex 与 Claude Code 提供方约定](../feature/2026-08-04-claude-code-and-codex-subagent-backends.md)最初以可独立安装的包交付，由部署环境在通用 subagent 工具旁加载。Agent Preset 后来成为单个 agent（智能体）的模型可见工具的常规责任方，但 preset 不能安全地拥有这些产品提供方：`ctx.subagents` 是进程级注册表，提供方名称唯一，而宿主消费方会跨会话解析同一个注册表。如果要求用户同时编辑 Profile 和 Preset，也会使通用 preset 行本身不完整。

归属决策必须同时保留两个彼此独立的事实：加载提供方不得启动产品，也不得对产品执行身份验证；而工具是否启用仍须按 preset 决定，这样两个会话才能暴露不同的产品。全局产品开关、按 agent 创建提供方实例或预先枚举的组合 preset，都会为其中一个事实另设第二责任方。

## 决策

产品提供方仍是进程级的 host plane（宿主平面）注册。[生产安装排除决策](../simplification/2026-08-12-production-dsh-excludes-product-subagent-providers.md)只取代本说明原先由 base bundle 安装提供方的选择：生产 `dsh-base` 既不依赖也不挂载它们。选择产品集成的 Profile 会安装目标提供方包，并在 host plane 挂载一次。加载任一插件只会注册一个休眠后端；对应的 Codex 或 Claude 进程直到第一次实际委派调用时才启动。Agent Preset 分别通过普通的 `dsh-tool-subagent` 行贡献 `subagent_codex` 与 `subagent_claude_code`，因此一个 preset 可以不暴露任何工具、只暴露其中一个或同时暴露两者，而无需更改提供方注册表。

本说明继续负责解释为什么已经挂载的产品提供方属于 host plane，而面向模型的工具属于 Agent Preset。生产安装排除决策负责哪些 Profile 安装这些可选包。提供方约定说明继续负责每个产品的协议、结果映射、取消、进程树生命周期与证据层级。[Agent Preset 架构](2026-08-03-per-session-agent-presets.md)仍负责宿主与 agent 的划分、preset 创作，以及改动只影响新组装会话的规则。

这些提供方使用宿主环境已经选定的产品。Codex 启动 `codex`，该命令从 `PATH` 解析；Claude Code 通过共享的子进程执行世界解析 `claude`，并把确切路径交给官方 SDK。加载 Profile 不会安装产品、创建产品状态、探测版本、测试身份验证，也不会新增产品专属设置。命令缺失和产品故障仍局限于发生问题的那次委派。

只有选择 Claude Code 提供方的 Profile 才会携带 Claude Agent SDK 的可选平台 CLI（命令行界面）载荷。生产环境仍解析宿主提供的 `claude`；这份 SDK 载荷是提供方包的安装成本，而不是生产可执行文件。

## 验证

base bundle 测试证明生产 `dsh-base` 既不包含产品提供方依赖，也不包含提供方配置行。Web 组装显式挂载两个可选提供方，并覆盖不暴露任何工具、仅暴露 Codex、仅暴露 Claude 和同时暴露两者这四种工具集合，也覆盖自行创作的 preset 发生改动后的代际隔离。由包负责的 Loader 组装证明 Codex-only 与双提供方按需启用路径会注册选中的提供方，而不会启动产品进程。无密钥 ACP（Agent Client Protocol）快照固定单个产品与两个产品同时启用时的模型可见工具 schema，提供方测试则另行证明原生可执行文件解析、失败、取消和进程树完全停稳。

## 考虑过的替代方案

**将产品提供方保留为 Profile 层的按需启用项。** 这样可缩小默认依赖闭包，但要求用户同时编辑 Profile 与 Preset。生产安装排除决策接受这项安装取舍；本说明保留的要求是，任何被选中的提供方都在 host plane 挂载一次，而不是放入 preset。

**存储全局或按 Profile 配置的产品启用开关。** 进程级开关会与 Preset 争夺模型可见工具的责任归属，也无法表示两个会话使用不同组合。可用性与身份验证属于部署事实，并非另一份需要持久化的产品状态。

**在每个 Agent Preset 内挂载一个提供方。** 提供方名称属于进程级注册表，因此第二个会话会与第一个冲突。宿主消费方也需要独立于任何单个 agent 的生命周期使用该注册表。

**交付四个产品组合 preset。** 四个身份会复制完整组装，只为表示两条独立的工具行。普通行已经能表达完整矩阵，无需新增名单或维护状态。

## 后果

用户在 Profile 中安装每个被选中的产品提供方，再通过与其他插件相同的 Agent Preset 创作路径暴露它的工具。每个新会话只会获得其所选 preset 所贡献的工具。没有选择产品提供方的 Profile 不承担对应包或模块的加载开销；加载已选择的提供方仍不会启动产品进程、登录、调用模型或创建产品主目录。

宿主注册表仍是提供方的唯一权威，每个 Preset 仍是模型工具的唯一权威。代价是两层按需启用：Profile 负责安装与 host plane 注册，Preset 负责按 agent 暴露。选择 Claude 提供方还会接受当前 SDK 可选载荷的安装成本。
