import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { expect, it } from 'vitest'
import { defineAcpSnapshotSuite, type Scenario, type SnapshotSuiteOptions } from '@deepseek-ai/dsh-acp-snapshot'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import { decodeStorageRecord } from '@deepseek-ai/dsh-session'

/**
 * The acp-agent example's snapshot suite: the scenario table for
 * `dsh-acp-snapshot`'s suite factory, which owns every compare/guard mechanic
 * (expected-output + re-persisted-log diffs, record/refresh write-back, the pinned-header
 * uniformity guard, the fixture guards). Fixtures live under `snapshots/<name>/`;
 * `pnpm run test:snapshot:record` re-records model transcripts against the real
 * API; `pnpm run test:snapshot:refresh` rewrites current replay expected outputs keyless.
 * See the package README (packages/test-support/acp-snapshot) and the snapshot Agent Note,
 * .agents/notes/implemented/testing/2026-06-19-acp-snapshot-tests.md.
 */

// The dsh-acp-demo bin (the demo:acp entry), this example's cordis.yml, and
// the repo-root tsconfig (four levels up from examples/acp-agent/tests) — all
// ABSOLUTE: the subprocess cwd is a temp dir outside the repo.
const AGENT = {
  binScript: fileURLToPath(new URL('../../../packages/examples/acp-demo/src/bin.ts', import.meta.url)),
  configPath: fileURLToPath(new URL('../cordis.yml', import.meta.url)),
  tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
}

// The Code Mode overlay configs (include-patched variants of cordis.yml; the
// replay swap resolves each one's sibling `*cordis.snapshot.yml`).
const CODE_MODE_CONFIG = fileURLToPath(new URL('../code-mode.cordis.yml', import.meta.url))
const CODE_MODE_IMAGE_CONFIG = fileURLToPath(new URL('../code-mode-image.cordis.yml', import.meta.url))
const CODE_MODE_WORKSPACE_CONTEXT_CONFIG = fileURLToPath(new URL('../code-mode-workspace-context.cordis.yml', import.meta.url))
const BOTH_MODE_CONFIG = fileURLToPath(new URL('../both-mode.cordis.yml', import.meta.url))
const WORKSPACE_CONTEXT_CONFIG = fileURLToPath(new URL('../agent-instructions.cordis.yml', import.meta.url))
const ADVANCED_CONFIG = fileURLToPath(new URL('../advanced.cordis.yml', import.meta.url))
const FS_CONFIG = fileURLToPath(new URL('../fs.cordis.yml', import.meta.url))
const SESSION_QUERY_CONFIG = fileURLToPath(new URL('../session-query.cordis.yml', import.meta.url))
const IMAGE_CONFIG = fileURLToPath(new URL('../image.cordis.yml', import.meta.url))
const IMAGE_TEXT_ROUTE_CONFIG = fileURLToPath(new URL('../image-text-route.cordis.yml', import.meta.url))
const PTY_CONFIG = fileURLToPath(new URL('../pty.cordis.yml', import.meta.url))
const DEPTH_TWO_CONFIG = fileURLToPath(new URL('../depth-two.cordis.yml', import.meta.url))
const CHILD_QUESTION_CONFIG = fileURLToPath(new URL('../child-question.cordis.yml', import.meta.url))
const SESSION_SANDBOX_ROOT_CONFIG = fileURLToPath(new URL('../session-sandbox-root.cordis.yml', import.meta.url))
const RETRY_CONFIG = fileURLToPath(new URL('../retry.cordis.yml', import.meta.url))
const SESSION_TITLE_CONFIG = fileURLToPath(new URL('../session-title.cordis.yml', import.meta.url))
const SUBAGENT_REPORT_QUIET_CONFIG = fileURLToPath(
  new URL('../subagent-report-quiet.cordis.yml', import.meta.url),
)
const SUBAGENT_DURABILITY_FAILURE_CONFIG = fileURLToPath(
  new URL('../subagent-durability-failure.cordis.yml', import.meta.url),
)
const SUBAGENT_CONTINUABLE_INHERITANCE_CONFIG = fileURLToPath(
  new URL('../subagent-continuable-inheritance.cordis.yml', import.meta.url),
)
const LSP_CONFIG = fileURLToPath(new URL('./lsp.cordis.yml', import.meta.url))
const WEB_CONFIG = fileURLToPath(new URL('../web.cordis.yml', import.meta.url))
const FS_SEARCH_CONFIG = fileURLToPath(new URL('./fs-search.cordis.yml', import.meta.url))
const PARTIAL_LANDLOCK_CONFIG = fileURLToPath(new URL('../partial-landlock.cordis.yml', import.meta.url))
const PWSH_CONFIG = fileURLToPath(new URL('./pwsh.cordis.yml', import.meta.url))
const BACKGROUND_TASK_ADMISSION_CONFIG = fileURLToPath(
  new URL('../background-job-admission.cordis.yml', import.meta.url),
)
const PRODUCT_SUBAGENT_CODEX_CONFIG = fileURLToPath(new URL('../product-subagent-codex.cordis.yml', import.meta.url))
const PRODUCT_SUBAGENT_BOTH_CONFIG = fileURLToPath(new URL('../product-subagent-both.cordis.yml', import.meta.url))
const FS_DIFF_BOUND_CONFIG = fileURLToPath(new URL('./fs-diff-bound.cordis.yml', import.meta.url))
const SNAPSHOTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'snapshots')
const PACKED_CHUNKS_SOURCE = 'hook-cc-pretool-deny'

