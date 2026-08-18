# credentials/：凭据引用

[English](README.md) | 中文

凭据能力家族将引用解析与提供方分离：

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`credentials/`](credentials/README.md) | 凭据引用 seam | `ctx.credentials` |
| [`credentials-local/`](credentials-local/README.md) | 环境与本地文件提供方 | 注册 `ctx.credentials` |

配置携带引用而非机密值。消费方在其操作边界解析这些引用；变更、优先级与存储语义由子级 README 负责。

子系统参考——`CredentialRef`、按操作解析、对 UI 安全的 `CredentialInfo`、提供方层——见 [docs/subsystems/credentials.md](../../docs/subsystems/credentials.md)。
