# jsonrpc-agent

English | [中文](README.zh.md)

The unattended coding-agent composition for the Python SDK's bundled JSON-RPC runtime. It intentionally loads no terminal UI, console logger, approval UI, or user-questions tool because stdout belongs to the SDK protocol and turns are driven by the SDK.

The model-facing tools are:

- `bash`, foreground only
- `read`, `write`, and `edit`
- `subagent`, using one foreground in-process spawn provider
- `todo_write`

The surrounding runtime also loads JSONL session persistence and automatic context compaction. `maxTokensAsSuccess` keeps a token-limited model turn as an accepted evaluation result while preserving its `max-tokens` reason.

## Runtime environment

| Variable | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` | Credential passed to the OpenAI-compatible host endpoint |
| `DEEPSEEK_BASE_URL` | Host endpoint used by `dsh-llm-deepseek` |
| `DSH_CWD` | Agent workspace for bash and filesystem tools |
| `DSH_CONTEXT_WINDOW` | Context capacity recorded for the `DSH_MODEL` catalog entry in the minimal variant |
| `DSH_MAX_TOKENS_AS_SUCCESS` | `true` (default) accepts token-limited results; `false` reports them as errors |
| `DSH_MODEL` | Default model used by `minimal.py`; `--model` takes precedence |
| `DSH_SESSION_ROOT` | JSONL session directory |
| `DSH_SYSTEM_PROMPT` | Deployment-provided coding persona |

Pass the config path through the Python SDK's `cordis` option or `DSH_CORDIS_CONFIG`. The bundled executable already carries every plugin named by this file; the target machine does not need Node.js.

## Minimal variant

[`minimal.cordis.yml`](minimal.cordis.yml) is the complete standalone counterpart of the Web `minimal` preset. `DSH_SYSTEM_PROMPT` selects its system prompt, with `You are a helpful software engineer assistant.` as the fallback. It suppresses every system-prompt runtime-context contribution for fresh sessions and mounts no context-compaction plugin. Its model-facing tools are exactly:

- owner-scoped persistent `bash`
- `str_replace_editor` with `view`, `create`, `str_replace`, and `insert`

It composes the local PTY, bare `fs-local` backend, danger-full-access policy for persistent Bash, and uncompressed JSONL persistence needed by the bundled runtime. Bash and absolute editor paths can modify any path available to the runtime process, so run this variant only against a disposable checkout or container. The persistent PTY requires a POSIX terminal environment and is not a Windows agent interface.

[`minimal.py`](minimal.py) runs the composition through the Python SDK and uses `DSH_MODEL` as its default model. The [Python SDK tutorial](../../docs/user/guide/python-sdk.md) covers installation, execution, workspace selection, and session identity; the [SDK reference](../../python/sdk/README.md) owns runtime lifecycle and result semantics.
