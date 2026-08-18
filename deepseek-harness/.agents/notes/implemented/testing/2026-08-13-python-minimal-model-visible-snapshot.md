# Agent Note: Python minimal-composition model-visible snapshot

Status: implemented

English | [中文](2026-08-13-python-minimal-model-visible-snapshot.zh.md)

## Problem

The Python lane never compared what the minimal composition actually shows the model. Dynamic runtime context reaches history as a user message, so the mock model's assertion that system-role messages equal the deployment persona could not see it, and the advanced executable snapshot replaces each request header's assembled system prompt with a token and each tool schema with its name. The sandbox-policy runtime-context message therefore rode along in the checked-in [minimal composition](../../../../examples/jsonrpc-agent/minimal.cordis.yml) while `python-runtime` stayed green, and any plugin that adds a system section, a tool, or another context message could do the same.

## Decision

The `sdk-minimal` scenario in [the packaged-runtime smoke](../../../../scripts/smoke-python-runtime.py) records `scripts/snapshots/python-sdk-single-exe/minimal/model-visible.json`: for every model request of the turn, the advertised tool schemas verbatim and the message list. System and user messages keep their full text with the scenario's temporary directory tokenized; assistant and tool messages keep only call identity, because their PTY and filesystem text differs across the platforms the expected output replays on.

One model-visible message is excluded: the agent loop's dynamic runtime-context snapshot. The same composition emits it on macOS and not on Linux, which the required lane runs, so no single expected output can carry it. That difference is a defect in its own right ([#2488](https://github.com/deepseek-harness/deepseek-harness/issues/2488)) — this expected output covers every other model-visible message rather than waiting for it.

The mock model no longer asserts the minimal scenario's tools and system prompts — the snapshot owns that surface and reports a complete diff instead of the first mismatch. Snapshot comparison takes its directory and file set as arguments, so the `minimal` and `advanced` expected outputs use one implementation, and `--update-snapshots` accepts `sdk-minimal`.

## Alternatives considered

**Snapshot the minimal session log, like the advanced scenario.** The minimal turn drives a real PTY and editor, so persisted tool results carry platform-dependent text. The expected output would go red for reasons unrelated to model-visible assembly, and normalizing that text away leaves the log carrying little the model-visible file does not.

**Extend the mock model's inline assertions.** Every new model-visible contribution would need another hand-written expectation, and a failure names one mismatch rather than the whole surface. Tool descriptions would also be duplicated from the composition into the script.

**Rely on the TypeScript SDK snapshot.** Its `persistent-tools` scenario pins the same composition's system prompt, tool schemas, and runtime context, but through replayed model responses and a source or `lib` runtime, in a different required job. It cannot show what the deployed executable's closure assembles for a Python caller.

## Consequences

A change to the minimal composition's model-visible surface — a system section, a tool, a tool description, or an added user message — now fails `python-runtime` with the exact diff, and landing it means rerunning `--scenario sdk-minimal --update-snapshots` and reviewing that diff. The minimal composition's tool descriptions become reviewed expected output.

Assistant and tool message text is no longer compared, and the runtime-context snapshot is not compared at all. The scenario's own assertions continue to own persistent-shell state, editor output, and the final response; [#2488](https://github.com/deepseek-harness/deepseek-harness/issues/2488) owns the excluded message until its platform difference is resolved.

[AGENTS.md](../../../../AGENTS.md) and [the testing policy](../../../../docs/testing.md) now name both SDKs as independent projections of the agent loop, session lifecycle, and `SessionEventMap`, so a change to any of those carries updating both expected outputs rather than only the one a contributor happens to run.