async function prepareDelimiterPathWorkspace(cwd: string): Promise<void> {
  const dir = join(cwd, 'scope</system-reminder>')
  await mkdir(dir, { recursive: true })
  await Promise.all([
    writeFile(join(dir, 'AGENTS.md'), 'Delimiter path snapshot instruction.\n'),
    writeFile(join(dir, 'task.txt'), 'delimiter path snapshot task\n'),
  ])
}

/**
 * Seed the over-cap glob fixture: eight files under `tree/` with fixed mtimes,
 * so the packaged ripgrep's `--sort=modified` order is deterministic — three
 * files under `archive/`, one each under `docs/`, `src/`, and `test/`, plus
 * two flat files (six top-level entries). Scoping the search to `tree/` keeps
 * the harness's own session artifacts out of the listing.
 */
async function prepareFsSearchWorkspace(cwd: string): Promise<void> {
  const tree = join(cwd, 'tree')
  const files: Array<[relative: string, mtime: Date]> = [
    [join('archive', 'a.ts'), new Date(2000, 0, 1, 0, 0, 0, 1)],
    [join('archive', 'b.ts'), new Date(2000, 0, 1, 0, 0, 0, 2)],
    [join('archive', 'c.ts'), new Date(2000, 0, 1, 0, 0, 0, 3)],
    [join('docs', 'guide.md'), new Date(2000, 0, 1, 0, 0, 0, 4)],
    [join('src', 'index.ts'), new Date(2000, 0, 1, 0, 0, 0, 5)],
    [join('test', 'spec.ts'), new Date(2000, 0, 1, 0, 0, 0, 6)],
    ['top.txt', new Date(2000, 0, 1, 0, 0, 0, 7)],
    ['notes.md', new Date(2000, 0, 1, 0, 0, 0, 8)],
  ]
  for (const [relative, mtime] of files) {
    const target = join(tree, relative)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, 'fixture\n')
    await utimes(target, mtime, mtime)
  }
}

// TODO(acp-snapshot-ownership): Move backend/product scenarios to headless while
// retaining ACP protocol contracts here.

function fixtureRecords(name: string): unknown[] {
  return readFileSync(join(SNAPSHOTS_DIR, name, 'session.jsonl'), 'utf8')
    .trimEnd()
    .split('\n')
    .map(line => JSON.parse(line) as unknown)
}

function snapshotModeFromEnv(value: string | undefined): SnapshotSuiteOptions['mode'] {
  switch (value) {
    case undefined:
    case '':
    case 'replay':
      return 'replay'
    case 'record':
      return 'record'
    case 'refresh':
      return 'refresh'
    default:
      throw new Error(`unknown DSH_SNAPSHOT mode: ${value}`)
  }
}

