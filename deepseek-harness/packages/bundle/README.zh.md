# bundle/ — profile 插件组合包

[English](README.md) | 中文

Profile 组合包：在 manifest（元数据清单）中声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 的 npm 包，因此可作为 patch 层安装进 `dsh --profile` 组合（[profile 约定](../boot/app-boot/README.md#profiles)）。组合包的实体是它的 patch 列表；有些组合包还附带由其 patch 挂载的运行时粘合插件。

| 包 | 职责 | ctx key |
|---|---|---|
| [`base/`](base/README.md) | 每个 profile 最先应用的共享 dsh 核心 | —（仅 patch） |
| [`web-app/`](web-app/README.md) | 浏览器表层：web patch 层 + 运行时粘合插件 | 挂载多条配置行 |
| [`headless/`](headless/README.md) | 直接运行在 base 之上的一次性任务模式，不含 Host 或 Web 层 | 挂载 `headless-runner` |

内置组合包从 dsh 安装目录解析；树外（out-of-tree）组合包通过 `dsh plugin --profile <name> add <package>` 安装进 profile。
