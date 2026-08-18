# Agent Note: Support the TUI on Windows

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-20-windows-tui-support.zh.md)

## Problem

The full-screen TUI delegates raw input, ANSI rendering, resize events, and terminal restoration to pi-tui's `ProcessTerminal`. That dependency contains a native Windows console path, but the repository's real-process smoke used Python's POSIX-only `pty` and `termios` modules. Skipping that smoke on Windows would leave the supported product path without coverage for startup, input, interaction, failure reporting, or restoration.

The TUI platform contract must follow the runtime shipped to users rather than the portability of one test driver. A platform exclusion is justified only when the product has an unsupported runtime dependency or a demonstrated semantic gap.

## Decision

[`@deepseek-ai/dsh-tui`](../../../../packages/ui/tui/README.md) supports interactive terminals on Windows as well as macOS and Linux. The product continues to use pi-tui's `ProcessTerminal`; on Windows it enables virtual-terminal input after raw mode and avoids the Unix-only `SIGWINCH` refresh. DeepSeek Harness adds no platform rejection or reduced Windows mode.

The real Loader smoke selects a native pseudo-terminal boundary by host. macOS and Linux retain the Python POSIX PTY driver. Windows uses `node-pty` and ConPTY. Both drivers receive the same launch command, environment, terminal dimensions, marker-gated input actions, timeout, expected exit code, and output assertions, and all three smoke scenarios run on every supported platform.

`node-pty` is a test-only dependency of the examples workspace. Its reviewed native install script is explicitly enabled in `pnpm-workspace.yaml`; production TUI packages do not acquire a new dependency or subprocess layer.

## Alternatives considered

- **Declare the TUI unsupported on Windows** — rejected because the pinned terminal runtime implements Windows console input explicitly and the harness has no POSIX-only production dependency. A documentation-only exclusion would discard an existing product path to accommodate a test harness gap.
- **Run the POSIX driver through MSYS, Cygwin, or WSL** — rejected because that would test a compatibility environment rather than the native Windows console path users run.
- **Use `node-pty` on every host** — rejected because the established POSIX driver already provides the macOS and Linux boundary; replacing it would widen the runtime change without improving those hosts. Platform-specific drivers reserve the `node-pty` runtime path for Windows while sharing one scenario contract.
- **Rely on renderer unit tests and semantic terminal snapshots** — rejected because fake terminals do not prove Loader boot, real raw input, process exit, or terminal restoration at the operating-system boundary.

## Consequences

- The Windows artifact lane executes the startup, scripted interaction, resume-failure, and restoration scenarios, and the suite has no supported-platform skip.
- The Windows process proof depends on ConPTY and a pinned `node-pty` release; changing that dependency or its allowed install script requires native-boundary review.
- The two PTY drivers can differ internally, but shared inputs and assertions keep their observable TUI contract aligned.
- Windows support remains bounded by the Node and pi-tui versions shipped by the repository; unsupported historical Windows console environments do not receive a compatibility layer.
