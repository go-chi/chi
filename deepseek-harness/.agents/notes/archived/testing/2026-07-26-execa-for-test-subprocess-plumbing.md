# Agent Note: Adopt execa for hand-rolled test subprocess plumbing

Status: implemented
Archived: 2026-08-07

English | [中文](2026-07-26-execa-for-test-subprocess-plumbing.zh.md)

## Problem

Roughly ten e2e/smoke files re-derived the same spawn-collect-timeout choreography by hand: `let stdout = ''` accumulation with `setEncoding` and `data` handlers, a `setTimeout` → `kill('SIGKILL')` deadline, and `once('exit')`/`once('error')` settlement, each with small variations. The sites: the inner spawn block of `runLoaderSmoke` (`packages/support/loader-smoke/src/index.ts`), `runBuiltBin` in `apps/cli/tests/built-bin.e2e.ts` and `packages/examples/cli-demo/tests/built-bin.e2e.ts`, `runBinExpectingExit` in `packages/examples/acp-demo/tests/built-bin.e2e.ts`, the built-lib e2e helpers in `lsp-local` and `code-runtime-worker`, the outer collector of `examples/tui-agent/tests/pty-harness.ts`, `examples/jsonrpc-agent/tests/keyless-smoke.e2e.ts`, and partially `apps/web/tests/smoke-real.e2e.ts` and `session-checkpoint-policy/tests/crash-recovery.e2e.ts`.

Two related test-infra hand-rolls compounded the case:

- `packages/support/llm-mock-server/src/cli.ts` hand-tokenized 17 value-taking `--flag value` options plus boolean flags (~45–60 lines of loop and value-extraction helpers) where the `node:util` `parseArgs` builtin is already the repo idiom (`cli-demo`, `acp-demo`, `verify-runtime-closure.ts`, `packages/sdk/scripts`).
- `apps/web/tests/smoke-real.e2e.ts` and `apps/web/tests/scaffold.ts` carried two verbatim copies of a regex `.env` parser (~20 lines) where the `process.loadEnvFile` builtin has exactly the required no-override semantics — and the vitest e2e/snapshot/web configs already load root `.env` with it before these files run, making the copies dead.
- The snapshot harness hand-rolled three poll-until-deadline loops (`waitForPersistedTurnStart`/`waitForPersistedTurnEnd`/`waitForWorkspaceFile` in `packages/support/acp-snapshot/src/harness.ts`, ~55 lines) plus `waitForFile` in `crash-recovery.e2e.ts`, where `vi.waitFor`/`expect.poll` cover the shape — vitest is already a runtime dependency of `dsh-acp-snapshot`, so this adds nothing.

## Decision

- `execa` is a root devDependency and a runtime dependency of `@deepseek-ai/dsh-loader-smoke` (the one `src/` consumer). The listed spawn-collect-timeout sites run through `await execa(cmd, args, { cwd, env, timeout, killSignal: 'SIGKILL', reject: false })`, whose result reports `{ stdout, stderr, exitCode, signal, timedOut, failed }` as independent fields — matching the repo's own defensive-patterns rule to report orthogonal subprocess outcomes independently. `runLoaderSmoke` passes `input: ''` for its stdin-close contract, and sites whose assertions pin exact stream bytes pass `stripFinalNewline: false`.
- The genuinely custom parts stay custom on top of an execa-owned subprocess: cli-demo's interrupt-on-marker mid-stream logic, jsonrpc's line-predicate protocol driving, and crash-recovery's SIGKILL-at-failpoint choreography. `smoke-real.e2e.ts` keeps raw `spawn` for its three long-lived interactive servers — ready-line watching across both streams plus a staged SIGTERM→await→SIGKILL teardown are the whole site, so execa would delete nothing there; its share of this note is the dead `.env` parser.
- `llm-mock-server`'s CLI tokenizes via `parseArgs` (strict, no positionals); numeric coercion, bounds, and cross-option constraints stay manual, and the pinned error-message tests carry `parseArgs`'s own tokenizer texts.
- Both `loadRootEnv` copies are deleted outright: the owning vitest configs (`vitest.web.config.ts` unconditionally, `vitest.snapshot.config.ts` in record mode) load the repo-root `.env` before those files run.
- The four poll loops ride `vi.waitFor` with explicit `{ interval, timeout }` and descriptive errors thrown from the callback; `waitForPersistedTurnStart` captures its malformed-record validation error out of the retry loop so it fails the run immediately instead of being retried until the deadline.

## Alternatives considered

- **`tinyexec` instead of execa.** Already in `node_modules` transitively via vitest, smaller API — but no kill-escalation, no rich error output embedding, and being transitive is not a contract; if the lighter package is preferred the swap shape is identical.
- **A repo-local shared spawn helper (no new dep).** Viable and cheaper on supply chain, but it keeps the maintenance of deadline/kill/settlement logic in-repo when a battle-tested package owns exactly this; contrary to the [dependency policy](../process/2026-07-26-dependencies-over-hand-rolling.md), it also has to re-earn cross-platform timeout, termination, and result-normalization behavior that execa already carries.
- **`get-port`, `wait-on`, `tempy`, `tree-kill`.** Rejected individually: the repo's single port probe is break-even, the file waits are dominated by `vi.waitFor`, temp-dir handling already uses `mkdtemp` + `rm {recursive}` builtins everywhere, and acp-snapshot's `close()` is drain-ordering logic, not tree traversal.

## Consequences

- The hand-rolled collect/timeout blocks are gone, including the two `/* v8 ignore */` un-inducible OS-error branches in `loader-smoke`: spawn and stream failures settle through execa's result fields, so the `src/` file carries no coverage exemptions and the per-file gate covers every remaining branch.
- Captured output is bounded by execa's default 100 MB `maxBuffer` (overflow terminates the subprocess) where it was previously unbounded; the `loader-smoke` README's limitation entry reflects this.
- Direct-child timeout termination and exit/signal result normalization are owned by execa across platforms instead of per-site hand-rolls; process-tree termination remains outside these helpers, as the `loader-smoke` README states. Each rewritten suite was re-run on POSIX in this change, and the Windows CI lanes own the other platform.
- execa is a new root devDependency (previously absent from the lockfile); it is one of the most-depended-on packages on npm and actively maintained, and the exe/runtime closure is unaffected (tests only).
- The mock-server CLI's tokenizer-level error texts are no longer this repo's to choose: unknown options, missing values, and stray positionals report `parseArgs`'s wording, pinned as such in `tests/cli.spec.ts`.