const SCENARIOS: Scenario[] = [
  { name: 'handshake', hasModelTurn: false, recorded: false },
  { name: 'reject-extra-dirs', hasModelTurn: false, recorded: false },
  // text-turn is the default header pin and owns the prompt and tool-schema
  // sidecars reused by alternate classes with identical component sequences.
  { name: 'text-turn', hasModelTurn: true, recorded: true, pinsHeader: true },
  // Product-subagent scenarios are authored schema-isolation fixtures: they
  // reuse the stable text-turn transcript so only Loader-composed headers and
  // tool sidecars vary. Model output and usage are not evidence here, so record
  // mode must not replace them with live-API output.
  {
    name: 'product-subagent-codex',
    hasModelTurn: true,
    recorded: false,
    pinsHeader: true,
    headerClass: 'product-subagent-codex',
    configPath: PRODUCT_SUBAGENT_CODEX_CONFIG,
  },
  {
    name: 'product-subagent-both',
    hasModelTurn: true,
    recorded: false,
    pinsHeader: true,
    headerClass: 'product-subagent-both',
    systemPromptSource: 'product-subagent-codex',
    configPath: PRODUCT_SUBAGENT_BOTH_CONFIG,
  },
  {
    name: 'session-title-after-turn',
    hasModelTurn: true,
    recorded: false,
    overridden: true,
    configPath: SESSION_TITLE_CONFIG,
  },
  { name: 'tool-call-turn', hasModelTurn: true, recorded: true },
  // Authored from the real PACKED_CHUNKS_SOURCE recording under the ordinary
  // app composition. The contract below pins decoded equality and all three
  // row kinds; replay additionally proves the assembled app re-packs identically.
  { name: 'packed-chunks', hasModelTurn: true, recorded: false },
  // The fs overlay only adds the spill stack (the sandboxed filesystem tools
  // live in the base tree), so these scenarios share the default header class.
  {
    name: 'parallel-tool-calls',
    hasModelTurn: true,
    recorded: false,
    configPath: FS_CONFIG,
  },
  { name: 'bash-spill', hasModelTurn: true, recorded: false, configPath: FS_CONFIG },
  {
    name: 'session-query-spill',
    hasModelTurn: true,
    recorded: false,
    overridden: true,
    pinsHeader: true,
    headerClass: 'session-query',
    configPath: SESSION_QUERY_CONFIG,
    posixOnly: true,
  },
  // Authored keyless replays through the assembled app: the replay catalog
  // declares flash image-capable (success) or text-only (refusal), and the
  // real read_image tool executes against the workspace fixture and the real
  // attachment store. Both boot the same composed header (the tool registers
  // with the attachment store, independent of route), so they share one class.
  {
    name: 'read-image',
    hasModelTurn: true,
    recorded: false,
    pinsHeader: true,
    headerClass: 'image',
    // The overlay adds no prompt section (read_image carries no guidance), so
    // the composed system prompt is byte-identical to the default class; only
    // the tool-schema sidecar is class-specific.
    systemPromptSource: 'text-turn',
    configPath: IMAGE_CONFIG,
  },
  {
    name: 'read-image-text-route',
    hasModelTurn: true,
    recorded: false,
    headerClass: 'image',
    configPath: IMAGE_TEXT_ROUTE_CONFIG,
  },
  {
    name: 'inline-image-prompt',
    hasModelTurn: true,
    recorded: false,
    headerClass: 'image',
    configPath: IMAGE_CONFIG,
  },
  {
    name: 'pty-tools',
    hasModelTurn: true,
    recorded: false,
    pinsHeader: true,
    headerClass: 'pty',
    configPath: PTY_CONFIG,
  },
  { name: 'bash-tool-turn', hasModelTurn: true, recorded: true },
  {
    name: 'background-job-admission',
    hasModelTurn: true,
    recorded: false,
    overridden: true,
    configPath: BACKGROUND_TASK_ADMISSION_CONFIG,
    posixOnly: true,
  },
  // The pwsh overlay (pwsh.cordis.yml / pwsh.cordis.snapshot.yml) swaps the
  // bundle's bash tool for the PowerShell twin, so its header class pins its
  // own prompt/tool sidecars and a recorded transcript.
  {
    name: 'pwsh-tool-turn',
    hasModelTurn: true,
    recorded: true,
    pinsHeader: true,
    headerClass: 'pwsh',
    configPath: PWSH_CONFIG,
    // The composition boots the real pwsh executor; hosts without a `pwsh`
    // binary skip the run (fixtures stay guarded). The recorded turn writes
    // PWSH_OK via [Console]::Out.Write so the fixture carries no platform
    // newline and one recording replays on every host.
    pwshOnly: true,
  },
  // Authored keyless replay through a test-only partial-Landlock provider:
  // the exact compatibility notice must stay ordinary stderr when the wrapped
  // `false` command exits 1, rather than becoming SANDBOX_UNAVAILABLE.
  {
    name: 'partial-landlock-child-failure',
    hasModelTurn: true,
    recorded: false,
    headerClass: 'sandbox',
    configPath: PARTIAL_LANDLOCK_CONFIG,
    env: { DSH_PERMISSION_MODE: 'read-only' },
    posixOnly: true,
  },
  // A valid cwd plus a missing provider executable exercises the assembled
  // foreground error and background job marker without a platform runner.
  {
    name: 'missing-sandbox-runner',
    hasModelTurn: true,
    recorded: false,
    headerClass: 'sandbox',
    configPath: PARTIAL_LANDLOCK_CONFIG,
    env: {
      DSH_PERMISSION_MODE: 'read-only',
      DSH_SNAPSHOT_MISSING_SANDBOX_RUNNER: '1',
    },
    posixOnly: true,
  },
  { name: 'todo-write', hasModelTurn: true, recorded: true },
  {
    name: 'skill-load',
    hasModelTurn: true,
    recorded: false,
    pinsHeader: true,
    headerClass: 'skill',
    systemPromptSource: 'text-turn',
    toolSchemasSource: 'text-turn',
  },
  { name: 'lsp-definition', hasModelTurn: true, recorded: false, pinsHeader: true, headerClass: 'lsp', configPath: LSP_CONFIG },
  // web_fetch markdown rendering end to end: the overlay's loopback fixture
  // server supplies deterministic HTML (entities, a GFM table, nesting), the
  // REAL local fetch provider retrieves it, and the tool result pins the
  // turndown conversion. The fetched URL (fixed port) is part of the recorded
  // transcript; replay re-executes the real fetch against the same fixture.
  { name: 'web-fetch', hasModelTurn: true, recorded: true, pinsHeader: true, headerClass: 'web', configPath: WEB_CONFIG },
  {
    name: 'workspace-edit',
    hasModelTurn: true,
    recorded: true,
  },
  // The real Loader/app/subprocess path executes the PACKAGED ripgrep binary
  // against a prepared workspace whose fixed mtimes pin the
  // `--sort=modified` order, pinning over-cap glob sampling without depending
  // on a host-installed ripgrep binary or a PATH stand-in. POSIX-only because
  // the displayed paths carry `/` separators the session-log comparison
  // cannot normalize. Recorded (not authored): the assistant turn is a real
  // model transcript; re-record with `test:snapshot:record -t fs-glob-sampling`
  // and then `migrate:packed-session-fixtures`, which canonicalizes the live
  // log's eager-drain-packed rows into the maximal-run layout replay produces.
  // The recorded fixture's `request/header` config and `request/context` are
  // normalized to the minimal fields produced during replay (the live adapter logs
  // model capabilities like maxTokens/reasoningEffort that llm-replay has no
  // data for), and its tool-result paths are canonicalized to `/` separators.
  {
    name: 'fs-glob-sampling',
    hasModelTurn: true,
    recorded: true,
    posixOnly: true,
    pinsHeader: true,
    headerClass: 'fs-search',
    configPath: FS_SEARCH_CONFIG,
    prepareWorkspace: prepareFsSearchWorkspace,
  },
  { name: 'fs-read', hasModelTurn: true, recorded: true },
  { name: 'fs-write', hasModelTurn: true, recorded: true },
  { name: 'fs-edit', hasModelTurn: true, recorded: true },
  { name: 'fs-write-overwrite', hasModelTurn: true, recorded: true },
  // An overwrite whose replacement is at/above the configured diff-basis bound:
  // the persisted result meta carries no contextual hunks and presentation
  // falls back to the whole-file diff. The overlay leaves the prompt and tool
  // sequence identical to text-turn, but the freshly recorded header carries
  // the current adapter capability fields, so the scenario pins its own class.
  {
    name: 'fs-write-overwrite-bounded',
    hasModelTurn: true,
    recorded: true,
    pinsHeader: true,
    headerClass: 'fs-diff-bound',
    systemPromptSource: 'text-turn',
    toolSchemasSource: 'text-turn',
    configPath: FS_DIFF_BOUND_CONFIG,
  },
  { name: 'fs-read-window', hasModelTurn: true, recorded: true },
  { name: 'fs-policy-reject', hasModelTurn: true, recorded: true },
  { name: 'fs-delete-recreate', hasModelTurn: true, recorded: true },
  { name: 'multi-turn', hasModelTurn: true, recorded: true },
  { name: 'error-finish', hasModelTurn: true, recorded: false, overridden: true },
  // Keyless, authored (like error-finish): a live provider cannot be coaxed
  // into a degenerate empty completion, so the fixture scripts the adapters'
  // EMPTY_RESPONSE error finish in turn 1 followed by the recovered reply
  // in retry turn 2, proving the default retry policy end to end: the durable
  // llm/retry event, no ACP output for the discarded attempt, the recovered
  // reply, and a clean completed retry turn. Its overlay only pins a deterministic
  // 1 ms zero-jitter delay, so it shares the default header class.
  { name: 'empty-response-retry', hasModelTurn: true, recorded: false, configPath: RETRY_CONFIG },
  // Keyless, authored (like error-finish): a live model cannot be coaxed into
  // a deterministic mid-tool-call output-limit truncation. Turn 1's script ends
  // at `max-tokens` with an unfinished tool call and adapter replay metadata for
  // both blocks; the durable assistant/message pins assembly dropping the tool
  // call AND pruning its per-block replay entry in the same decision, and turn 2
  // proves the session continues past the truncated step.
  { name: 'max-tokens-continue', hasModelTurn: true, recorded: false },
  // Keyless, authored (like error-finish/cancel): deterministically forcing a
  // LIVE model to repeat one call three times is not a stable recording, so
  // the fixture scripts five identical todo_write calls and pins BOTH reminder
  // tiers (gentle at 3, detailed at 5) as injected user/message in transcript and log.
  { name: 'repeat-tool-reminder', hasModelTurn: true, recorded: false },
  // Authored replay: a root AGENTS.md pins the session prefix, then a read in
  // nested/ discovers its narrower AGENTS.md as a raw, metadata-bearing
  // injected user/message. Both portable AGENTS.md fixtures are symlinks to a sibling
  // AGENTS.canonical.md, so this scenario also guards that discovery follows a
  // symlinked instruction file to its target's content. A second nested path
  // containing a literal closing tag is created at runtime: Git cannot check
  // that name out on Windows, so this delimiter-injection case is POSIX-only.
  // The fixture also shadows the baseline after the first touch finishes its
  // projection; the next entering pre-step restores it before request 2.
  // The scenario-specific config keeps home/root discovery hermetic, and the
  // resulting prefix needs its own pinned header class.
  {
    name: 'agent-instructions',
    hasModelTurn: true,
    recorded: false,
    overridden: true,
    pinsHeader: true,
    headerClass: 'agent-instructions',
    toolSchemasSource: 'text-turn',
    configPath: WORKSPACE_CONTEXT_CONFIG,
    prepareWorkspace: prepareDelimiterPathWorkspace,
    posixOnly: true,
  },
  { name: 'cancel', hasModelTurn: true, recorded: false, overridden: true },
  // Cancelling a live bash call relies on POSIX process-group termination;
  // Windows bash process-tree kill is deferred with the Bash execution domain.
  { name: 'cancel-tool-calls', hasModelTurn: true, recorded: false, overridden: true, posixOnly: true },
  { name: 'subagent-spawn-in-process', hasModelTurn: true, recorded: true },
  // Keyless authored scenario: the child ends at max-tokens with an empty
  // usage-only assistant/message after earlier text and a tool call. The
  // parent's tool result must retain that assistant output and stop reason.
  { name: 'subagent-max-tokens-partial', hasModelTurn: true, recorded: false },
  { name: 'subagent-multi', hasModelTurn: true, recorded: true },
  // Authored keyless replay: one assistant message carries two subagent calls
  // and the parent log pins call/call/result/result instead of the serial
  // interleaving. The twin delegations must stay identical: replay binds child
  // scripts and harvest order nondeterministically across concurrent children
  // (XXX(concurrent-subagents) in dsh-llm-replay).
  { name: 'subagent-parallel', hasModelTurn: true, recorded: false },
  { name: 'subagent-fork-in-process', hasModelTurn: true, recorded: true },
  { name: 'subagent-mixed', hasModelTurn: true, recorded: true },
  // Authored continuable-subagent transcript: a background delegation returns
  // only the durable subagent id, two send_message calls queue as later FIFO
  // turns on that same child (the parent is never woken with their output),
  // send_message to an unknown subagent id fails without delivering, and the
  // child's retained handle is disposed child-first at teardown despite a
  // failed final durability confirmation. That failed confirmation is also what
  // the settlement notice must report: the child's last turn claimed the third
  // message and then died on its durability checkpoint without entering a step,
  // so the notice opening the parent's second turn says the child FAILED and the
  // parent must not read the earlier answer as final. The scenario's fixture
  // fences the child behind the parent's spawn turn so that notice can only
  // arrive at an idle parent.
  {
    name: 'subagent-continuable',
    hasModelTurn: true,
    recorded: false,
    pinsChildToolSchemas: [1],
    pinsChildSystemPrompts: [1],
    configPath: SUBAGENT_DURABILITY_FAILURE_CONFIG,
  },
  // Authored policy-inheritance transcript: the root session is switched to
  // read-only at creation (the UI Access switch equivalent), and the
  // continuable background child's log carries that override as a
  // `sandbox/mode` `source: 'delegation'` event, so the child's runtime
  // context states the inherited policy instead of the deployment default.
  // The input also waits for the manager-owned settlement turn, keeping that
  // delivery from racing transcript harvest.
  {
    name: 'subagent-continuable-inheritance',
    hasModelTurn: true,
    recorded: false,
    pinsChildToolSchemas: [1],
    pinsChildSystemPrompts: [1],
    configPath: SUBAGENT_CONTINUABLE_INHERITANCE_CONFIG,
  },
  // The in-process child is published before its first follow-up fails. The
  // foreground tool retains both that run-result failure and an independent
  // published-handle disposal failure.
  {
    name: 'subagent-published-run-failure',
    env: { DSH_SUBAGENT_PUBLISHED_FAILURE: '1' },
    hasModelTurn: true,
    recorded: false,
    overridden: true,
    configPath: SUBAGENT_DURABILITY_FAILURE_CONFIG,
  },
  // Authored child-to-parent transcript: the child calls its scope-local
  // `report`, and the runtime's unconditional settlement notice then wakes the
  // parked parent into one ordinary turn that claims both. The overlay pins
  // quiet report delivery because two independent wakes have no orderable
  // transcript; the shipped waking default is covered by package tests.
  {
    name: 'subagent-report',
    hasModelTurn: true,
    recorded: false,
    overridden: false,
    configPath: SUBAGENT_REPORT_QUIET_CONFIG,
    pinsChildToolSchemas: [1],
    pinsChildSystemPrompts: [1],
  },
  // Authored durable-catalog transcript: the snapshot-only lifecycle marker
  // fences the second parent turn behind the child's Activation end, so
  // `list_agents({ scope: 'descendants' })` deterministically reads the
  // persisted child as complete, then `interrupt_agent` executes its accepted
  // no-op against that settled id. Both tools run through the assembled control
  // service; the marker is not model-visible.
  {
    name: 'subagent-list-agents',
    hasModelTurn: true,
    recorded: false,
    pinsChildToolSchemas: [1],
    pinsChildSystemPrompts: [1],
  },
  {
    name: 'subagent-depth-two-rejection',
    hasModelTurn: true,
    recorded: false,
    overridden: true,
    configPath: DEPTH_TWO_CONFIG,
  },
  // Authored keyless replay through the assembled app: a one-shot child calls
  // the real ask_user_question tool, the runtime-ownership guard rejects before
  // the tripwire provider, and the child carries the unresolved decision in its
  // final result so the parent can complete instead of waiting forever.
  {
    name: 'subagent-child-question-rejection',
    hasModelTurn: true,
    recorded: false,
    pinsHeader: true,
    headerClass: 'child-question',
    systemPromptSource: 'text-turn',
    configPath: CHILD_QUESTION_CONFIG,
  },
  // The workflow tool: the model writes a one-child orchestration script; the
  // child runs as a spawn subagent under the worker-thread engine (its session is the
  // child fixture), and the tool result carries the script's return value.
  { name: 'workflow-run', hasModelTurn: true, recorded: true },
  // Authored counterpart to the packaged Python SDK snapshot: define a host-half marker package and
  // run it, inspect this session's dynamic packages through Code Mode, run direct and workflow
  // children, then undefine it. The extra Code Mode and
  // Cordis plugins require their own request-header pin; the fixture tests deterministic composition.
  {
    name: 'advanced-toolchain',
    hasModelTurn: true,
    recorded: false,
    pinsHeader: true,
    headerClass: 'advanced',
    configPath: ADVANCED_CONFIG,
  },
  {
    name: 'cordis-inspect-jsdoc',
    hasModelTurn: true,
    recorded: false,
    headerClass: 'advanced',
    configPath: ADVANCED_CONFIG,
  },
  // Prompt-submit blocks are authored keylessly with malformed matcher fields,
  // which these matcherless events must ignore. Admission rejects before a turn
  // opens, so only the ACP stop reason is observable and no log is harvested.
  { name: 'hook-cc-promptsubmit-block', hasModelTurn: false, recorded: false },
  { name: 'hook-codex-promptsubmit-block', hasModelTurn: false, recorded: false },
  // Each invalid matcher follows a runnable prompt blocker. Reaching the replay
  // model without any hook audit rows proves config loading is atomic through
  // the real Loader/app path, rather than retaining the earlier valid group.
  { name: 'hook-cc-invalid-matcher', hasModelTurn: true, recorded: false },
  { name: 'hook-codex-invalid-matcher', hasModelTurn: true, recorded: false },
  // The mid-turn interception points fire during a real model turn, so each is recorded with its hook active
  // (the model's reaction to a deny/block/force-continue is part of the captured transcript).
  // SessionStart/SubagentStart are excluded because detached injection races log
  // order; SubagentStop writes no transcript, so an expected output could not prove it ran.
  // Unit tests cover those points; the hook-snapshot-matrix Agent Note owns the rationale.
  { name: 'hook-cc-promptsubmit-context', hasModelTurn: true, recorded: true },
  { name: 'hook-cc-pretool-deny', hasModelTurn: true, recorded: true },
  { name: 'hook-cc-pretool-ask', hasModelTurn: true, recorded: true },
  { name: 'hook-cc-posttool-block', hasModelTurn: true, recorded: true },
  { name: 'hook-cc-posttool-context', hasModelTurn: true, recorded: true },
  { name: 'hook-cc-stop-continue', hasModelTurn: true, recorded: true },
  { name: 'hook-codex-promptsubmit-context', hasModelTurn: true, recorded: true },
  { name: 'hook-codex-pretool-block', hasModelTurn: true, recorded: true },
  { name: 'hook-codex-posttool-block', hasModelTurn: true, recorded: true },
  { name: 'hook-codex-posttool-context', hasModelTurn: true, recorded: true },
  { name: 'hook-codex-stop-continue', hasModelTurn: true, recorded: true },
  // Code Mode: the registry in `mode: code` — the wire tool list collapses to [run_code], the
  // tools:sdk section rides in the prompt, and the program's tool calls land as
  // tool/code-dispatch events. Each overlay composes and pins its own header class.
  { name: 'code-mode-turn', hasModelTurn: true, recorded: true, pinsHeader: true, headerClass: 'code', configPath: CODE_MODE_CONFIG },
  {
    name: 'code-mode-read-image',
    hasModelTurn: true,
    recorded: false,
    pinsHeader: true,
    headerClass: 'code-image',
    toolSchemasSource: 'code-mode-turn',
    configPath: CODE_MODE_IMAGE_CONFIG,
    posixOnly: true,
  },
  // A nested fs dispatch inside run_code discovers workspace instructions. The
  // projection enters the inbox after the outer result and becomes model-visible
  // on the following step, retaining workspace provenance end to end.
  {
    name: 'code-mode-workspace-context',
    hasModelTurn: true,
    recorded: false,
    overridden: true,
    pinsHeader: true,
    headerClass: 'code-workspace-context',
    systemPromptSource: 'code-mode-turn',
    toolSchemasSource: 'code-mode-turn',
    configPath: CODE_MODE_WORKSPACE_CONTEXT_CONFIG,
  },
  // `both` owns its own expected prompt rather than sharing code-mode-turn's:
  // the two modes agree on every section except the run_code-only rule, which
  // `both` must NOT state because its native calls do execute.
  {
    name: 'both-mode-turn',
    hasModelTurn: true,
    recorded: true,
    pinsHeader: true,
    headerClass: 'both',
    configPath: BOTH_MODE_CONFIG,
  },
  // Machine permission scenarios use an explicit deployment policy; there is
  // no session-scoped UI picker on the automation protocol.
  {
    name: 'escalation-approved',
    hasModelTurn: true,
    recorded: true,
    pinsHeader: true,
    headerClass: 'sandbox',
    systemPromptSource: 'text-turn',
    toolSchemasSource: 'text-turn',
    env: { DSH_PERMISSION_MODE: 'workspace-write' },
  },
  {
    name: 'escalation-rejected',
    hasModelTurn: true,
    recorded: true,
    headerClass: 'sandbox',
    env: { DSH_PERMISSION_MODE: 'workspace-write' },
  },
  {
    name: 'fs-escalation-approved',
    hasModelTurn: true,
    recorded: true,
    headerClass: 'sandbox',
    env: { DSH_PERMISSION_MODE: 'workspace-write' },
  },
  // Unlike ordinary snapshots, this session cwd is outside the platform temp
  // roots that workspace-write always grants. The overlay points the
  // deployment fallback at /tmp, so a successful relative write proves the
  // assembled app replaced that process-level fallback with SessionHeader.cwd.
  {
    name: 'session-sandbox-root',
    hasModelTurn: true,
    recorded: false,
    overridden: true,
    headerClass: 'sandbox',
    configPath: SESSION_SANDBOX_ROOT_CONFIG,
    env: { DSH_PERMISSION_MODE: 'workspace-write' },
    workspaceParent: homedir(),
  },
]

