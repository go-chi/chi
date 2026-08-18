# Agent Note: Tutorial-style Cordis docs under docs/cordis-tutorial

Status: implemented
Archived: 2026-07-27

English | [中文](2026-07-22-cordis-tutorial-docs.zh.md)

## Problem

The repo documents Cordis at two levels: the condensed [cordis-primer](../../../../docs/cordis-primer.md) states the concepts, and the `docs/user/develop/` pages teach harness plugin authoring against harness services. Neither serves a developer meeting Cordis itself for the first time: the primer assumes the reader already writes plugins, and the develop pages jump straight to `defineTool` without showing how contexts, fibers, services, and dispatch actually behave. There was no path where a reader runs bare Cordis, watches a fiber go PENDING, or sees a waterfall veto happen.

## Decision

`docs/cordis-tutorial/` holds a seven-chapter hands-on tutorial (first plugin → lifecycle/effects → services → events → config → composition/HMR → harness tool). Its properties, in decreasing order of load-bearing-ness:

- **Every transcript is real.** Each chapter's files run in the gitignored `tmp/cordis-tutorial/` scratch directory via `node --import tsx ../../vendor/cordis/bin.js`, and the shown output is what those commands print. The chapter that uses harness packages (`@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-llm`) runs keylessly.
- **dsh-flavored, not pure Cordis**: later chapters use real harness services and events (`ctx.tools`, `tools/result`) so the tutorial lands the reader inside this repo's actual composition model, per the requesting user's choice.
- **English-only, published to both website locales** through `mirroredPages()` in [website/docs.ts](../../../../website/docs.ts) under a `Cordis 教程` / `Cordis tutorial` section of the develop sidebar — the same pattern as the reference pages, so a Chinese pair can ratchet in later without route changes.
- Code fences compile under `doc-typecheck` except the two fences that import scratch-relative files (`./stats.ts`) or intentionally throw, which carry `ignore-check`.

## Alternatives considered

**Under `docs/user/develop/` as paired product docs.** That tier requires en+zh+i18n records in the same PR, roughly doubling the change and coupling every future tutorial edit to a translation. Rejected for the first landing; the mirrored projection keeps the same public visibility.

**Pure-Cordis tutorial with no harness packages.** Cleaner as framework documentation, but the audience is agent developers extending this harness; ending at `ctx.tools.execute` and `tools/result` teaches the composition they will actually work in. The user chose this explicitly.

**Extending the primer instead of a new directory.** The primer is a 600-word budgeted concept reference; a multi-chapter walkthrough inside it would break its tier's job (and its budget) rather than complement it.

## Consequences

- A runnable introduction to Cordis exercises the loader, fiber states, effects, service injection, all five dispatch-mode contracts, Schemastery validation, and HMR. It demonstrates PENDING dependencies and validation failure; it explains the loader's logged unresolved-entry failure because that boot-time log may not reach a console exporter.
- The tutorial's transcripts pin behavior informally but are not snapshot-gated; if loader or HMR behavior changes, the transcripts drift until a human replays the chapters. The compile gate covers only the code fences.
- The chapters name concrete harness APIs (`ctx.tools.execute`, `CallId`, `tools/result`); renames must update the tutorial like any other doc reference (`verify-md-links` catches file moves, not API prose).
