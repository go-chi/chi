# Agent Note: dsh 原生 TypeScript 源码启动

Status: implemented
Archived: 2026-08-07

[English](2026-07-28-dsh-native-typescript-source-launch.md) | 中文

> Node 原生启动方案已被 [dsh 通过 tsx ESM hook 源码启动](2026-07-29-dsh-source-launch-tsx-esm.md) 取代：Node 26.0.0 移除了 `--experimental-transform-types`，本文描述的 paths loader 已删除。Cordis 配置声明门禁（`verify-cordis-config`）、app-boot 的显式失败插件诊断以及 vendor 中的 `import type` 标注仍然有效。

## 问题

`dsh` 源码入口原本使用 `tsx` 运行 `apps/cli/src/bin.ts`，TypeScript 转换和根 tsconfig 的 `paths` 解析都由同一个第三方 loader 隐式处理。改由 Node 原生处理 TypeScript 后，Node 不会应用 tsconfig 路径映射；如果改为通过包导出解析，源码启动会混入可能陈旧或不存在的 `lib/` 产物。

Node 的转换也不执行类型分析。通过普通值 import 导入的类型会保留为运行时 ESM 请求，而 TypeScript 的 `export =` 会转换成 CommonJS 赋值，而不是 ESM default export。因此，源码图必须显式使用仅类型导入和原生 ESM 导出；resolve hook 无法修复不兼容的源码语法。

Cordis 配置还引入了另一条解析边界。`cordis.yml` 中的 bare plugin 不经过 TypeScript import 分析，其解析方的 manifest（元数据清单）可能漏掉所需依赖。Cordis Loader 会记录插件 import 错误，并留下没有 fiber 的 entry，但不会让启动本身失败；配置中的拼写错误因此可能得到退出码为 0 的残缺应用。

## 决策

`dsh` 的 TUI、Web 和无头源码启动使用 `node --experimental-transform-types`，由 Node 完成 TypeScript 转换，不加载 `tsx` 或 esbuild。`bin/dsh`、根级 `dsh`/TUI/Web demo 以及 Code Mode TUI 都进入同一条 `apps/cli/src/bin.ts` 启动链路。测试与 e2e 启动器保留各自现有策略，构建后的 `lib/bin.js` 继续由普通 Node 运行。

`scripts/tspath-loader.ts` 只注册一个模块解析钩子。设置 `TSX_TSCONFIG_PATH` 时，它会使用该路径（相对路径从调用方的 cwd 解析），否则读取根 `tsconfig.json`；`TsconfigPathsResolver` 使用仓库已有的 TypeScript 开发工具沿该配置的 `extends` 链解析，按 tsconfig 规则选择精确或 wildcard `paths` 条目，并将命中的 workspace bare specifier 映射到 `.ts`/`.mts`/`.cts` 源文件或目录 index 文件。代码转换始终只由 Node 负责。该源码专用 loader 不属于构建后的 CLI，`apps/cli` 也不会把 `typescript` 声明为运行时依赖。

只有当目标包是最近一层包 manifest 的自身名称或该 manifest 已声明的运行时依赖时，源码 import 才会重定向。Cordis Loader 使用配置目录 URL 作为 import parent；此时 resolver 会向上查找声明该插件的 workspace manifest。因此，已交付的 `apps/cli/config/base.cordis.yml` 及其界面覆盖层所需依赖由 `apps/cli/package.json` 持有。未命中 tsconfig paths、引用未声明依赖或不是 bare specifier 的说明符全部交回 Node 默认解析。

`verify-cordis-config` 对该解析方 manifest 执行单向完整性检查：配置中的每个 bare plugin package 都必须出现在对应 manifest 的 `dependencies` 中，manifest 可以包含该配置未引用的额外依赖。根 `AGENTS.md` 将同步更新配置和依赖定为常驻规则。

Loader 完全停稳后，共享的 `dsh-app-boot` 会检查每个已启用但没有 fiber 的 entry，并拒绝启动，报错为 `plugin(s) failed to load: ...; Cordis startup failed because these plugin(s) could not be resolved`，同时列出全部加载失败的插件。该诊断位于应用层，不改变 vendor 中 Loader 的启动行为。

Node-compatible TypeScript 是这项源码启动契约的一部分。vendor 中的 Cordis、Loader、Include、HMR（热模块替换）和 Schemastery 使用 `import type` 标记会被擦除的导入。Schemastery 使用原生 ESM default export 并声明 `type: module`；其 `.mjs` 和 `.cjs` 构建产物分别保留现有的 ESM default export 行为和 `require()` 返回可调用值的行为。这些差异记录在 `vendor/README.md` 中；没有为 vendor 中的框架新增运行时行为。

## 曾考虑的替代方案

**继续使用 `tsx`。** 不采用，因为 `tsx`/esbuild 会继续负责 TypeScript 转换，本启动链路无法因此证明 Node 原生转换可用。

**让源码入口通过包导出加载构建后的 `lib/`。** 不采用，因为这会混合 source plane 与 artifact plane；无需预先构建的开发启动可能读取陈旧产物或直接失败。

**无条件应用根 tsconfig `paths`。** 不采用，因为这会让未声明的跨包 import 和 Cordis 插件继续成功解析，从而掩盖 manifest 与实际运行图之间的不一致。

**在自定义 loader 内转换 import。** 不采用，因为感知类型的源码改写会重新引入编译器式转换，并让 loader 而非 Node 负责执行 TypeScript。使签入仓库的源码兼容 Node，可以让启动边界保持显式。

## 后果

- TUI／无头界面保留零构建源码回路，Web 仍会在启动 CLI 源码入口前构建前端产物。TypeScript 语法只经过 Node 原生转换；仅处理 URL 的 loader 使用 checkout 根目录的开发依赖，不增加 CLI 运行时依赖。
- workspace package import 和 Cordis 配置依赖都必须在解析方 manifest 中明确声明；静态门禁防止配置先于依赖落地，额外依赖不构成错误。
- 插件 import 失败不再留下退出码为 0 的残缺应用；最终错误同时说明 Cordis 启动失败及具体插件名，Loader 的原始错误仍会保留在更早的日志中。
- CLI 源码图中的 vendor 源码必须与 Node 的 transform-types 模块语义兼容；本地修改记录明确了上游同步义务。
- CI 的 `lib` 模式、测试／e2e 启动器和其他示例启动器保留各自现有策略；该原生源码 loader 只覆盖 `dsh` CLI 应用链路。
