# Post-mortem 0003: Web agent validated a replacement server instead of its current GUI

English | [中文](0003-web-agent-gui-feedback-loop.zh.md)

Status: resolved

## Executive summary

A Web agent changed the GUI source but did not know which URL and process hosted its session. It delegated acceptance to the user, then treated a bare Vite HTTP 200 as success despite a missing `window.__DSH_BOOT__` white screen, and finally validated a replacement `dsh web` server on another port while the original page had already picked up rebuilt artifacts. The fix makes the current URL and runtime mode model-visible and shell-queryable, rejects standalone Vite before listen, and verifies production refresh and development HMR against external state.

## Summary

The session ran inside the DeepSeek Harness Web GUI at port 3081 while its selected Workspace was an empty `test/` directory. The model request named neither the GUI nor its source checkout, URL, process, or update mode. Repository affordances exposed `apps/web` with a Vite development script, while the full browser composition lived behind `dsh web`.

The resulting actions were individually plausible but did not share one acceptance target. A source edit, a successful build, an HTTP 200, an injected boot manifest, and the user's existing page were treated as interchangeable facts.

The evidence source is the persisted event log for `session-3eb796c2-5159-4686-affe-df8719f6f987`, whose header records cwd `/Users/tn.shen/Documents/deepseek-harness-gui-master/test`. Its initial request header is sequence 6; the user-facing handoff, bare-Vite launch, replacement-host launch, boot-manifest probe, and first 3081 process probe are sequences 30939, 31865, 34309, 34441, and 34681 respectively. The timeline below follows those events rather than reconstructing intent from the later report.

## Impact

The user had to identify three consecutive mistakes: acceptance was delegated back to them; the proposed preview was a blank page; and the reported successful URL was not the page they were using. An unmanaged replacement server also outlived the turn until the user challenged it.

No change in this investigation restarted or modified the read-only 3081 and 3082 trial services.

## Timeline

- In turn 2, after editing the theme, the agent's sequence-30939 message told the user to run `pnpm run demo:tui` or open an unspecified Web application. It ran no assembled Web acceptance.
- In turn 3, the agent read `apps/web/package.json`, launched bare Vite on port 5173 at sequence 31865, observed HTTP 200, and declared success. The browser instead threw `client-modules: window.__DSH_BOOT__ is missing or not an object` and rendered a white page.
- In turn 4, the agent found the full `dsh web` path, rebuilt the shell, launched an unmanaged process on port 3334 at sequence 34309, and checked only that this replacement returned 200 with a boot manifest at sequence 34441. It never probed port 3081.
- In turn 5, the user reported at sequence 34556 that 3081 already showed the new theme. Only then, at sequence 34681, did the agent inspect the existing process and remove the redundant server.

## Root cause

The Web assembly had no model-visible identity for the current GUI, canonical URL, or runtime mode. The session cwd correctly identified the user's selected Workspace, but the model treated that project directory as the application directory. No durable record related the GUI source checkout, built artifacts, serving process, target origin, and browser acceptance.

The wrong startup path looked legitimate because bare Vite returned HTTP 200. `window.__DSH_BOOT__` is injected only by the full host, so transport readiness did not imply application readiness. The first regression test repeated this mistake in another form: a timeout killed Vite and satisfied a nonzero-exit assertion. Live reproduction exposed that false positive.

Background process semantics were also bypassed with shell `&`, so job identity, completion notices, collection, and cleanup did not apply. Verifying port 3334 therefore proved only that a second service worked.

## Guardrails added

- The Web launcher publishes the canonical loopback URL and actual production/development mode in the logged `app:web-surface` prompt section and managed `$DSH_WEB_URL`/`$DSH_WEB_MODE` environment.
- Production guidance requires rebuilding artifacts and verifying the existing URL after refresh. Development guidance explains that `dsh web --dev` mounts only the HMR receiver; `pnpm run dev:web` in the same checkout must also rebuild client-plugin bundles, while shell and plain-package changes still require refresh.
- `apps/web` standalone Vite serve mode rejects during configuration. Its subprocess test proves natural exit and instruments `Server.listen()` so a transient bind cannot pass unnoticed.
- Layered real-path tests cover the CLI request, exact production/development prompts, shell runtime facts, same-port static replacement, source watcher rebuild, host stat polling, and browser HMR under an unchanged page identity.
- PR evidence preserves screenshots from the original 3081 session and a real-model before/after GUI run; external browser, HTTP, process, and session-log observations carry acceptance.

## Lessons

- The agent must know hidden runtime prerequisites before it can guide the user; startup mode is application context, not tribal knowledge.
- HTTP readiness, build success, and a boot manifest are different facts. Acceptance names the exact origin and externally observes the requested change there.
- A replacement service cannot prove that an existing page changed. Long-running processes use managed task lifecycles when they are actually requested.
- A regression test must be able to fail for the reported mechanism. Process timeout is not equivalent to fail-fast, and post-exit port availability does not prove the port was never bound.
