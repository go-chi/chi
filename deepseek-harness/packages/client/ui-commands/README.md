# @deepseek-ai/dsh-client-ui-commands

English | [中文](README.zh.md)

Client command API (`ctx.commandUi`): the session-keyed command-directory cache, the `/` command source with `matchSpace`/`matchEnter` decision hooks, three-kind dispatch (`execute` / `popupSelect` / `leadingInput`), and popupSelect registration for business packages. The [web command Agent Note](../../../.agents/notes/implemented/architecture/2026-07-25-web-command-surfaces-and-assembly.zh.md) records the decision.

`src/client/contract.ts` is the fixed business contract: `CommandUiContract.register(name, spec)` and `decorate(name, spec)` are everything a business package consumes; `CommandUiSpec{options, onSelect}` keeps popup data self-contained — the shell component belongs to this package and business packages never see it. A contribution is a client-owned command (a host-name collision fails loud); a decoration adds a bare-invocation popup to an EXISTING host command. The host keeps its catalog row, argument claim (space / argued Enter), and lifecycle logging, and a decorated name with no host row in the session's directory never fires. Command kinds derive per dispatch, never per registration: a host descriptor with `input` is `leadingInput`, a registered `CommandUiSpec` is `popupSelect`, and everything else is `execute`.

`CommandDirectory` (`src/client/directory.ts`) is the one wire-derived cache, keyed by session. Ordinary sessions fetch through `command.list({sessionId})`, and the source's scope-birth `warm` hook prewarms the session's entry. Catalog-addressed continuable children resolve an empty command directory locally: `command.list` is Agent-bound, so prewarming it would activate a child merely to view persisted history. Entries are soft-invalidated by the forwarded `commands/change` owner event (old snapshots serve while the repull flies) and by forwarded `agent-preset/selected` for that one session (recomposing an agent registers nothing, so the registry-wide signal never fires for it), hard-invalidated by `connection/reset`, and epoch-guarded so a superseded pull can never overwrite a newer one. `matchSpace` answers synchronously from this cache only; `matchEnter` strong-waits it on the SubmitAttempt signal and rejects on warmup failure — a `/` line is never silently downgraded to a plain prompt.

After `command.execute` returns a matched command result, this browser emits local `command/executed(sessionId, name, result)`. Other clients receive the durable command nodes through the Host event stream but never this acknowledgment, so a browser-only side effect can select successful results from the client that submitted the command without treating Session replay as an action request. Listener failures are logged and contained one by one; they cannot change the already-admitted command result or prevent later listeners from running.

Menu queries fuzzy-match ordered, case-insensitive subsequences of command names. Prefixes rank first; separator boundaries, adjacent characters, and shorter gaps rank the remaining matches, with directory and contribution order breaking ties. This affects discovery only: space and Enter still require an exact command name. Rationale: [Web slash-command fuzzy discovery](../../../.agents/notes/implemented/feature/2026-08-04-web-slash-command-fuzzy-discovery.md).

`PopupSelectController` (`src/client/popup.ts`) is the headless shell state: `PopupSelectView` self-registers into `conversation.input.overlay` (the SlotMap key is ui-conversation's; this package pulls the declaration in with a type-only import — no runtime edge). The shell is a transient layer holding focus while open; token-segment consumption after onSelect runs both branches through `consumeTokenSegment` (menu-path span CAS, enter-path bare-token equality) against the draft face the wiring layer binds via `bindDraft`.

The `/client` entrypoint exports the plugin body (`apply`/`inject`), `CommandUiRuntime`, the directory and popup classes with their state types, and the fixed contract types; the shell component itself is internal to the overlay registration.

## Model Experience

Indirectly, through the host `command.execute` RPC this package's dispatch and `claim.submit` paths trigger: a matched command's handler mutates host domain state that other packages project into the next request (the `/plan` handler flips plan mode, whose owning package injects its `plan:policy` system-prompt section), while the command line itself, the detached result, and every menu/notice rendering stay client-side and never enter the session log.

#### KV Cache effect

None directly; this package neither assembles nor sends a provider request. Command handlers it triggers may change what the owning host packages contribute to the next request's system prompt (a section appearing or disappearing replaces earlier request tokens and invalidates the provider prefix from that point), but that effect is owned and documented by each command's host package.

## Known Limitations and Deferred Work

- **Detached-result notices fall back to the console off-session** — the fire-and-forget paths route results to the triggering session's composer via `SessionInput.notify`; after session teardown the console line is the only remaining surface.
