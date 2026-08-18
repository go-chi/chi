# Agent Note: 生产 dsh 排除产品 subagent 提供方

Status: implemented

[English](2026-08-12-production-dsh-excludes-product-subagent-providers.md) | 中文

## 问题

`@deepseek-ai/dsh` 会获得 `@deepseek-ai/dsh-base` 的依赖闭包。如果 base 包含 Codex 与 Claude Code subagent 提供方，每次生产安装都会下载可选的产品集成代码，包括 Claude Agent SDK，即使用户并未使用任一集成。

## 决策

本决策取代[共享 host 放置决策](../architecture/2026-08-10-product-subagent-providers-in-shared-host.md)：`@deepseek-ai/dsh-base` 不依赖也不挂载 Codex 与 Claude Code subagent 提供方。需要这些集成的 Profile 仍可显式安装并挂载对应包。仓库 examples 保留直接开发依赖，使其显式提供方配置可以继续解析。

## 验证

base 组合包测试会拒绝这两个提供方依赖与配置行。Cordis 配置验证要求显式 examples 声明其引用的提供方包。

## 考虑过的替代方案

**在 base 组合包中保留休眠提供方。** 休眠提供方不会启动产品进程，但其包仍会进入每次生产 NPM 安装。

## 后果

安装 `@deepseek-ai/dsh` 时，不会通过 base 组合包下载任一产品提供方。使用任一集成都需要显式 Profile 配置。
