# Architecture

This repository owns confinement *mechanism*, not policy: consumers (agent harnesses and sandbox capabilities) decide which paths a run may read or write; this package family provides the launcher that enforces those grants and the JavaScript API that resolves and speaks to it. The packaging follows the per-platform-package model of [`node-addon-require-builtin`](https://www.npmjs.com/package/@esplus/node-addon-require-builtin) (and esbuild), adapted from Node addons to standalone static executables.

## Two-layer package family

The family is one entry package plus per-platform binary packages:

- **Entry package** (`@deepseek-ai/node-addon-landlock-run`): ESM JavaScript. Owns the tool's CLI contract — path resolution (`launcherPath`), the functional probe (`probe`), grant-argv construction (`grantArgs`), and the contract constants. Ships the C source in its tarball for auditability. Lists every platform package as an `optionalDependency`.
- **Platform packages** (`@deepseek-ai/node-addon-landlock-run-linux-{x64,arm64}`): one prebuilt static binary under `bin/`, a `prebuilds.json` declaring it, and no JavaScript at all. npm's `os`/`cpu` fields select the matching one at install time; the entry package resolves it to a file path — there is nothing to import.

Because the CLI parser and binary are versioned together in one package family, the parser cannot fall behind that binary version. Preventing that mismatch is why the package split exists.

There is no shared loader package: platform packages have nothing to load. If a second tool ever needs shared JS, extract it then, not preemptively.

## Resolution and availability

`launcherPath()` resolves `@deepseek-ai/node-addon-landlock-run-<platform>-<arch>` and returns `<package>/bin/landlock-run`. When the package is not resolvable it returns a deterministic fallback path inside the entry package's own `node_modules` that simply never exists. Existence is deliberately unchecked either way: `probe()` is the single availability signal, and a missing binary probes `unusable` exactly like an unenforcing kernel. Consumers get one degradation path, not two.

The probe is functional — the launcher builds and enforces a real maximal ruleset in a short-lived child — because version checks would miss a kernel that has the syscalls but refuses enforcement.

## Fail-closed everywhere

The launcher exits `125` without exec'ing the command on any launcher-level failure: usage error, unenforcing kernel, unopenable grant root, failed exec. Partial enforcement (an older Landlock ABI governing only a subset of accesses) is accepted, reported on stderr, and surfaced by the probe as `partial` — the consumer decides what its mode vocabulary promises at each level. Neither the binary nor the entry package reads environment variables: which binary confines a process is never decidable by the ambient environment.

## Build and release model

Builds are native-only. `scripts/build.ts` compiles the running architecture's binaries with the distro `musl-gcc` (static: no loader or libc expectations on consumers, one binary for glibc and musl distros); CI's per-architecture runners are the builders of record, and no cross toolchain exists in the repo. Review covers the C source and the CI job that built each binary, enforced by three gates: platform prepack refuses missing/wrong-ELF binaries, entry prepack refuses unbuilt `lib/`, and the release pipeline byte-pins installed binaries against the workspace builds they were packed from.

The package matrix is checked-in metadata (`prebuilds.json` + `os`/`cpu` fields); `scripts/github-matrix.mjs` derives the CI and Release matrices from it, so adding a platform extends automation without editing workflows.

## Adding a platform

A new platform adds one `packages/<platform>/` package (`package.json` with `os`/`cpu`, `prebuilds.json`, README, LICENSE), a runner entry in `scripts/github-matrix.mjs`, and a row in [support-matrix.md](support-matrix.md) — added only together with a native GitHub runner that builds and proves it (the no-cross-toolchain rule). Sibling launchers for other confinement mechanisms belong in their own repositories on this same template, not as second tools here.
