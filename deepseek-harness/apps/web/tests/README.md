# apps/web browser e2e

English | [中文](README.zh.md)

These tests boot the real web composition in-process and drive it with a real
Chromium over real HTTP. The lane's mechanics — modes, fixtures, goldens, and
the deliberate composition divergences from `dsh web` — are documented in
[`scaffold.ts`](scaffold.ts) and the
[browser e2e Agent Note](../../../.agents/notes/implemented/testing/2026-07-24-web-gui-browser-e2e-lane.md).

## These are Host-face tests

They type-check in the root `tsconfig.host.json`, not in the Client aggregate,
because they read Host services directly: `ctx.apiProxy`, the Host
`SessionStore`, `ctx.sessionProjectionCache`. Driving a browser at runtime does
not make a file part of the Client program — the two faces merge cordis
`Context` under the same keys with different services, so one program cannot see
both. Moving these files into the Client aggregate makes every Host-service
access fail to compile.

## Do not import `@deepseek-ai/dsh-client-*` here

Importing a Client package — a value or a type — pulls its whole TypeScript
project, and every project it references, into the **Host build graph**. That has
bitten this lane once already: four Client consumer packages reference
`api/remotes`' Client face, which cannot compile until Host tsdown has generated
`@deepseek-ai/dsh-goal/remote`, so the Host build phase ended up waiting on an
artifact it produces itself.

When a scenario needs a Client-owned constant or pure function, mirror it here
instead, next to the commented-out import that names the source module. A drift
then surfaces as a missed selector or a stale mirrored value — a loud failure,
never a silent pass. `scaffold.ts` follows this rule for the welcome-notice
namespace, acknowledgement field, version, and asserted Chinese copy.

Two kinds of Client import stand. `assembled-boot.ts` drives the shell itself, so
it imports `AppWebEntry` from `@deepseek-ai/dsh-client-web` and the boot-manifest
type from `@deepseek-ai/dsh-client-modules/client`: booting the real shell is what
that harness is for, and both packages are already in the Host graph. Separately,
the chat scenarios import `conversationContextKey` from
`@deepseek-ai/dsh-client-runtime/client` because `client/runtime` is reachable
through the unsplit `directory-picker` packages and pulls nothing further in.
That reachability is incidental, not a guarantee — if it ever leaves the graph,
mirror the helper like the rest.

Nothing mechanically enforces this rule; keep it in review.
