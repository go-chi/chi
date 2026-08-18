# AGENTS.md

This directory builds `landlock-run`, a Landlock self-restrict-then-exec launcher: a small, auditable confinement binary distributed as prebuilt per-platform npm packages, plus the thin JS entry package that resolves it and implements its CLI contract. It belongs to the repository's root pnpm workspace and lockfile. The main repository owns native CI, tarball assembly, verification, and npm publication; keep package-family changes coordinated with harness consumers in the same repository.

## Pre-release stance

The project is pre-1.0. Prefer the correct public API over compatibility shims: if a package name, exported field, layout, or contract detail is wrong, rename it and update all references in the same change. Do not add deprecated aliases unless a stable release already needs them.

## Runtime safety rules

- Every tool must fail closed. If a ruleset cannot be created or the kernel does not enforce it, exit non-zero WITHOUT exec'ing the wrapped command. Never run unconfined as a fallback.
- Runtime binaries and the entry packages take NO environment-variable overrides: which binary confines a process must never be decidable by the ambient environment. Test injection is by function parameter; the `NALR_*` prefix is for build/test orchestration only.
- Kernel UAPI is self-defined in the C source (verbatim from the kernel headers), keeping builds independent of toolchain header vintage and making the definitions part of the audit record.
- No libraries beyond libc, linked statically against musl. The audit surface of a tool is its C source plus the kernel's stable syscall contract.
- The CLI contract of each tool ([docs/cli-contract.md](docs/cli-contract.md)) is the cross-repo compatibility contract: argv grammar, exit codes, and report lines change only with a version bump and a changelog entry, and consumers parse them only through the entry package.
- There is deliberately NO install-time build fallback: a host without a matching platform package gets a nonexistent launcher path, the consumer's probe fails, and the consumer falls closed — that degradation is part of the design, not a gap to fill with node-gyp.

## Repository layout

```text
packages/entry/     Published entry package: JavaScript API (resolve/probe/grants) + the C source.
packages/linux-*/   Published per-platform packages: one prebuilt static binary, no JavaScript.
scripts/            Build, matrix derivation, prepack gates, and release orchestration.
test/               Plain-node behavioral tests (entry API + real-kernel launcher proofs).
docs/               Architecture, packaging, CLI contract, release, support matrix, naming.
```

## Commands

```sh
pnpm install
pnpm build:ts        # entry packages → lib/
pnpm build:native    # this Linux architecture's binaries (needs musl-tools); fails fast elsewhere
pnpm typecheck
pnpm test            # entry tests everywhere; launcher tests need linux + built binary
```

## Packaging invariants

- The package matrix is explicit, checked-in metadata: `packages/<name>/package.json` (`os`, `cpu`), `packages/<name>/prebuilds.json` (the binaries that may exist there), and [docs/support-matrix.md](docs/support-matrix.md) stay synchronized when the matrix changes. `scripts/github-matrix.mjs` derives CI and release matrices from it; nothing else enumerates platforms.
- Platform package names contain platform only (`-linux-x64`), never tool variants — those stay inside `prebuilds.json`. Static musl linking is why there is no libc suffix: one binary serves glibc and musl distros.
- Platform packages ship no JavaScript; the entry package resolves them to file paths. Backends prove themselves at runtime through the functional probe, never through metadata trust.
- Builds are native-only: each architecture compiles its own binary on its own runner (CI is the builder of record); no cross toolchain enters the repo.
- Every tarball is gated at pack time: platform packages refuse to pack without their declared binaries present, executable, and in the right ELF architecture (`verify-launcher-binary.mjs`), entry packages without built `lib/` (`verify-entry-lib.mjs`), and the release pipeline byte-pins installed binaries against the workspace builds (`verify-packed-install.mjs`).
- Platform tarballs are packed with `npm pack`, never `pnpm pack`: pnpm's pack path strips the executable bit (observed on 11.7.0), shipping a launcher no consumer can spawn. `pack-release.mjs` encodes the split; the rehearsal asserts executability of the installed copy so a regression fails loudly instead of masquerading as a non-enforcing kernel.
- Generated artifacts stay out of git: `packages/*/bin/`, `packages/*/lib/`, `dist/`, `.release/`, `*.tsbuildinfo`. Ignore rules live in the ROOT `.gitignore` only — a package-nested ignore file can silently drop payload from tarballs.

## Documentation

User-facing docs are English. Keep the README focused on install, usage, and support status; durable design decisions belong in docs/ alongside the code, and the current implementation belongs in [docs/architecture.md](docs/architecture.md).
