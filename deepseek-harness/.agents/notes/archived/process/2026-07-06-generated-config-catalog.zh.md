# Agent Note: 生成式插件配置目录

Status: implemented
Archived: 2026-07-27

[English](2026-07-06-generated-config-catalog.md) | 中文

## 问题

仓库此前没有以源码为后盾的插件配置参考。各包（package）的 README 对字段的记录方式不一致，未列举哪些包可被加载，也未校验运行时 schema 与声明的配置类型是否一致。

## 决策

`scripts/gen-config-catalog.ts` 根据各插件声明的 config 类型和 JSDoc 生成 [docs/config-catalog.md](../../../../docs/config-catalog.md)，并包含注入要求、被引用类型的链接和源码位置。包内类型会以传递方式纳入；workspace 类型和外部类型则会链接或点名。确定性的 `--write` 和 `--check` 模式使提交页面成为生成产物。

此处采用纯 AST 生成是正确的，原因与事件/服务目录相同，而与工具目录不同：配置类型是静态声明，仓库中每个 schemastery schema 都是静态的 `z.object`/`z.intersect` 字面量，因此源码即全部真相——配置表面没有任何部分是运行时组合的。

具体选择：

- **配置类型是第二参数的类型。** catalog 记录的是 `apply(ctx, config)` / 服务构造函数 `(ctx, config)` 的声明参数类型——即 Cordis 实际传入的值——而非按命名约定定位的 `Config` 导出。这使得遍历是全量的：无论接口叫 `AcpConfig` 还是 `BasicCompactConfig`，无论类型声明在兄弟文件中，还是插件完全没有验证 schema，都能正常工作。
- **分类是全量的。** 每个 `packages/<group>/<pkg>` 条目都会被解析（镜像 Loader 的 `unwrapExports`：`exports.default ?? exports`），归入可配置插件、无配置插件、抽象 seam 类或库之一——各自渲染在独立小节中——无法归类的条目直接报错。新包不可能被悄悄遗漏。
- **逐字段 JSDoc 强制要求。** 粘贴的声明中每个属性（包括嵌套的类型字面量）都需要非空的 JSDoc 描述，否则生成失败。粘贴本身就是文档，因此这与 events catalog 通过 `@mode` 施加的强制函数相同：源码文档过于单薄时门禁报错，而非产出单薄的 catalog。
- **Schema 键与声明类型做比对。** 生成器通过局部和 workspace 类型解析嵌套的对象与数组路径。确定缺失的路径报错；无法枚举的外部或动态形状则跳过。比对有意设计为单向的，因为声明类型可能包含被排除在 loader 配置之外的运行时专用字段。
- **专用围栏。** 粘贴的声明使用 ` ```ts config-catalog ` 信息字符串，`doc-typecheck` 会跳过它（引用了导入类型的孤立声明无法独立编译），并将其排除在 opt-out 比例之外——与 `cordis-catalog` 和 `persistence-catalog` 围栏的处理方式相同。
- **单文件 `docs/config-catalog.md`**，而非一个单文件目录：该页面面向单一受众（`cordis.yml` 的编写者），只有一个维度，不同于 `cordis-catalog/`（其中包含两个并列页面）。

各包 README 中的 `## Config` 小节保留。重叠是有意接受的：README 是经过策划的逐包契约（在部署上下文中描述配置语义，连同限制与扩展点），catalog 则是穷举式的生成枚举。由于 catalog 是生成的，二者不一致时说明 README 有误，修复方式是编辑 README——catalog 不会漂移。

## 曾考虑的替代方案

- **合成式逐字段渲染**：为每个字段生成项目符号列表、表格或带注释的 YAML 片段，从解析的 JSDoc 加 schema 元数据组装。否决，改用逐字粘贴：接口连同其 JSDoc 本身就是以原始形式撰写的契约，合成渲染器会重新格式化它不拥有的行文，增加一个可能歪曲原意的渲染层。
- **运行时启动 + schema 内省（如工具目录所做的那样）**：否决。此处没有任何内容是运行时组合的，且 schema 本身对配置表面的文档化不足（以行文记录的默认值、运行时专用字段、完全没有 schema 的插件）。启动只会增加脆弱性而不增加真相。
- **双向 schema/接口等价检查**：否决，改用子集检查。声明类型合理地包含 schema 拒绝从配置接受的成员（运行时专用 seam）。
- **在同一变更中废除 README `## Config` 小节**：否决。保留可接受的重叠使逐包契约在原处可读，而清理工作需要先把每个 README 的额外事实折入字段 JSDoc——这是可分离的工作，catalog 不依赖它。

## 后果

- 目录不会发生漂移：提交文件未反映的源码变化会使 `doc-sync` 和 CI 中的 `verify-config-catalog` 失败。config 字段未记录、被引用类型名无法解析，或 schema 键未出现在 config 类型中，都会直接使生成器失败。
- 配置行文现在有了声明处的强制函数：编写新配置字段意味着编写其 JSDoc，而该 JSDoc 将逐字成为 catalog 条目。
- 生成器对无法静态遍历的形状直接报错——别名化的包内配置导入、非 `object`/`intersect` 组合构建的 schema、未列入的全局类型名。引入此类形状时必须同时教会生成器（否则该形状不能进入仓库），这正是设计意图：catalog 始终是全部真相。
- `gen-cordis-catalog.ts` 导出其 JSDoc/指针辅助函数与 `LINK_MAP` 供复用，因此两个 catalog 以相同方式交叉链接类型，新增一条 link-map 条目同时服务于两者。
