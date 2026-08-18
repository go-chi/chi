# Agent Note: The Settings language a fresh browser opens in comes from the browser

Status: implemented

English | [中文](2026-07-31-browser-derived-initial-locale.zh.md)

## Problem

The Settings Language row opened every first visit in Chinese: `LocaleRuntime` read `dsh.locale` from localStorage and fell straight back to `zh` when nothing was stored. The browser already states which languages its user reads — `navigator.languages` is that statement — and the app ignored it, so an English reader met a Chinese product and had to find a Chinese-labelled settings row to escape it. The fallback was doing two jobs at once: the last resort for an unresolvable locale, and the answer for every user who had simply never chosen.

## Decision

**The provisional locale resolves through the browser, then `FALLBACK_LOCALE`; an explicit Host preference replaces it live.** `resolveInitialLocale()` in `packages/client/locale/src/client/index.ts` runs at service construction and expresses the browser/fallback order. The nonblocking settings lifecycle then applies optional `locale.preference` from `$DSH_HOME/settings.yaml`; absence leaves the browser-derived value active.

**Browser matching is on the primary subtag, over the ordered list.** `detectBrowserLocale()` walks `[...(navigator.languages ?? []), navigator.language]` and returns the first entry whose primary subtag names a shipped locale, so `zh-Hans-CN` and `zh-TW` both land on `zh` and `en-GB` on `en`, while a browser asking only for languages this app does not ship (`fr`, `de`) yields nothing and leaves `FALLBACK_LOCALE` in charge. `navigator.language` trails the list and covers its absence on hosts that ship a Navigator without `languages` — the DOM lib types it as always present, so that tolerance carries a narrow lint exception, the same environment-boundary distrust the `localStorage` guards already express.

**`window`, not `navigator`, is the browser test.** Node ≥ 21 exposes a global `navigator` reporting the machine's own language (`en-US` on the CI runners), so gating on `navigator` would have let a node boot of the client tree resolve to `en` instead of the documented fallback. Gating on `window` keeps every non-browser run on `FALLBACK_LOCALE`.

**An explicit choice is durable.** `setLocale` writes through the Host settings API, so a user who picked a language keeps it across browser origins and system languages that share the same DSH home. Nothing writes the detected locale back: detection is re-derived every boot and stays invisible to the “has the user chosen?” question.

**The browser e2e lane pins browser language.** Scenarios asserting Chinese copy (`access-confirmation`, `models-settings`, `onboarding-deepseek-config`, `settings-chrome`) open their page with `locale: ZH_BROWSER_LOCALE` from `apps/web/tests/support.ts`; `newEnglishPage` advertises `en-US`. `settings-chrome.e2e.ts` opens a fresh Host home with no explicit locale and asserts its English browser produces an English settings surface—the assembled-app proof of this feature.

## Alternatives considered

- **`Intl.DateTimeFormat().resolvedOptions().locale` or a single `navigator.language` read**: both collapse the user's ordered preference list to one tag, so a `['de', 'en', 'zh']` reader gets zh instead of en. The list is the part of the browser statement worth reading.
- **Persisting the detected locale on first boot**: it would make detection a one-time event and let a stale first visit outlive a changed browser language, and it destroys the distinction the resolution order rests on — a stored value would no longer mean "the user chose this".
- **Full BCP 47 negotiation (`Intl.LocaleMatcher`-style lookup, region and script weighting)**: with exactly two shipped locales that differ in language, primary-subtag matching is the whole of the correct answer; a negotiation layer would be untestable surface with no behavior to justify it.
- **A cordis config key for the default locale**: the deployment does not vary here — the fallback is the product's answer for "no signal at all", not a knob. Repo policy reserves `Config` fields for deployment-varying choices with a current consumer.
- **Keeping the e2e lane's zh scenarios on storage pinning (`dsh.locale=zh`)**: it would keep the suite green while removing the only place the browser-derived path runs in an assembled app; pinning the browser language instead exercises the new resolution end to end.

## Consequences

- A first visit from an English browser lands in English, and the Language row still shows the same two self-described options, so the escape hatch is unchanged in either direction.
- `FALLBACK_LOCALE` narrows to its real job — the dictionary fallback and the no-signal answer — and stops standing in for "the user has not chosen".
- Tests that construct a `LocaleRuntime` under jsdom now depend on the environment's `navigator`: specs asserting localized copy declare their browser with one suite-level `usePinnedBrowserLanguages('zh-CN')` (dsh-client-test-runtime), and any future spec asserting a default must do the same. This package's own specs stub the globals directly, because they need shapes the helper deliberately cannot express (absent `languages`, a list decoupled from `language`, no `window` at all).
- Detection cost is one array walk per service construction and no implicit settings write; an explicit Host preference may cause one live convergence after plugin activation.
