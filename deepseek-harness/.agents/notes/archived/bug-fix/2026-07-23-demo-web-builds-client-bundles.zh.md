# Agent Note: demo:web 构建客户端插件的打包产物

Status: implemented
Archived: 2026-07-26

[English](2026-07-23-demo-web-builds-client-bundles.md) | 中文

## Problem

`dsh web` 通过 `GET /plugins/<id>/client.js` 提供每个 web 客户端插件的打包产物，其路径由包的 `exports["./client"]`（`lib/client.js`）解析得到。这些打包产物只由根目录的 `pnpm run build`（先 `tsc -b`，再执行各包的 `tsdown.client.ts` 配置）生成；Vite 的 `build:web` 步骤只构建前端外壳。`demo:web` 与 README 的 Web UI 说明只运行了 `build:web`，因此在未预先完整构建的检出上，每个插件的打包产物都返回 404，客户端 loader 将所有插件标记为失败，启动界面显示 "Failed to load plugins"。前端外壳能正常构建，把缺失的产物掩藏在浏览器运行时的失败背后。

## Decision

`demo:web` 在 `npm run build:web` 之前先运行 `npm run build`，使插件的 `lib/client.js` 打包产物在 `dsh web` 提供它们之前已经存在。README 的 Web UI 小节针对已安装的 `~/.dsh/source` 检出运行 `pnpm run build && pnpm run build:web`，因为安装器从不构建它。

## Verification

完整构建后，全部八个 `/plugins/<id>/client.js` 端点均返回 200，无头 Chromium 加载 `http://127.0.0.1:3080` 能渲染出外壳，不再出现 "Failed to load plugins" 状态。

## Alternatives considered

**在 `dsh web` 启动时构建打包产物。** 该应用通过 tsx 从源码运行，本身没有构建步骤；把产物构建塞进服务器启动流程会越过源码与产物的分离，并拖慢每次启动。

**扩大 tsdown 根配置，使 `pnpm run build:web` 也产出客户端打包产物。** `build:web` 是 Vite 前端构建；客户端打包产物是对 `lib/types` 的另一趟独立 tsdown 处理。把两者合并会混淆外壳构建与包构建，而且根目录的 `build` 仍是唯一的产出者。

## Consequences

`demo:web` 现在每次调用都要付出完整的 `tsc -b && tsdown` 代价，而不再只是 Vite 构建。这是从干净的代码树运行 web 演示所要付出的代价；已经完成构建的调用方可以直接调用 `dsh web`。
