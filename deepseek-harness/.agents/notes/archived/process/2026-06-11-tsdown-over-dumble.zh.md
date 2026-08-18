# Agent Note: 使用 tsdown 替代 dumble 进行 JS 打包

Status: implemented
Archived: 2026-07-27

[English](2026-06-11-tsdown-over-dumble.md) | 中文

## 问题

最初的构建使用 **dumble**，即 cordiverse 的零配置 esbuild 包装层——上游 Cordis 自身也用它构建——与 vendor 包（package）的约定最大程度对齐（它读取每个 package.json 并从 `exports` 字段推断入口/格式）。但 dumble 作为本仓库的承重工具存在隐患：v0.2.x，每周约 530 次 npm 下载，实质上只有一位维护者，而且由于它没有 workspace 模式，我们不得不通过自定义编排脚本（`scripts/build.ts`）来调用它。

目前构建产物只在 `pnpm run build` + publint 中有意义（尚未发布任何包；开发/测试/演示通过 tsx 直接运行未打包的源码），因此切换成本现在最低，一旦包开始发布就只会更高。

## 决策

用 **tsdown**（基于 rolldown，每周约 250 万次下载，VoidZero 支持，活跃发布）替代 dumble：

- 根目录 `tsdown.config.ts`，配置 `workspace: ['vendor/*', 'packages/*/*']`（显式 glob 将打包范围限定在 vendor 的 Cordis 与 TypeScript 包目录树内；`workspace: true` 还会发现示例 manifest 和不需要打包的 workspace 成员）。
- 共享形状：入口为 `lib/types/index.js`，`outDir: 'lib'`，ESM，`platform: node`，`target: es2024`，`fixedExtension: false`（为 `"type": "module"` 包保留 `.js`），`dts: false`（声明归 tsc -b 所有），`clean: false`（lib/ 还保存 TSC 的 `lib/types` 中间树）。入口最初是 `src/index.ts`；[TSC 优先构建 Agent Note（agent 决策记录）](2026-06-17-ts-build-config.md)随后将 tsdown 改为打包 TSC 输出的 JS，使 TypeScript 转换行为统一由一个编译器提供。
- vendor/ 中有两个按包覆盖的配置（属于我们自己的修改，与重新生成的 tsconfig 类似；记录在 vendor/README.md 中）：schemastery（通过 `outExtensions` 输出双格式 `.mjs`/`.cjs`）、logger-console（两次单入口 pass，使共享基类被内联到每个入口而非生成哈希命名的分片，与上游发布形态一致）。
- `scripts/build.ts` 删除；`pnpm run build` = `tsc -b && tsdown`（根 solution 拥有 emit 图）。

## 曾考虑的替代方案

- **直接编写 esbuild 脚本**：最成熟的引擎，零包装层风险，但需要手动维护 tsdown workspace 模式自动提供的按包规格表。
- **pkgroll**：理念上最接近的直接替代品，但每周仅 78k 下载且基于 Rollup，维护前景严格弱于 tsdown。
- **保留 dumble**：与上游完美对齐，但巴士因子不可接受。

## 后果

运行时 bundle 输出仍沿用 dumble 时代的公开入口形状（`lib/index.js`，以及包特有的变体，例如 `schemastery` 的 `lib/index.mjs`/`lib/index.cjs` 与 `logger-console` 的 `lib/browser.js`）；根据 [TSC 优先构建 Agent Note](2026-06-17-ts-build-config.md)，声明现位于 `lib/types` 下。External 仍来自各包的 dependencies/peerDependencies。我们放弃了 dumble 的 exports 字段推断：采用非默认形状的新包需要逐包提供 `tsdown.config.ts`，不能只依赖 package.json 字段。未来如果 `tsc -b` 成为瓶颈，tsdown 也可以接管声明打包（isolatedDeclarations）；这需要另写一份 Agent Note。
