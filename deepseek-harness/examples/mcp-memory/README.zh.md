# 第三方记忆 MCP 示例

[English](README.md) | 中文

这三份**默认关闭的参考配置**通过 [`@deepseek-ai/dsh-mcp-client`](../../packages/mcp/mcp-client/README.md) 将一个记忆系统连接到 DSH。请选择其中一份，或复制相同的通用 MCP 配置项来连接其他服务器。

这些第三方配置仅作为互操作参考；收录不代表 DeepSeek 的认可、推荐、合作关系或持续支持承诺。

## DSH 负责什么

DSH 解析选中的 Cordis overlay，启动已配置的 stdio 命令或连接已配置的 Streamable HTTP URL，发现 MCP 工具，并以 `mcp__<serverName>__<tool>` 的形式公开这些工具。DSH **不负责** 下载服务器、初始化其数据库、选择模型或 embedding 提供方、创建云端账户、迁移提供方数据，也不监管独立的 HTTP 服务。对于 stdio，通用客户端会随 DSH 插件生命周期启动和停止子进程；对于 HTTP，上游服务必须已经运行。

stdio 桥接器在启动子进程前会主动移除环境中名称通常表示凭据的变量和所有 `DSH_*` 变量；其余环境变量仍会继承。每份示例仅添加其基线所需的覆盖项。如果某个可选的上游功能还需要其他密钥，请将该变量添加到配置项的 `config.env`，不要把密钥直接写进 YAML。

## 选择一个

| 系统 | 已测试版本 | 传输方式 | 上游前置条件 |
|---|---:|---|---|
| [Memorix](https://github.com/AVIDS2/memorix) | `memorix@1.3.0`（`500792cad3144142293bfbb20acb4841c9f7fcfa`） | stdio | Node 22.18+，并执行 `npm install --global memorix@1.3.0` |
| [MCP Reference Memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) | `@modelcontextprotocol/server-memory@2026.7.4`（`6dd0a683e198783e30feabf7abaf42f925bd18b1`） | stdio | `npm install --global @modelcontextprotocol/server-memory@2026.7.4` |
| [Engram](https://github.com/Gentleman-Programming/engram) | `v1.20.0`（`ba9e46ced152c37a7cb9e576153c41995873e2fc`） | stdio | Go 1.25.10+，并执行 `go install github.com/Gentleman-Programming/engram/cmd/engram@v1.20.0`，或安装匹配的发布版二进制文件 |

## 启用一个

将一份 overlay 传给 DSH：

```sh
dsh web --patch "$PWD/examples/mcp-memory/memorix.cordis.yml"
```

请将文件名替换为 `mcp-reference-memory.cordis.yml` 或 `engram.cordis.yml`。该路径可以指向磁盘任意位置的一份复制文件。交付组合不包含任何记忆服务器，因此不传 `--patch` 就会让这三项全部保持关闭。

如果要跨次运行保留所选配置，请将对应文件中的单个 `insert` patch 合并到用户 patch 层：只对一个 profile 生效则写入 `$DSH_HOME/profiles/<name>/cordis.patch.yml`，对本机所有 profile 生效则写入 `$DSH_HOME/cordis.patch.yml`。不要覆盖已有文件，其中可能已经包含无关的用户 patch。

## 提供方设置

### Memorix

```sh
npm install --global memorix@1.3.0
dsh web --patch "$PWD/examples/mcp-memory/memorix.cordis.yml"
```

Memorix 无需 LLM（大语言模型）或 embedding 服务，即可在本地启发式模式下运行。请在 Memorix 自己的 `~/.memorix/config.toml` 或项目 `memorix.toml` 中配置可选提供方。该示例沿用 DSH 工作目录中的 Git 项目标识，并使用 Memorix 自身的默认目录 `~/.memorix/data`。若要覆盖该目录，请在启动 DSH 前设置 `MEMORIX_DATA_DIR`。

### MCP Reference Memory

```sh
npm install --global @modelcontextprotocol/server-memory@2026.7.4
dsh web --patch "$PWD/examples/mcp-memory/mcp-reference-memory.cordis.yml"
```

该参考服务器存储本地知识图谱，并公开实体、关系、观察、读取、搜索和打开工具。它不需要模型或 embedding 服务。该示例将 JSONL 存储在 `$HOME/.dsh-mcp-reference-memory.jsonl`，而不是已安装的 npm 包目录中。若要覆盖该路径，请在启动 DSH 前设置 `MEMORY_FILE_PATH`。

搜索只对实体名称、类型和观察进行不区分大小写的子字符串匹配，不是语义检索。该服务器不提供 embedding、自动摘要、冲突消解或遗忘策略。

### Engram

```sh
go install github.com/Gentleman-Programming/engram/cmd/engram@v1.20.0
dsh web --patch "$PWD/examples/mcp-memory/engram.cordis.yml"
```

Engram 负责存储和项目选择：它默认使用 `~/.engram`，从 DSH 工作目录检测 Git 项目，并接受 `ENGRAM_DATA_DIR` 或 `ENGRAM_PROJECT` 作为环境覆盖项。

## 可选的共用模型指令

如果服务器的工具描述无法可靠触发记忆使用，请将以下简短、与提供方无关的指令添加到你现有的模型指令中：

> 用户要求记住某事时调用记忆写入工具；历史信息可能相关时，检索记忆并使用相关结果。

这只是附加指导。示例不会替换 DSH 系统提示词中的 persona。

## 验证写入、新会话召回和使用

请在整个过程中使用一个唯一值，并保持提供方的存储范围不变：

1. 在 DSH 会话 A 中提出：`Remember that my validation drink is lapsang-<unique suffix>.`。确认模型调用了提供方的写入工具，并且工具返回成功。
2. 在同一个仍在运行的 Host 中创建 DSH 会话 B。不要复制会话 A 的对话。提出：`What is my validation drink? Check memory.`。确认模型调用了提供方的搜索或召回工具，并返回该值。
3. 继续在会话 B 中提出：`Use that preference to suggest one drink for the meeting.`。确认回答使用了召回的值。

必须新建 DSH 会话，但不需要重启 Host。只有 MCP 子进程崩溃后才需要重启或执行 HMR（热模块替换），因为当前的通用客户端不会自动重连；其工具注册会一直保留，直到插件 dispose（资源释放）或成功重新同步，针对已关闭传输的调用可能失败。初始发现过程是异步的，因此发送第一条验证提示词前，请等待提供方的 `mcp__...` 工具出现。

## 接入其他 MCP 服务器

复制相同的条目字段，并使用唯一的 `id` 和 `serverName`：

```yaml
- insert:
    - id: memory-my-server
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: my-memory
        transport: stdio
        command: my-memory-mcp
        args: []
        env: {}
        cwd: !!js process.cwd()
```

对于远程服务器，请改用 `transport: streamable-http`、`url` 和 `headers`。提供方专属的安装、身份、认证、模型、embedding、持久化和许可仍由提供方负责。
