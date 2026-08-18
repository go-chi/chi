# Get started with the Python SDK

English | [中文](python-sdk.zh.md)

This tutorial is the programmatic alternative to the Web UI. It installs the published Python SDK, runs a checked-in agent composition, and shows how to call the same API from your own program.

## Prerequisites

- Python 3.10 or newer
- Git
- Linux x64, Linux arm64, or macOS 14 or newer on arm64
- A DeepSeek-compatible API endpoint and credential
- An isolated workspace that the agent may modify

## Install the SDK

Clone the repository for its runnable example, create a virtual environment, and install the SDK with its same-version bundled runtime:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
python -m venv .venv
. .venv/bin/activate
python -m pip install deepseek-harness-sdk
```

The installed runtime needs no system Node.js. Repository contributors who need to build the runtime or wheels from source should use the [Python contributor workflows](../../../python/development.md).

## Run the checked-in example

Set the credential in the environment. Set `DEEPSEEK_BASE_URL` as well when the model is served by an OpenAI-compatible proxy rather than the default DeepSeek endpoint.

```sh
export DEEPSEEK_API_KEY=sk-your-key-here
# export DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1
# export DSH_MODEL=deepseek-v4-flash
# export DSH_SYSTEM_PROMPT='You are a helpful software engineer assistant.'
```

Run one task against an isolated workspace and session directory:

```sh
python examples/jsonrpc-agent/minimal.py \
  --workspace /absolute/path/to/workspace \
  --session-root /absolute/path/to/sessions \
  --session-id example-001 \
  "Inspect the repository and fix the failing tests."
```

The script prints the final assistant response. The session directory receives a JSONL log containing the assembled model requests and tool calls.

## Use the SDK in your own program

The checked-in example is a thin wrapper around this SDK call:

```python
from pathlib import Path

from deepseek_harness import DeepSeekHarness

config = Path("examples/jsonrpc-agent/minimal.cordis.yml").resolve()
workspace = Path("/absolute/path/to/workspace").resolve()
sessions = Path("/absolute/path/to/sessions").resolve()

with DeepSeekHarness(
    provider="deepseek-official",
    model="deepseek-v4-flash",
    max_tokens=49_152,
    cwd=str(workspace),
    session_root=str(sessions),
    cordis=str(config),
) as harness:
    result = harness.run(
        "Inspect the repository and fix the failing tests.",
        session_id="example-001",
    )

print(result.final_response)
```

`DeepSeekHarness` starts the bundled runtime lazily and reuses it until the context manager exits. Reusing the same harness and session id preserves the session-owned Bash process, including its working directory, exported variables, and shell functions. Use a fresh session id for an independent task; reuse an id only when the next call should continue the same durable conversation.

## Understand the example composition

| Property | Value |
|---|---|
| System prompt | `DSH_SYSTEM_PROMPT`, falling back to `You are a helpful software engineer assistant.` |
| Model in `minimal.py` | `--model`, then `DSH_MODEL`, then `deepseek-v4-flash` |
| Model-facing tools | Persistent `bash` and `str_replace_editor` only |
| Bash timeout | 300 seconds |
| Editor output limit | 16,000 characters |
| Context compaction | Disabled |
| Filesystem | Bare local backend; absolute editor paths may address any path visible to the runtime process |
| Session persistence | Uncompressed JSONL under `DSH_SESSION_ROOT` |

The composition omits harness identity, workspace prompt text, skills, one-shot Bash, task tools, compaction, and every other model-facing plugin. Sandbox-policy facts are logged as runtime user context rather than appended to the system prompt.

## Choose workspace and session IDs

`cwd` selects the workspace available to the agent, while `session_root` stores session logs and state. Use a fresh session id for an independent task; reuse an id only when the next call should continue the same conversation and persistent shell state.

The composition uses `danger-full-access`. Run it only inside a disposable checkout or container: Bash and the editor can modify any path allowed to the runtime process. The persistent PTY backend requires a POSIX terminal substrate, so this composition does not support Windows agents.

The [`jsonrpc-agent` example reference](../../../examples/jsonrpc-agent/README.md) owns the exact composition. The [Python SDK reference](../../../python/sdk/README.md) covers lifecycle, results, notifications, runtime selection, and configuration; the [Cordis primer](../../cordis-primer.md) covers composition syntax.
