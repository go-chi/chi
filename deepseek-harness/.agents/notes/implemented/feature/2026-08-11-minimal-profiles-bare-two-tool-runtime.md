# Agent Note: Minimal profiles use the bare two-tool runtime

Status: implemented

English | [中文](2026-08-11-minimal-profiles-bare-two-tool-runtime.zh.md)

## Problem

The Web `minimal` preset and standalone JSON-RPC minimal composition exposed persistent `bash` and `str_replace_editor`, but their supporting services did not match the intended training runtime. Both mounted context compaction, while the Web preset inherited the host's sandboxed filesystem and the JSON-RPC composition mounted `fs-sandbox` plus filesystem policy. A long session could therefore replace history, and the editor advertised and enforced a filesystem policy that the bare local reference runtime does not have.

The two launch paths also have different configuration owners. Web mounts a per-agent preset over a running host, while the Python SDK initializes a complete stdio JSON-RPC child process. Treating them as one interchangeable Cordis leaf would hide those lifecycle differences, and the SDK example had no environment path for selecting its model or system prompt.

## Decision

Both shipped minimal profiles expose exactly persistent `bash` and `str_replace_editor`, mount no context-compaction provider, suppress every `dsh-system-prompt` runtime-context contribution for fresh sessions, and run the editor against `@deepseek-ai/dsh-fs-local`. The Web preset isolates `ctx.fs` inside the agent entry and mounts `fs-local` beside the editor, so other Web agents retain the host filesystem provider. Its persona remains the fixed complete prompt owned by the earlier [minimal-preset composition decision](../bug-fix/2026-08-10-minimal-preset-owns-rl-composition.md) and applies runtime-context suppression only to that agent scope. The standalone spine forwards the same setting to its process-owned system-prompt service. Sandbox and approval services remain mounted and enforce their policies; only their model-facing dynamic context is absent.

The standalone [`minimal.cordis.yml`](../../../../examples/jsonrpc-agent/minimal.cordis.yml) remains a complete JSON-RPC process composition. It mounts `dsh-sdk-jsonrpc-server`, the local PTY and subprocess services required by persistent Bash, `fs-local`, the two tool consumers, and uncompressed JSONL persistence. It does not mount `token-meter`, `compaction-basic`, `fs-sandbox`, or `fs-observation-policy`. Persistent Bash still consumes the deployment's danger-full-access sandbox policy; the editor is not confined by that policy.

`DSH_SYSTEM_PROMPT` selects the standalone persona. `DSH_MODEL` names the DeepSeek provider catalog entry, and `DSH_CONTEXT_WINDOW` supplies that entry's capacity. Because the SDK client owns the JSON-RPC `initialize` request, [`minimal.py`](../../../../examples/jsonrpc-agent/minimal.py) also uses `DSH_MODEL` as its default `model` argument; an explicit `--model` remains authoritative. Endpoint and credential variables stay owned by the DeepSeek adapter's existing environment-resolution path.

## Verification

The Web replay boots the complete Web host, creates the agent through the preset service, and asserts that the scoped filesystem is bare, no scoped compaction service exists, no system-prompt-owned runtime-context message was appended, and the assembled request contains exactly the fixed prompt and two tools. It then executes persistent Bash and the editor against the real scoped services.

The SDK replay boots the real JSON-RPC agent process through the SDK client, injects an environment-selected prompt, asserts the assembled prompt, exact two-tool catalog, and absence of every system-prompt-owned runtime-context message, and executes both tools. Python SDK bundled-runtime coverage initializes the standalone configuration through each available packaged carrier with environment-selected model, model capacity, and prompt values. Cordis validation checks that both configurations resolve their declared plugins and configuration fields.

## Alternatives considered

**Keep `compaction-basic` mounted with a high threshold.** Rejected because even an inert-for-short-tests provider permits history replacement in longer sessions and leaves the minimal composition dependent on model-capacity metadata and the token meter.

**Keep `fs-sandbox` in danger-full-access mode.** Rejected because the sandboxed provider still makes confinement and escalation part of the editor capability. The target runtime requires the bare local provider, whose lack of `sandboxMode` is composition truth.

**Use one Cordis leaf for Web and Python SDK startup.** Rejected because a Web preset contributes agent-scoped services to an existing multi-session host, while the Python SDK must launch a complete process containing the JSON-RPC server and its process-wide dependencies.

**Read `DSH_MODEL` only inside Cordis.** Rejected because Cordis configures the provider catalog but does not own the SDK client's JSON-RPC `initialize` request. The launcher must pass the same model to the client request for the environment value to select the routed model.

## Consequences

Minimal sessions never summarize or replace earlier history and never add a runtime-context snapshot; callers must keep turns within the selected model's context capacity and must not rely on model-visible narration of standing sandbox or approval policy. The editor can address any absolute path visible to the runtime process, independently of the persistent shell's sandbox policy. The two launch paths share their model-facing tool, no-context, and no-compaction guarantees while retaining different prompt and model configuration appropriate to their owners. The Python SDK path continues to communicate only through the bundled stdio JSON-RPC runtime.
