# Cordis tutorial

English | [中文](index.zh.md)

Cordis is the plugin framework underneath DeepSeek Harness: a small runtime where every capability — tools, LLM adapters, file access, the agent loop itself — is a plugin mounted into a shared context. This tutorial teaches Cordis hands-on: each chapter is a runnable example you build in a scratch directory inside this repository, ending with a plugin wired into real harness services.

The audience is agent developers. You do not need deep TypeScript experience; the [TypeScript notes](#typescript-notes) below explain the syntax that may be unfamiliar, and every chapter shows the exact commands and expected output.

If you want the condensed concept reference instead of a walkthrough, read the [Cordis primer](../cordis-primer.md). The exhaustive API reference lives in the generated `cordis-surface` regions on the [subsystem pages](../subsystems/core.md) and the [Cordis core API](../cordis-api/context.md) pages.

To write plugins for the harness itself — loaded from a `cordis.yml` and driven from the Web UI rather than the launcher below — start from [your first Harness plugin](../user/develop/basic/index.md).

## Setup

You need a clone of this repository with dependencies installed; the [development guide](../development.md#setup-tutorial) lists the prerequisites. No API key is needed for this tutorial; every example runs keylessly.

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
```

Create the scratch directory the chapters work in. `tmp/` is gitignored, so nothing you write there touches version control:

```sh
mkdir -p tmp/cordis-tutorial
cd tmp/cordis-tutorial
```

Every chapter runs the same command from this directory:

```sh
node --import tsx ../../vendor/cordis/bin.js
```

That one-file launcher (see [vendor/cordis/bin.js](../../vendor/cordis/bin.js)) creates a root `Context`, mounts the Loader plugin, and tells it to load `./cordis.yml` from the current directory. Everything else — which plugins exist, how they are configured — comes from that YAML file, which you will write in a moment. The `--import tsx` flag lets Node run the TypeScript files the config points at without a build step.

## Chapters

1. [Your first plugin](01-first-plugin.md) — a plugin is a function; the loader mounts it.
2. [Lifecycle and effects](02-lifecycle-and-effects.md) — Cordis-managed registrations are undone when their plugin unloads.
3. [Services](03-services.md) — expose a capability on `ctx` and depend on it with `inject`.
4. [Events](04-events.md) — typed events, broadcast dispatch, and the waterfall short-circuit.
5. [Configuration](05-config.md) — validated config from `cordis.yml`, failing loud on bad input.
6. [Composition and HMR](06-composition-and-hmr.md) — the config file as a plugin tree, hot reload, and diagnosing a plugin that never loads.
7. [Into the harness](07-into-the-harness.md) — register a model-callable tool against real harness services.

<a id="typescript-notes"></a>

## TypeScript notes

The examples use three TypeScript features beyond ordinary modern JavaScript:

- **Type annotations** describe values without changing runtime behavior: `ctx: Context` says that `ctx` has the Cordis context API, `who: string` accepts text, and `string[]` means an array of strings.
- **`import type { Context } from '@deepseek-ai/cordis'`** imports only type information. It vanishes at runtime, so a plugin file that needs `Context` solely for annotations adds no runtime dependency.
- **Declaration merging** (`declare module '@deepseek-ai/cordis' { ... }`) adds your entries to interfaces that Cordis already declares — for example the type of a new `ctx.greeter` property or event name. It generates no runtime wiring; the plugin separately provides the service or emits the event. Chapter 3 shows the pattern in full.

Chapter 5 also uses an `interface` to describe a configuration object's fields and a generic type such as `Schema<Config>` to say which object fields a schema validates. You can copy those declarations as shown; the surrounding text explains what each one connects.

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
