# Packaging

The package family uses the same layout as native packages such as esbuild: one JS entry package plus platform optional packages. Unlike Node addons there is no ABI or backend division — each platform package carries exactly the static executables its `prebuilds.json` declares.

## Published packages

```text
@deepseek-ai/node-addon-landlock-run
@deepseek-ai/node-addon-landlock-run-linux-x64
@deepseek-ai/node-addon-landlock-run-linux-arm64
```

Unsupported platforms are intentionally absent from `optionalDependencies` — see [support-matrix.md](support-matrix.md).

## Package matrix

The matrix is explicit in checked-in metadata:

- `packages/entry/package.json` lists the platform packages as `optionalDependencies`.
- `packages/<name>/package.json` declares `os` and `cpu`. There is no `libc` field on purpose: the binaries are statically linked against musl and run on glibc and musl distros alike.
- `packages/<name>/prebuilds.json` declares the binaries that may exist in that package (`tool`, `kind`, `path`).
- [support-matrix.md](support-matrix.md) explains why unsupported platform packages are not published.

`scripts/github-matrix.mjs` derives the CI and Release matrices from these files. `scripts/build.ts` builds only the current host's targets, into `packages/<name>/bin/`; it is not a matrix generator. When changing the matrix, update package metadata, `prebuilds.json`, the lockfile, and the support/release docs in the same change.

## Runtime selection

1. npm's `os`/`cpu` fields make installers fetch only the matching platform package.
2. The entry package's `launcherPath()` resolves it to `<package>/bin/landlock-run`; unresolvable packages yield a deterministic, never-existing fallback path.
3. `probe()` is the single availability signal: missing binary and unenforcing kernel are deliberately indistinguishable (`unusable`), so consumers have one fail-closed path.

## No install fallback

The entry package has NO install script and never compiles on the consumer host. A compile fallback would require a musl toolchain everywhere and turn a clean fail-closed degradation into an environment-dependent maybe. The packed-manifest check in `verify-packed-install.mjs` enforces the absence of install lifecycle scripts.

## Pack gates

Platform tarballs are produced by `npm pack`, entry tarballs by `pnpm pack` — deliberately split: `pnpm pack` (observed on 11.7.0) normalizes file modes and strips the executable bit, which would ship a launcher no consumer can spawn, while platform packages have no dependencies and so need none of pnpm's workspace-protocol conversion; entry packages need that conversion and carry no executables. `scripts/pack-release.mjs` encodes the split — never hand-pack a platform package with pnpm.

Both pack paths produce the exact publish bytes behind a `prepack` gate:

- Platform packages: `scripts/verify-launcher-binary.mjs` — every declared binary present, executable, ELF `e_machine` matching the declared `cpu`, nothing undeclared in `bin/`.
- Entry packages: `scripts/verify-entry-lib.mjs` — built `lib/` present.

`scripts/verify-packed-install.mjs` then rehearses the consumer path from the packed tarballs: payload checks, a throwaway install, a byte-pin of the installed binary against the workspace build, an executability check on the installed copy, and a real confinement world-proof through the installed launcher. A non-executable or missing binary fails loudly here instead of masquerading as a non-enforcing kernel.
