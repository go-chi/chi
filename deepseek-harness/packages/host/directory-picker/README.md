# @deepseek-ai/dsh-host-directory-picker

English | [中文](README.zh.md)

The web GUI host's workspace-directory picker is a capability seam. The abstract `DirectoryPicker` service (`ctx.directoryPicker`) is its Service Definition. Its only method, `capability()`, returns a discriminated union describing how an operator selects a directory. Backends differ in user interaction, not just implementation: `{ kind: 'native', pick(signal) }` opens one native OS chooser on the host display ([`-native`](../directory-picker-native/README.md)); `{ kind: 'browse', list(path?), createDirectory(path, name) }` provides listing and creation operations for an in-app browser, which works for remote clients that cannot reach an OS chooser ([`-browse`](../directory-picker-browse/README.md)). Consumers switch on `capability().kind`; the union derives from the merge-extensible `DirectoryPickerCapabilities` map, and a new backend adds its variant there through declaration merging. For an unknown kind, consumers hide directory picking rather than fail. The capability object must be stable for the service lifetime. Each backend package also has a browser entrypoint that registers the matching interaction in ui-workspace's directory-flow slots, so one composition row selects both the host capability and the client flow. A composition that should choose at runtime mounts [`-auto`](../directory-picker-auto/README.md), which inspects the host once at boot and mounts the matching backend row.

Browse primitives fail with the typed `DirectoryPickerError` (`directory-unreadable` / `directory-exists` / `directory-create-failed`, each carrying the subject `path`), which the consuming gateway maps 1:1 onto wire error codes. `DirectoryEntry` rows carry a host-owned `hidden` flag (POSIX dot convention) so display policy stays client-side; `DirectoryListing.crumbs` is the ancestor chain from the filesystem root, every crumb a jump target. Design rationale, the `ctx.fs` separation, and the policy decisions live in [the directory-picker capability seam Agent Note](../../../.agents/notes/implemented/architecture/2026-07-28-directory-picker-capability-seam.md).

## Model Experience

None, as the seam serves the GUI host's directory selection; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No multi-root support** — the browse contract exposes one ancestry chain per listing; per-deployment root scoping (and Windows drive-root enumeration above a drive) waits for a consumer that needs it, per the DirectoryPicker Agent Note.
