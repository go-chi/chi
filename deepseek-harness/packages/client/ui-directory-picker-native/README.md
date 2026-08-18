# @deepseek-ai/dsh-client-ui-directory-picker-native

English | [中文](README.zh.md)

Native directory-picker surface: the browser half of the native picking interaction. It fills ui-workspace's two directory-flow holes (`conversation.hero.workspace.directoryFlow` and `sidebar.workspaces.directoryFlow`) with a renderless occupant that answers each `open` request by driving the local Host's OS chooser through `ctx.workspaces.pickDirectory()`, then reports exactly one outcome — a picked path, a cancellation, or a failure — back through the owner conversation. The OS dialog itself belongs to [`dsh-host-directory-picker-native`](../../host/directory-picker-native/README.md); mounting this package composes the surface with that backend from one cordis.yml row, so no client code branches on a capability kind.

Both registrations install as one transactional effect through nested `slots.inject()` calls, because either declaring entry may activate later or replace its declaration. The occupant arms once per rising `open` edge, so re-renders — including an adoption that keeps `open` true while `busy` — never launch a second chooser, and the owner withdrawing `open` re-arms the next request. Settlements ride a ref so the answer reaches the owner's latest handlers rather than the ones captured when the chooser opened. An unmount (HMR replacing the occupant) discards the settlement wholesale: the wire carries no per-request abort, so the host-side chooser survives until answered, its answer lands nowhere, and the replacement instance re-arms under the owner's still-open request.

The node half is an empty `apply`: it exists so the plugin appears in the host cordis.yml and Loader, while the browser half ships through `exports["./client"]` and is discovered through the `dsh.client` manifest declaration.

## Model Experience

None, as the directory chooser is browser chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No cancellation of an open chooser** — the wire has no per-request abort, so a chooser already on the host display cannot be closed from the browser; a discarded settlement is simply ignored.
- **Local Host carriers only** — an OS dialog opens on the machine running the Host, so in-process and remote-browser deployments need the `-browse` composition instead. Platform failures surface through the owner's retryable folder dialog.
