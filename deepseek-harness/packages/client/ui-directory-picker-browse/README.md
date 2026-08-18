# @deepseek-ai/dsh-client-ui-directory-picker-browse

English | [中文](README.zh.md)

In-app directory browsing surface: the browser half of the browse picking interaction. It fills ui-workspace's two directory-flow holes (`conversation.hero.workspace.directoryFlow` and `sidebar.workspaces.directoryFlow`) with the Select Workspace Directory dialog, driving the local Host's `host.listDirectory` and `host.createDirectory` primitives through `ctx.workspaces`. Its node counterpart is [`dsh-host-directory-picker-browse`](../../host/directory-picker-browse/README.md); mounting this package composes the surface with that backend from one cordis.yml row, so no client code branches on a capability kind. Unlike the [`-native`](../ui-directory-picker-native/README.md) surface, the dialog needs no local operating-system chooser, so it also serves in-process and remote-browser deployments.

The dialog is a 680×500 Miller-column view (clamped on short or narrow viewports): a header carrying the title, the selection-path breadcrumb, and a click-to-edit path zone, then one full-width level until a row is selected, after which the row splits evenly into level and children columns. Navigations land selection-anchored and quiet — the previous view keeps rendering while a crumb jump or a submitted path is scanned, and target and parent legs land as one frame — so stepping back keeps two panes away from the display root and no intermediate frame flashes. **New folder** opens a nested create dialog targeting the selected folder and selects what it creates; **Open** adopts the selected folder, falling back to the listed level. Host-flagged hidden entries stay hidden until the footer toggle reveals them, which is a client-side filter only.

Confirming a directory is the picked path and dismissing the dialog is the cancellation. Browse failures — an unreadable target, a create conflict — stay inside the dialog's own alert surfaces, so this occupant never drives the owner's `onError` arm; the owner keeps the workspace-creation error surface. Both registrations install through nested `slots.inject()` calls because either declaring entry may activate later or replace its declaration, and the dialog's copy is registered in this package's own locale namespace: the two dictionaries land as a unit, so a failed activation cannot squat one locale of the namespace.

The node half is an empty `apply`: it exists so the plugin appears in the host cordis.yml and Loader, while the browser half ships through `exports["./client"]` and is discovered through the `dsh.client` manifest declaration.

## Model Experience

None, as the directory browser is browser chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No search, no multi-select, and no rename or delete** — the dialog lists and creates directories; a target is reached by navigating, editing the path, or filtering the last pane by prefix.
- **Hidden-entry filtering is client-side** — the Host always lists hidden entries and flags them, so the toggle changes only what the dialog renders.
