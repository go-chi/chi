# @deepseek-ai/dsh-e2b

English | [中文](README.zh.md)

Shared lifecycle owner for one E2B sandbox. The filesystem and subprocess adapters inject `ctx.e2b`, await its single SDK handle, and therefore inhabit the same remote Linux working tree and process world. The package pins `e2b@2.29.1`; the [family map](../README.md) lists the opt-in composition.

## Configuration

```yaml
- id: e2b
  name: '@deepseek-ai/dsh-e2b'
  config:
    cwd: /home/user/workspace
    timeoutMs: 300000

- id: subprocess-e2b
  name: '@deepseek-ai/dsh-subprocess-e2b'

- id: fs-e2b
  name: '@deepseek-ai/dsh-fs-e2b'
```

`apiKey` is optional and otherwise reads `E2B_API_KEY`; the key configures the host SDK connection and is never installed in the sandbox. `cwd` defaults to `/home/user/workspace` and must be an absolute POSIX path. `timeoutMs` defaults to five minutes and controls the sandbox lifetime; expiry deletes the sandbox.

## Lifecycle and ownership

Construction starts one sandbox creation. Before resolving `getSandbox()`, the service creates `cwd` and the private `cwd/.dsh-e2b` adapter-state directory, verifies that the reserved path is a real directory rather than a symlink or another file type, then sets it to mode `0700`. Each adapter-internal E2B command shell receives a fresh randomized root-level `HOME`, so the SDK's fixed login shell does not resolve profile files from the mutable user home before the control command.

Disposal first prevents new handle acquisition, then awaits setup and deletes the sandbox. A `SandboxNotFoundError` means expiry or another owner already deleted it and is accepted as quiescence. Initial directory setup failure makes one deletion attempt; the configured E2B timeout bounds a second failure. Provider plugins must load after this owner and dispose before it.

## Model Experience

None, as this shared runtime owner registers no model-visible context; provider adapters and their consumers own any rendered effects.

#### KV Cache effect

No direct invalidation; this package does not contribute request tokens.

## Known Limitations and Deferred Work

- **This is not a whole-harness runtime** — Cordis services, agent/session state, session logs, LLM requests, skills, and SDK-side buffers stay in the host process.
- **Sandbox state is ephemeral** — disposal and timeout delete the sandbox; reconnect, pause/leave retention, templates, volumes, and snapshots are outside this POC.
- **No deployment platform is configured** — network policy, host-workspace synchronization, and sandbox discovery are outside this POC.
- **`cwd` is a resolution convention, not containment** — adapters and commands can address other sandbox paths; E2B network access retains the base image's policy.
