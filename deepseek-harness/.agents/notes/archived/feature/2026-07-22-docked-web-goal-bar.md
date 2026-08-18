# Agent Note: Docked web goal bar

Status: implemented
Archived: 2026-08-07

English | [中文](2026-07-22-docked-web-goal-bar.zh.md)

## Problem

The web UI had no goal surface at all: the goal stack shipped with model tools, the TUI/ACP adapters, and the `/goal` command, but the browser client exposed none of it — no runtime verbs, no indicator. This change introduces the client goal verbs (runtime session methods over RPC) and the first goal UI together. Placement follows the redesign's premise that goal presence belongs to the composer's context: the goal is a property of the work the user is about to prompt, so its indicator belongs in the composer-context stack; the [composer context stack decision](../bug-fix/2026-07-30-composer-context-stack-order.md) owns its position among Goal, Todo, Queue, and the composer. The mock keeps only a sparkle, a phase word ("Ongoing/Paused/Blocked Goal"), the truncated objective, and edit/clear icon actions, with resume appearing only on a paused goal.

## Decision

`GoalBar` (`packages/client/ui-goal/src/client/GoalBar.tsx`) is a props-driven, self-contained component registered second in the composer's input-dock list, after Todo and before Queue. Its standalone 752px card follows the composer's horizontal geometry, and every visible state shares one fixed 36px height so switching phases never resizes it. Loading (`goal === undefined`), absent (`goal === null`), and `phase === 'complete'` render nothing — a completed goal is history, not chrome.

Visibility drives the label and actions: active shows "Ongoing Goal" with pause/edit/clear; paused shows "Paused Goal" and swaps pause for a resume icon button; blocked shows "Blocked Goal" and carries `blockedReason.message` as the strip's `title` tooltip. Goal creation lives on the `/goal` command, not in the bar. The pencil swaps the strip for an inline edit form prefilled with the current objective: Enter or the check button saves through `GoalBarActions.onEdit(objective)`, Esc cancels, and an all-whitespace objective keeps save disabled. The form closes only when the edit succeeds; a failure preserves the draft and displays the error in the bar. Resume and clear failures are displayed there as well. Clear otherwise calls `onClear` directly with no confirmation — a clear keeps a durable tombstone, so nothing is unrecoverable. Every mutation first acquires a synchronous component-local single-flight latch because React's pending-state render cannot close the same-frame click window. A successful clear also suppresses that exact goal id immediately while the authoritative null projection catches up, so an acknowledged tombstone cannot leave a stale clear control that submits `GOAL_NOT_FOUND`; a failure releases the latch and remains retryable. An effect keyed on the goal's id resets this transient state and drops the edit form when the goal's identity changes, so neither a cleared marker nor a surviving draft can affect the replacement goal.

`GoalBarActions` lives in ui-goal's slot contract (`packages/client/ui-goal/src/client/slots.ts`) and carries exactly the rendered verbs: `onEdit`/`onPause`/`onResume`/`onClear`. Each callback asynchronously returns an explicit success/failure result so `GoalBar` owns its transitions and error display. `apply.ts` wires them to the runtime session methods; the runtime session resolves the current goal's compare-and-set ref internally, so the UI passes no ref.

The runtime session gains the goal surface the strip (and future UI) needs through the host-computed `goal` projection. The history tail seeds its whole current value, and `session/projection` frames update it when durable `agent/inbox/spliced` insertions commit goal snapshots or clear tombstones; later context admission is irrelevant to UI freshness. The four rendered mutation verbs fold transport failures into `{ ok: false }` results like every sibling session method.

The strip's background is `--dsw-alias-interactive-bg-hover` rather than the mock's literal `#F5F6F7`: the translucent hover gray resolves to that value over the white light-theme base and lifts the strip off the composer card in dark mode, where a static light token would sink. All colors are `--dsw-*` tokens.

## Testing

`packages/client/ui-goal/tests/goalbar.spec.tsx` pins the behavior through props alone: loading/absent/complete render nothing, the active strip renders label/objective and fires clear, rapid same-frame clear clicks dispatch once and a successful clear hides before projection convergence, the edit form prefills, rejects empty, saves on Enter, cancels on Esc, and resets when the goal's identity changes, the active strip fires pause, the paused strip fires resume, and the blocked strip exposes the reason tooltip. Component failure-path cases prove that a failed edit preserves its draft and that edit/resume/clear errors remain visible and retryable in the bar. The skeleton specs mount `ConversationRoot` with and without `goalActions`; the undefined case is seeded with an active goal, so the missing gate — not the missing goal — is what hides the strip. Runtime session specs pin folded-error results and projection updates. A keyless real-browser smoke boots the assembled application through `boot → RPC → runtime → GoalBar` and records an inline snapshot of the rendered label, objective, and actions.

## Alternatives considered

- **Put the strip in the session header** — rejected because the redesign's premise is that goal presence belongs to the composer's context; a header strip separates it from Todo, Queue, and the prompt it qualifies.
- **Render a "Loading goal…" placeholder for `undefined`** — rejected: the strip would flash and collapse on every session open, chrome noise for a sub-second state.
- **Include an inline create affordance when no goal is set** — rejected after implementation review: goal creation lives on the `/goal` command, matching the pattern where the model creates goals on request; the bar is a status indicator, not a creation surface.
- **Carry the full verb set (`onComplete` included) in `GoalBarActions`** — rejected as speculative generality: the interface carries only the rendered verbs (`onPause` joined it when the active strip gained its pause action).

## Consequences

- Goal presence in the web UI is a standalone composer-context strip: sparkle, phase label, truncated objective, and pause/edit/clear (resume replacing pause when paused) — the browser client's first goal surface.
- Goal mutations are single-flight within the component; a successful clear hides its exact goal immediately while projection delivery converges, preventing duplicate CAS errors without making transient UI state authoritative.
- The runtime session exposes the goal verbs over RPC with folded transport errors and consumes the host's durable whole-goal projection on open and live updates.
- Objective editing is reachable from the UI for the first time, through `goal.edit` with the runtime-owned ref; complete remains available to other surfaces (`/goal`, model tools).
- `goal === null` renders nothing; the composer carries no persistent create affordance — creation is the `/goal` command's job.
