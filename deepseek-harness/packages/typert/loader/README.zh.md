# @deepseek-ai/dsh-typert-loader

[English](README.md) | 中文

生成的 Typert 产物所用的 Loader 集成，仅支持 Node。该插件需要 `ctx.loader` 和 `ctx.typert`；它本身不提供注册表。

激活时，该插件会扫描现有的 Loader 配置项。随后它会监听 Cordis `internal/plugin` 生命周期通知，解析每个配置项所属包的 `package.json`，在其导出 `./typert` 时导入该子路径，校验其 `TYPERT` manifest（元数据清单），并注册该贡献项，直到配置项或本插件卸载。如果导入操作在配置项或本插件卸载后才结束，系统会丢弃其结果。

`packages` 用于列出需要为嵌套在另一 Loader 配置项下的插件额外注册的包产物。Cordis fiber 不会保留这些嵌套插件的 npm 包说明符，因此这里通过显式配置划定边界；配置中列出的每个包都必须能从配置树解析，并导出 `./typert`。

未导出该子路径的包会被跳过。包解析结果和已导入的 manifest 会在整个进程生命周期内缓存，因此新增该导出后必须重启进程。插件激活时，如果已挂载 Loader 配置项对应的产物格式错误，激活会失败；之后才发生的失败只会记录到日志，不会阻止无关包完成注册。

## 模型体验

无。loader 只向 [`ctx.typert`](../registry/README.md) 提供注册项；任何模型可见投影均由消费方负责。

#### KV Cache 影响

无直接影响。

## 已知限制与暂缓事项

- 发现机制只会导入宿主侧产物；若要为客户端运行时添加等价的发现机制，需要先有独立的组合所有者。
- Loader 配置项会自动发现。嵌套插件或非 Loader 插件需要显式加入 `packages`，或由其所有者直接负责调用 `ctx.typert.register()`。
