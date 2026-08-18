# attachment/：持久附件能力族

[English](README.md) | 中文

持久二进制附件 seam 及其本地文件系统实现。两者均为产品包。

| 包 | 角色 | ctx 键 |
|---|---|---|
| `attachment/` | 不可变附件引用、图片限制和存储服务 | `ctx.attachments` |
| `attachment-local/` | `DSH_HOME` 下的私有内容寻址存储 | （注册至 `ctx.attachments`） |

未发送的浏览器草稿刻意位于这项能力之外。只有用户提交提示词，或提供方适配器提交结构化模型输出时，字节才进入持久存储。
