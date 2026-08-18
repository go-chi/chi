# `@deepseek-ai/dsh-cmdline`

English | [中文](README.zh.md)

The command line a dsh launcher hands to the app it boots. The launcher parses only its own flags (`--profile`, `--patch`, the config dumps) and hands **everything after them** to the tree verbatim, so an app owns its flag family, its `--help` text, and its parse errors instead of the launcher knowing them.

## The launcher values

A launcher calls `provideCmdline(ctx, host)` before any tree entry mounts, which provides:

- `ctx.cmdlineArgs` — the invocation's inner arguments. `get()` is the whole interface, and it returns a snapshot: `dsh --profile tui --resume abc` yields `['--resume', 'abc']`.
- `ctx.appExit` — a bounded process-exit request, wired to the launcher's shutdown controller.

An embedding host with no command line provides an empty list; that is the honest answer, not a missing value.

## Ordinary providers and injected config

Any app plugin may inject `cmdlineArgs`, parse it, and publish an ordinary app-owned service. `parseCmdline(ctx, program)` is only a commander adapter; the program's own action owns validation and the published service:

```ts ignore
export const name = 'web-startup'
export const inject = ['cmdlineArgs']

export function apply(ctx: Context): void {
  const program = webCommand()
  program.action(() => ctx.provide('webStartup', webValuesFrom(program)))
  parseCmdline(ctx, program)
}
```

Its Loader row carries no launcher marker or special kind:

```yaml
- id: web-startup
  name: '@deepseek-ai/dsh-web-app/startup'
```

Every row configured from those values uses ordinary service injection and direct lazy config access:

```yaml
- id: webserver
  name: '@deepseek-ai/dsh-host-webserver'
  inject: [webStartup]
  config:
    host: !!js ctx.webStartup.host ?? '127.0.0.1'
    port: !!js ctx.webStartup.port ?? 3080
```

`parseCmdline` refuses at load a program in which no command declares an action, routes every command's exit and output through the launcher (commander copies those settings into subcommands only at registration), and parses the immutable arguments; commander runs the invoked command's synchronous action on success. An action rejects an invalid invocation with `program.error(...)` — before publishing, since statements ahead of the rejection have already run. On `--help`, `--version`, a parse error, or that rejection, the helper writes commander's text and requests exit; the provider publishes nothing, so dependent rows never activate.

### How injection orders config

Loader defers a row's `!!js` interpolation until that row's declared injections are active, then evaluates against the row's plugin context. The example above can therefore read `ctx.webStartup` directly: Cordis has already populated that injected service before Loader asks for `webserver`'s config. Include trees preserve nested expression nodes until each target row reaches this point. Provider replacement and live patch reload repeat interpolation against the current injected services, so a launch flag cannot be silently reset.

### Shared immutable arguments

`get()` does not consume or mutate argv. Multiple plugins can parse the same snapshot and independently provide services. The launcher does not inspect the composition for a command-line owner; a profile with no reader simply ignores its app arguments.

An out-of-tree plugin brings its own commander copy, so commander's control-flow errors are detected structurally rather than by class identity; an identity check would rethrow a printed help as a fatal load failure.

## Model Experience

None, as this package resolves the process's own command line before any session exists.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Launcher flags must precede app arguments.** The split is positional: the first token the launcher does not recognize starts the inner arguments, so `--patch` placed after an app flag belongs to the app. The launcher's parser consumes one `--`, so an app argument that must survive as a literal `--` needs `-- --`.
- **An app-owned service has no statically declared provider.** Consumer rows name it through ordinary injection; a bundle that omits its provider fails at settlement with pending entries naming the service rather than at load.
- **A user patch that replaces a row's whole `config` drops its expressions.** A flag beats the value written beside it, not a literal a user wrote in place of the expression; keeping the expression is what keeps the flag winning.
