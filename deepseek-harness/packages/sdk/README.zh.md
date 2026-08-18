# sdk/：从另一进程驱动 Harness 运行时

[English](README.md) | 中文

本组包含用于从另一进程驱动 Harness 运行时的协议栈。调用方提供运行时可执行文件及其 `cordis.yml`；本组不创建、配置、构建或启动开发者项目。[TypeScript SDK 决策](../../.agents/notes/implemented/feature/2026-07-27-typescript-sdk-and-sdk-subagent-backend.md)负责客户端约定，[工具链移除](../../.agents/notes/implemented/simplification/2026-08-11-remove-sdk-project-toolchain.md)负责产品边界。

| 包 | 职责 |
|---|---|
| [`protocol/`](protocol/README.md) | 定义 SDK 运行时通信协议 |
| [`client/`](client/README.md) | 通过 TypeScript 客户端 API 驱动 Harness 运行时 |
| [`server/`](server/README.md) | 通过 stdio JSON-RPC 为进程外 SDK 客户端提供服务 |
