# Third-party memory MCP examples

English | [中文](README.zh.md)

These three **default-off reference configurations** connect one memory system to DSH through [`@deepseek-ai/dsh-mcp-client`](../../packages/mcp/mcp-client/README.md). Pick one, or copy the same generic MCP row for another server.

These third-party configurations are provided as interoperability examples only. Their inclusion does not imply endorsement, recommendation, partnership, or ongoing support by DeepSeek.

## What DSH does

DSH parses the selected Cordis overlay, starts a configured stdio command or connects to a configured Streamable HTTP URL, discovers MCP tools, and exposes them as `mcp__<serverName>__<tool>`. DSH does **not** download the server, initialize its database, choose its model or embedding provider, create a cloud account, migrate vendor data, or supervise a separate HTTP service. For stdio, the generic client launches and stops the child with the DSH plugin lifecycle; for HTTP, the upstream service must already be running.

The stdio bridge deliberately removes ambient variables whose names usually identify credentials and all `DSH_*` variables before launching a child; other ambient variables remain inherited. Each example adds only the baseline override it needs. If an optional upstream feature needs another secret, add that variable to the row's `config.env` instead of putting the secret directly in YAML.

## Choose one

| System | Tested pin | Transport | Upstream prerequisite |
|---|---:|---|---|
| [Memorix](https://github.com/AVIDS2/memorix) | `memorix@1.3.0` (`500792cad3144142293bfbb20acb4841c9f7fcfa`) | stdio | Node 22.18+ and `npm install --global memorix@1.3.0` |
| [MCP Reference Memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) | `@modelcontextprotocol/server-memory@2026.7.4` (`6dd0a683e198783e30feabf7abaf42f925bd18b1`) | stdio | `npm install --global @modelcontextprotocol/server-memory@2026.7.4` |
| [Engram](https://github.com/Gentleman-Programming/engram) | `v1.20.0` (`ba9e46ced152c37a7cb9e576153c41995873e2fc`) | stdio | Go 1.25.10+ and `go install github.com/Gentleman-Programming/engram/cmd/engram@v1.20.0`, or the matching release binary |

## Enable one

Pass one overlay to DSH:

```sh
dsh web --patch "$PWD/examples/mcp-memory/memorix.cordis.yml"
```

Replace the filename with `mcp-reference-memory.cordis.yml` or `engram.cordis.yml`. The path may point to a copied file anywhere on disk. No memory server is present in the shipped composition, so omitting `--patch` keeps all three disabled.

To keep the selection across runs, merge the chosen file's single `insert` patch into a user patch layer — `$DSH_HOME/profiles/<name>/cordis.patch.yml` for one profile, or `$DSH_HOME/cordis.patch.yml` for every profile on the machine. Do not copy over an existing file: it may already contain unrelated user patches.

## Provider setup

### Memorix

```sh
npm install --global memorix@1.3.0
dsh web --patch "$PWD/examples/mcp-memory/memorix.cordis.yml"
```

Memorix works in local heuristic mode without an LLM or embedding service. Configure optional providers in Memorix's own `~/.memorix/config.toml` or project `memorix.toml`. The example keeps Memorix's Git-project identity from the DSH working directory and uses Memorix's own `~/.memorix/data` default. Set `MEMORIX_DATA_DIR` before starting DSH to override it.

### MCP Reference Memory

```sh
npm install --global @modelcontextprotocol/server-memory@2026.7.4
dsh web --patch "$PWD/examples/mcp-memory/mcp-reference-memory.cordis.yml"
```

This reference server stores a local knowledge graph and exposes entity, relation, observation, read, search, and open tools. It needs no model or embedding service. The example stores its JSONL at `$HOME/.dsh-mcp-reference-memory.jsonl` instead of the installed npm package directory. Set `MEMORY_FILE_PATH` before starting DSH to override it.

Search is case-insensitive substring matching over entity names, types, and observations, not semantic retrieval. The server does not add embeddings, automatic summarization, conflict resolution, or a forgetting policy.

### Engram

```sh
go install github.com/Gentleman-Programming/engram/cmd/engram@v1.20.0
dsh web --patch "$PWD/examples/mcp-memory/engram.cordis.yml"
```

Engram owns storage and project selection: it uses `~/.engram` by default, detects the Git project from the DSH working directory, and accepts `ENGRAM_DATA_DIR` or `ENGRAM_PROJECT` as ambient overrides.

## Optional shared model instruction

Add this short, vendor-neutral instruction to your existing model instructions if the server's tool descriptions do not trigger memory use reliably:

> When the user asks you to remember something, call a memory write tool. When historical information may be relevant, search memory and use relevant results.

This is additive guidance only. The examples do not replace DSH's system-prompt persona.

## Verify write, fresh-session recall, and use

Use one unique value and keep the provider's storage scope unchanged throughout:

1. In DSH session A, ask: `Remember that my validation drink is lapsang-<unique suffix>.` Confirm the model called the provider's write tool and the tool returned success.
2. Create DSH session B in the same running Host. Do not copy session A's conversation. Ask: `What is my validation drink? Check memory.` Confirm the model called the provider's search or recall tool and returned the value.
3. Still in session B, ask: `Use that preference to suggest one drink for the meeting.` Confirm the answer uses the recalled value.

A new DSH session is required; a Host restart is not. Restart or HMR is needed only after an MCP child crashes because the current generic client does not auto-reconnect; its tool registrations remain until plugin disposal or a successful re-sync, and calls can fail against the closed transport. Initial discovery is asynchronous, so wait for the provider's `mcp__...` tools before sending the first validation prompt.

## Bring another MCP server

Copy the same entry fields and use a unique `id` and `serverName`:

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

For a remote server, use `transport: streamable-http`, `url`, and `headers` instead. Provider-specific installation, identity, authentication, models, embeddings, persistence, and licensing remain the provider's responsibility.
