# settings/：用户设置能力族

[English](README.md) | 中文

该包族通过注册的命名空间与可替换存储提供方解析用户可编辑配置。

| 包 | 职责 | ctx key |
|---|---|---|
| [`settings/`](settings/README.md) | 定义命名空间注册、分层解析与提交 | `ctx.settings` |
| [`settings-file/`](settings-file/README.md) | 在本地文件中存储设置并观察外部编辑 | 注册到 `ctx.settings` |

子系统参考——命名空间、owner scope、解析顺序、热提交——见 [docs/subsystems/settings.md](../../docs/subsystems/settings.md)。
