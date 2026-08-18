# examples/：开箱可运行的演示组合包

[English](README.md) | 中文

预先组合的插件组合包，供轻量叶节点 `cordis.yml` 加载，无需手工组装主干和运行入口。这些是 **演示／参考** 包；npm 名称的 `-demo` 后缀表明每个包都不属于产品对外接口，直接查看包名即可辨认。仓库根目录 [`examples/`](../../examples/AGENTS.md) 下的可运行叶节点与 [Python SDK 运行时](../../python/sdk-runtime/README.md) 是消费方；每个消费方都只包含可替换后端和一个组合包入口。

| 包 | npm 名称 | 角色 |
|---|---|---|
| [`agent-spine-demo/`](agent-spine-demo/README.md) | `@deepseek-ai/dsh-agent-spine-demo` | 可复用的 agent-spine（智能体主干）组合包 |
| [`acp-demo/`](acp-demo/README.md) | `@deepseek-ai/dsh-acp-demo` | ACP（Agent Client Protocol）自动化应用组合包 |
| [`jsonrpc-demo/`](jsonrpc-demo/README.md) | `@deepseek-ai/dsh-sdk-jsonrpc-demo` | 外部配置 JSON-RPC 运行时 |

`agent-spine-demo` 是共享组合包；`acp-demo` 添加自动化入口，`jsonrpc-demo` 则启动由部署方拥有的插件树。产品单次执行由 `dsh --profile headless` 提供；本目录没有任何包提供该功能。

这些包不是产品 API。产品 seam 与产品入口仍位于各自的归属组；演示组合包选择具体组合。

不要将此组与仓库根目录的 [`examples/`](../../examples/AGENTS.md) 混淆：该目录存放可运行的 `cordis.yml` **叶节点**；此组存放这些叶节点加载的 **组合包**。