// Hosts without a usable PowerShell skip the pwsh-tool-turn run (its fixtures
// stay guarded); the probe follows the executor's own resolution so a Windows
// host with only an install-location pwsh still runs the scenario.
const hasPwsh = spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], { encoding: 'utf8' }).status === 0

defineAcpSnapshotSuite({
  agent: AGENT,
  snapshotsDir: SNAPSHOTS_DIR,
  scenarios: SCENARIOS,
  mode: snapshotModeFromEnv(process.env.DSH_SNAPSHOT),
  hasPwsh,
})

it('packed ACP fixture retains every chunk row kind without changing the logical session', () => {
  const source = fixtureRecords(PACKED_CHUNKS_SOURCE)
  const packed = fixtureRecords('packed-chunks')
  const rowTypes = packed.flatMap((record) => {
    if (record === null || typeof record !== 'object') return []
    const type = (record as { type?: unknown }).type
    return type === 'text-chunks' || type === 'reasoning-chunks' || type === 'tool-call-chunks' ? [type] : []
  })

  expect([...new Set(rowTypes)].sort()).toStrictEqual(['reasoning-chunks', 'text-chunks', 'tool-call-chunks'])
  const withoutMessageId = (record: unknown): unknown => {
    const cloned = structuredClone(record) as {
      time?: unknown
      type?: unknown
      data?: {
        durationMs?: unknown
        id?: unknown
        inserted?: Array<{ id?: unknown }>
        message?: { id?: unknown }
      }
    }
    delete cloned.time
    if (cloned.type === 'agent/inbox/spliced') {
      for (const message of cloned.data?.inserted ?? []) delete message.id
    }
    if (cloned.type === 'user/message') delete cloned.data?.id
    if (cloned.type === 'assistant/message'
      || cloned.type === 'tool/result') {
      delete cloned.data?.message?.id
    }
    if (cloned.type === 'hook/result') delete cloned.data?.durationMs
    return cloned
  }
  const logicalRecords = (records: readonly unknown[]): unknown[] => [
    records[0],
    ...records.slice(1).flatMap(record => decodeStorageRecord(record)).map(withoutMessageId),
  ]
  expect(logicalRecords(packed)).toStrictEqual(logicalRecords(source))
})
