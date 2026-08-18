# Post-mortem 0004: Landlock partial-enforcement notice misclassified child failures

English | [中文](0004-landlock-partial-notice-misclassified-child-failures.zh.md)

Status: resolved

## Executive summary

On kernels with an older Landlock ABI, the launcher prints a benign partial-enforcement notice before executing every child. The harness treated that shared `landlock-run:` prefix plus any nonzero child exit as launcher failure, so ordinary outcomes such as ripgrep's exit 1 for no matches surfaced as `SANDBOX_UNAVAILABLE`; the then-bash-backed filesystem search also hid that structured error behind `SEARCH_FAILED`. Broad signature rules and missing partial-ABI composition coverage let the defect through. Runner classification now requires status-gated fatal evidence after exact informational exclusions, and an assembled keyless scenario pins the surviving bash path. Filesystem search uses packaged ripgrep through the subprocess seam and does not cross sandboxed bash.

## Summary

The native launcher contract distinguishes two kinds of stderr lines. A partially enforcing kernel prints exactly `landlock-run: partial enforcement (older Landlock ABI)` and continues into the child. A launcher failure prints another `landlock-run:` line and exits 125 without executing the child.

The harness represented both with one case-insensitive `landlock-run: ` substring. Its consumer classified any nonzero exit carrying that substring as runner failure. The child's status was therefore attached to the launcher's informational line: `false`, ripgrep's no-match exit 1, invalid-pattern exit 2, and even a child-selected exit 125 could be blamed on the sandbox despite successful confinement and execution.

At the time of the incident, filesystem search added a second attribution error. Its bash-backed `runRipgrep()` caught every rejected bash run that was not aborted and replaced it with a generic cwd/shell-start `SEARCH_FAILED`, including the structured `SandboxUnavailableError` produced by the sandbox executor.

## Impact

On partial-ABI Landlock hosts, legitimate nonzero child outcomes could appear as sandbox infrastructure failure. `glob` and `grep` were especially visible because ripgrep uses exit 1 as successful empty search. When a real sandbox failure did occur through filesystem search, callers lost its `SANDBOX_UNAVAILABLE` code and received an incorrect startup diagnosis.

The defect did not weaken confinement or run a command unconfined. Its security effect was availability and diagnostic integrity: a valid confined result was rejected or mislabeled.

## Timeline

- The native launcher contract defined exit 125 for launcher failures, a fatal `landlock-run:` line for every such failure, and the exact partial-enforcement notice for successful child execution.
- The sandbox provider reduced that contract to `runnerFailureSignatures: ['landlock-run: ']`; the bash consumer combined the prefix with any nonzero exit and reported stderr's first line.
- Unit tests covered clean success, denial diagnostics, and fatal runner prefixes. Real-runner tests self-skipped without a usable kernel and did not force partial enforcement followed by a nonzero child.
- A minimal POSIX wrapper that prints the notice and `exec`s its payload reproduced the failure with `false` and ripgrep no-match.
- Structured rules plus shared foreground/background classification and assembled replay coverage closed the surviving sandbox attribution gap. Filesystem search uses packaged ripgrep through `ctx.subprocess`; the fix leaves that path outside sandboxed bash.

## Root cause

The public sandbox result type could express only a bag of substrings. It could not state that Landlock failure requires exit 125, that evidence must occur within one fatal line, or that one exact line under the same prefix is informational. The boolean consumer consequently joined unrelated facts from different processes and selected the first stderr line for detail even when a later line was the fatal evidence.

The test matrix mirrored that representation. Fake providers emitted either no runner line or an unambiguously fatal prefix; they never emitted a benign runner line before a child-controlled nonzero exit. Real Landlock coverage depended on the host ABI, so full-ABI hosts could not exercise the notice. In the incident-era search implementation, filesystem-search tests modeled raw spawn errors but not a structured error thrown by the real sandboxed bash composition.

Stderr remains an in-band attribution channel. A confined child can deliberately reproduce a runner's gated fatal line and exit status, causing an availability/diagnostic false attribution. The tighter conjunction prevents the accidental collision in this incident but does not authenticate the writer; an out-of-band status protocol remains separate hardening, not a sandbox-bypass fix.

## Guardrails added

- [`RunnerFailureRule`](../subsystems/sandbox.md#wrapped-argv-and-classification-dialects) carries optional allowed exit codes, case-insensitive per-line fatal signatures, and case-insensitive exact informational-line exclusions.
- [`dsh-sandbox-local`](../../packages/sandbox/sandbox-local/) maps Landlock to exit 125 plus a non-notice `landlock-run:` line while bwrap, Seatbelt, and custom runners remain signature-only.
- [`dsh-bash-sandbox`](../../packages/shell/bash-sandbox/) directly spawns the provider argv, so a pre-start rejection uses the spawn-error channel instead of localized shell diagnostics. Settled foreground and background execution share one evidence-returning classifier; fatal evidence outranks denial, and foreground errors report the matched fatal line without changing captured stderr.
- [`dsh-tool-fs-search`](../../packages/fs/tool-fs-search/) uses packaged ripgrep through `ctx.subprocess` and remains outside the sandboxed bash seam.
- The native-boundary regression cases live in [`partial-landlock.spec.ts`](../../packages/shell/bash-sandbox/tests/partial-landlock.spec.ts), including informational notices, fatal evidence, and foreground/background classification.
- The assembled product path is pinned by the [`partial-landlock` snapshot composition](../../examples/acp-agent/partial-landlock.cordis.snapshot.yml), independently of filesystem-search implementation choices.

## Lessons

- Process attribution requires a conjunction of independent evidence; a shared prefix is not a protocol.
- Informational and fatal diagnostics can share a namespace, so exclusions must be exact and narrow while unknown fatal lines stay fail-closed.
- An adapter must preserve structured failures owned by the seam below it instead of replacing them with its own nearest generic category.
- Platform-dependent behavior needs a deterministic fake at the native boundary plus one assembled product path; a self-skipping real-kernel test cannot carry that regression alone.
