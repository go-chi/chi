# Agent Note: 在 CI 中从构建后的 lib 运行示例

Status: implemented
Archived: 2026-07-27

[English](2026-07-17-run-ci-examples-from-built-lib.md) | 中文

## 问题

CI 通过 `node --import tsx` 和根 tsconfig 的 `paths` 映射启动示例与加载 Cordis 配置的测试项目。这种方式既增加了 TypeScript 转换开销，也改变了包解析行为：import 会解析到 workspace 源码，而不是经包的 `exports` 进入构建后的 `lib/`。

因此，这些测试没有覆盖已安装消费方实际运行的代码和解析路径。即使包的构建导出图不完整或解析结果不同，CI 仍可能通过。

## 决策

执行机制包含两种模式。`src` 是本地开发的默认模式并使用 tsx；`lib` 是严格的 CI 模式，通过 plain Node 启动构建后的 bin，不加载 tsx，也不使用 tsconfig 路径映射。

- CI 中启动示例或签入仓库的 `cordis.yml` 的子进程使用 `lib` 模式。
- 仅实现 ACP 或 MCP 对端、且不加载 Cordis 的 TypeScript fixture（测试前置数据）直接由 Node 运行。只有显式验证源码路径的回归测试可以保留 `src` 模式。

### 解析拓扑

每个测试 Cordis 配置都必须能从配置文件所在目录向上解析裸模块。

- `examples/` 作为一个 pnpm workspace 成员，提供统一的 `examples/node_modules` 解析根目录。
- 所有签入仓库的测试 Cordis 配置，包括快照配置和包内测试 fixture，都放在对应的 `examples/<agent>/` 目录树下。归属 `packages/<group>/<package>/` 的配置映射到 `examples/<agent>/tests/fixtures/<group>/<package>/cordis.yml`；测试驱动和断言仍留在包内。
- 示例 Cordis 配置中引用的每个包都同时登记在 `examples/package.json` 和根 `tsconfig.json` 的 references 中，分别支持 `lib` 与 `src` 解析。

### 启动策略

共享 Loader 测试 harness 通过 `DSH_EXAMPLE_MODE` 选择 `src` 或 `lib`。CI 先构建再选择 `lib`；未设置模式时保留快速的本地源码开发回路。

## 曾考虑的替代方案

- **CI 继续使用 tsx**：不予采纳，因为它会保留转换开销和仅适用于源码的解析行为。
- **所有环境只使用 lib**：不予采纳，因为本地开发每次运行前都必须构建。双模式避免把这项成本带入开发回路。
- **每个测试单独构造 `node_modules`**：不予采纳，因为它会重复消费方脚手架。以 `examples/` 作为 workspace 根，可让每个 Cordis 配置通过同一条真实且显式声明的路径解析模块。

## 后果

- CI 可以验证构建后的包导出，不再受 tsx 模块解析影响；本地开发仍保留免构建的源码回路。
- CI 必须先构建再运行这些测试；手动执行 `lib` 模式时可能读取陈旧的本地产物。
- 常规 TypeScript import 分析无法识别 Cordis 配置依赖，因此 `examples/package.json`、根 tsconfig references 与配置文件必须保持同步。
