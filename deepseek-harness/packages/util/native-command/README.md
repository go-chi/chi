# dsh-native-command

English | [中文](README.zh.md)

A **zero-dependency no-shell `execFile` runner** shared by host-native OS integrations: one `runNativeCommand(command, args, signal)` call spawns the executable directly (never a shell string), captures utf8 stdout/stderr, propagates the caller's abort into child termination, and hides the transient console window on Windows. Failures reject with the exit `code` and both captured streams attached, so callers classify (missing tool, cancelled, real failure) without re-running anything.

Its two consumers are the host-side native integrations: the [`directory-picker-native`](../../host/directory-picker-native/README.md) backend's OS chooser commands and the gateway's open-with-default-application hand-off ([`dsh-host-apiproxy`](../../host/apiproxy/README.md) `host.openPath`). The `NativeCommandRunner` type is their injectable command boundary.

It is a **library, not a service or plugin**: no `ctx`, registers nothing, holds no state, emits no events.

## Surface

```ts
import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
```

## Model Experience

None, as this is host-side subprocess plumbing; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No output bounding** — both streams buffer unbounded in memory; every current caller invokes small native tools whose output is a path or an error line. Adopt `dsh-output-retention` bounding before pointing this at commands with meaningful output volume.
