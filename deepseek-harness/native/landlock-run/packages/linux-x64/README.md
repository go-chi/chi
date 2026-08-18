# @deepseek-ai/node-addon-landlock-run-linux-x64

English | [中文](README.zh.md)

Prebuilt `bin/landlock-run` Landlock launcher for linux-x64 — a static musl binary compiled natively (no cross toolchain) from the C source shipped in [`@deepseek-ai/node-addon-landlock-run`](https://www.npmjs.com/package/@deepseek-ai/node-addon-landlock-run). npm's `os`/`cpu` fields select this package at install time; the entry package resolves it to a file path — it ships no JavaScript and is never imported.

The binary is git-ignored and rides the npm tarball via the `files` list; the `prepack` gate refuses to pack when it is missing or has the wrong ELF architecture, and the release pipeline byte-pins the packed binary against the CI build it came from. Static musl linking means one binary for glibc and musl distros alike — hence no libc suffix in the name.

Sibling: `@deepseek-ai/node-addon-landlock-run-linux-arm64`.
