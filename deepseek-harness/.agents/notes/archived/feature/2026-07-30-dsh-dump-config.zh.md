# Agent Note: dsh --dump-config 打印合成后的配置树

Status: implemented
Archived: 2026-08-07

[English](2026-07-30-dsh-dump-config.md) | 中文

## Problem

启动的配置树是一份用户从未见过的合成结果：已交付的基础配置、界面覆盖层，以及 `--config` 或个人 `~/.dsh/config.yaml` 覆盖层作为同级补丁列表依次应用，其中每个按 id 定向的补丁替换目标行的整个 `config`，未匹配的 id 只产生警告。调试一个行为异常的个人覆盖层（漏掉需要重述的字段、行 id 拼错、补丁应用到了错误的界面）需要在脑中跨三个文件重放补丁算法。既没有办法看到生效的树，也没有办法把它与已交付的默认值做 diff。

## Decision

`dsh --dump-config` 和 `dsh web --dump-config` 把合成后的条目列表——基础配置、界面覆盖层、再叠 `--config` 或个人覆盖层，恰好是该界面启动时组装的那些层——以 YAML 打印到 stdout 后退出，不启动任何东西。`dsh --dump-default-config` / `dsh web --dump-default-config` 止步于界面覆盖层，因此对两份输出做 diff 就能精确看出用户层改了什么。

dump 不可能与实际启动漂移，因为它复用挂载代码：vendored include 把补丁算法导出为纯函数 `applyEntryPatches(data, patches, warn)`（私有的 `applyPatches` 方法现在委托给它），并把 `!!js` YAML 方言导出为 `entryListSchema`；`dsh-app-boot` 的 `renderConfigDump()` 通过这两者对带标签的层完成合成与渲染，`apps/cli/src/dump-config.ts` 只是选择界面的薄封装。`!!js` 表达式原样打印、不求值——dump 展示的是合成结果，不是某个进程的环境——目标行不存在的补丁会连同其层标签报到 stderr，与 Loader 启动时的警告一致。由启动器持有的启动上下文值（会话身份、web 的 CLI 标志补丁、前端 dist 路径）是每次调用的事实，位于配置树之外，不会出现。dump 标志拒绝仅用于启动的标志（`-p`、`--resume`、`--config-replace`）且两个 dump 标志互斥，`--dump-default-config` 不接受 `--config`。

每段来源相同的连续行之前都有一条 `# ==` 注释，标明贡献这些行的文件以及修补过它们的层（`# == base.cordis.yml, patched by tui.cordis.yml`），因此输出既展示每一节来自哪个文件，又仍是一份可加载的 YAML 文档。合成是对所有层展平后的一次 `applyEntryPatches` 调用——与启动的调用形状完全一致，因此即便是补丁可见性的边角情况（后一层定位到前一层通过普通 `config` 替换引入的组内子项，而单遍 id 索引看不到它）也与启动合成完全相同；若按层各调用一次，会在层与层之间重建索引，打印出一棵启动从不挂载的树。来源从单次调用的前缀快照（基础 + 第 1..k 层）按位置 diff 得出：补丁算法只会原地改写行或在末尾追加，因此顶层索引在各快照之间标识同一行；加入某层后该行发生变化（替换 config、禁用、组内插入）即视为该层修补了这一行。每个快照都会克隆补丁列表，因为 `applyEntryPatches` 会把 `insert` 行按引用从补丁列表推入结果。

`dsh-app-boot` 之前为解析补丁复制了 include 的 `!!js` YAML 类型；现在改为导入 `entryListSchema`，方言只有一个归属者。

## Alternatives considered

**启动整棵树后 dump `ctx.loader.entries()`。** 拒绝：启动会求值 `!!js` 表达式（把某台机器的环境泄漏进打印的配置）、以副作用启动适配器和会话、需要独立于 TTY 的拆卸路径，而且慢。dump 是用来调试合成的，而合成是那些文件的纯函数。

**在 CLI 里重新实现补丁合并。** 拒绝：`applyPatches` 的第二个实现会与 vendored include 悄然漂移——这恰恰是该功能要调试的失败模式。导出 include 自己的算法只花费一条记录在案的 vendor 修改，却保证了同一性。

**用 `/dump-config` TUI 命令代替标志。** 作为唯一形式被拒绝：主要用法是 `dsh --dump-config | diff - <(dsh --dump-default-config)` 这类管道工作流，需要免启动、非 TTY 的界面。之后可以在同一个 `renderConfigDump` 之上再加 TUI 命令。

## Consequences

配置调试从脑中重放补丁变成一条命令，支持工作也可以直接索要 `--dump-config` 输出。vendored include 多出一条记录在案的本地修改（导出 `applyEntryPatches`/`entryListSchema`；对挂载行为无影响），上游同步时需重新应用。来源追踪为每层重新合成一次前缀快照并按 JSON stringify 对行做 diff，因此 dump 有与层数²×行数成正比的额外开销；该开销只存在于免启动的 dump 路径。`renderConfigDump` 的单元测试覆盖层叠顺序、`!!js` 原样往返、来源分隔与分组、带标签的未匹配补丁警告，以及读取／解析／形状失败的大声报错；built-bin e2e 通过 `lib/bin.js` 驱动全部四种标志形式，包括个人覆盖层、其来源标签及其 stderr 警告。
