# @deepseek-ai/dsh-tool-jobs

English | [中文](README.zh.md)

The model-facing controller for `ctx.jobs`: three kind-independent tools, completion notices, and one background-work prompt section. Loading the plugin attaches the controller required by `ctx.jobs.start()`.

## Tools

- `job_output(job_id, wait?, timeout_ms?)` reads without blocking by default. Stream jobs return only the next delta; final-output jobs return their result after settlement. Every response ends with `[status: ...]`. `wait: true` waits up to the configured cap and leaves a still-running job alive on timeout.
- `job_list()` returns caller-visible jobs as `<id> [<kind>] <status> — <label>`.
- `job_kill(job_id, reason?)` requests cancellation immediately and forwards the logged reason. Terminal jobs return a non-consuming snapshot.

All three use generic UI cards: `read` for output and list, `execute` for kill.

Their canonical values are `{ text, job }`, `PublicJobSnapshot[]`, and `{ outcome: 'cancellation-requested' | 'already-finished', job }`. A public snapshot carries id, kind, label, status/detail, and start/finish times; it deliberately omits `ownerSession` and the internal `reported` notice bit. Native renderers preserve the status and acknowledgement text above.

When a producer supplies `outputLimitBytes`, `job_output`, terminal `job_kill`, and completion notices cap the complete Native UTF-8 result after adding status or notice text. Reads retain the output tail and control suffix when they fit; a bounded completion notice instead reserves `background job <id>` and the `job_output` collection instruction before spending remaining bytes on its variable kind, label, status, detail, and truncation marker. A prepended pre-execute listener captures the caller-visible job before policy, and each job-control definition's final-content callback applies its producer cap to single-text denials, short-circuits, normalized tool or pipeline failures, replacements, and blocks; structured multi-block policy results retain their shape. An existing producer truncation marker is reused rather than duplicated. Producers that omit the field retain the existing unbounded controller behavior.

## Completion notices

An unreported completion delivers `background job <id> (<kind>: <label>) finished [status: ...]. Read its output with job_output.` to the exact owner. When bounded, the stable id prefix and collection command outrank variable label/detail so the notice remains actionable at PTY's supported 64-byte minimum. A kill or terminal read/wait marks delivery reported and suppresses the redundant notice, as does the teardown cancel that drains an owner or the service.

Which lane carries it depends on what the owner is doing. A busy owner is injected: the notice joins the next-step inbox, and the turn cannot close while that inbox holds it, so several jobs settling together cost one step rather than one turn each. An idle owner is instead woken with a follow-up turn, because a pending notice nothing claims is a completion the model never learns about. `completionDelivery: quiet` keeps the injection lane for idle owners too, which is what a deterministic transcript needs.

Waking is bounded. Each owner may open `maxConsecutiveWakes` turns this way before further notices degrade to injection, and claiming any user-authored message restores the budget. The bound exists because the chain is self-exciting: a woken turn may start the background job whose completion wakes it again. Notices this plugin queued never refill the budget they spent.

One host registry may carry several mounts of this plugin — one per agent preset. The registry routes each settlement to the listeners the owner's scope chain reaches, so a mount under one preset never sees another preset's agents and an agent reads exactly one notice per completion however many presets are mounted. The same routing decides which agents this mount's controller serves: an agent whose composition loads no `tool-jobs` cannot start background work at all.

## Config

| key | default | meaning |
|---|---|---|
| `waitTimeoutMs` | `30000` | wait used when `wait: true` omits `timeout_ms` |
| `maxWaitTimeoutMs` | `600000` | cap for model-supplied waits |
| `completionDelivery` | `wakeup` | `wakeup` opens a turn on an idle owner; `quiet` leaves the notice pending |
| `maxConsecutiveWakes` | `3` | turns one owner may open by wake before notices degrade to injection |

A default above the cap fails at load.

## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains this guidance. Agent-scoped tool filtering may hide the tools without removing the independently registered prompt section.

##### Background-job guidance

```markdown
Track every background job id you start. You are notified in-session when a job finishes — do not busy-poll or sleep on one; keep working on independent steps and do not duplicate a running job's work. Before giving a final answer, collect every still-relevant job with job_output (set wait: true only when you are genuinely blocked on it), and job_kill jobs that stopped mattering.
```

#### Token effect

Small fixed input cost per request while active.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged. Activation or disposal may invalidate reuse from this prompt section.

### Tool schemas

#### What the model sees

The generated [`job_output`, `job_list`, and `job_kill` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-jobs) while this tool set is visible.

#### Token effect

Fixed schema cost on each request where the tools are visible.

#### KV Cache effect

Prefix-stable while tool definitions and visibility are unchanged. Registration lifecycle or scoped restrictions may invalidate reuse from the first changed schema token.

### Results and notices

#### What the model sees

Reads return output or `(no new output)` followed by `[status: <status>]` and optional detail. An empty list returns `(no background jobs)`. Kill returns `requested cancellation of job <id>` or the existing terminal status. Unreported owned completion uses the notice above.

#### Token effect

Results and notices remain in parent history until compaction. Stream reads do not repeat consumed output; a producer-supplied `outputLimitBytes` bounds each complete read or notice. Under `wakeup`, a notice reaching an idle owner also buys a model request the user did not ask for, capped per owner by `maxConsecutiveWakes`; a notice reaching a busy owner adds a step to the turn it is already paying for.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **A settlement inside the driver's retirement window still strands its notice** — between the turn loop's last inbox check and the driver committing its idle phase the owner still reads as busy, so the notice is injected and nothing wakes. Steering has the same hole; closing it belongs to `agent-loop`.
- **A spent wake budget is not restored by time** — only user-authored input refills it, so an unattended agent whose budget ran out collects its remaining notices on the next turn something else opens.
- **A notice pending on an idle owner does not survive that owner's disposal** — the disposal cancel clears the unclaimed inbox, and the log keeps the insert/cancel pair as the record.
- **Stream reads are single-consumer** — independent observers need another runtime API.
- **Unowned jobs have no session fence** — external callers must supply policy or avoid them.
