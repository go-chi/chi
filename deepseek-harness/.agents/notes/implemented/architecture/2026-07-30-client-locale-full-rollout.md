# Agent Note: Full client copy rollout onto the typed locale seat, and the non-translation boundary

Status: implemented

English | [中文](2026-07-30-client-locale-full-rollout.zh.md)

## Problem

After the typed locale standard seat landed (`locale:` on register → framework-injected typed `t`), only four early adopters rode it; every other client package still shipped hardcoded, mixed-language literals. Migrating the rest required mechanisms and boundary decisions the early adopters never touched: how registration-time text (nav rows, view-tab labels) refreshes on a language switch; how the zero-cordis ui-primitives atoms receive copy; and which strings deliberately stay untranslated — an unrecorded boundary invites a future agent to "complete" the localization.

## Decision

**Registration-time text rides a label thunk.** A list registration's `label` accepts `SlotLabel = string | (() => string)`; owners projecting ledger rows resolve through `resolveSlotLabel` (never reading `options.label` raw) and make the read point follow the locale revision (outlets subscribe to the revision themselves; off-ledger projections such as the ui-settings nav fold the revision into their cache key and subscribe to both sources). Thunks evaluate per read, so a language switch causes zero ledger churn — no re-registration, versions stay put, and every `locale/change` re-registration wiring is deleted.

**Component copy rides the standard `t` seat; deep children take `t` as a plain prop** typed `XxxProps['t']`. The dictionary canon is unchanged: `zh satisfies Record<string, string>` is the key source and `en satisfies Record<XxxKey, string>` locks bilingual balance.

**Zero-cordis atoms (ui-primitives) take copy as props**: `copyLabel`/`copiedLabel` on `HoverCard`, `labels` on `TerminalBlock`/`JsonTree`, `copyLabel`/`copiedLabel` on `CodeBlock`, `codeLabels` on `MarkdownText`, `truncatedLabel` on `JsonBlock`, `label` on `ConnectionBanner`, `closeLabel` on `Modal` — defaults are the previous hardcoded strings, so a consumer passing nothing renders byte-identical output. Localized plugins pass dictionary-driven labels from their own `t` seat; call sites passing object props memoize them on the `t` identity (`MarkdownText` caches its component table on the `codeLabels` identity).

**The non-translation boundary (deliberate decisions, not debt):**

- **Error/failure strings stay English**: client-authored fallbacks (`command failed`, plan-toggle failures), RpcError messages, and wire `error.message (code)` pass-throughs render verbatim.
- **Design literals stay out of the dictionaries**: tool-row variant titles (Think/Bash/…), SYSTEM/USER-style kind badges, the Plan chip wordmark, the whole StatsLine — identical in both languages.
- **ui-trajectory is deferred wholesale** (a developer inspection surface, terminology-dense, ruled separately).
- **Boot copy stays hardcoded** (AppRoot renders before the locale service exists).

**Derivation layers stay pure; localization happens at render.** ui-workspace's `relativeTime` returns structured `{unit, n}` composed with dictionary templates by the renderer; blank sessions and the Ungrouped bucket keep their stored titles, with the renderer substituting localized copy off the `blank` flag / absent `workspaceId`; **blank rows are excluded from search entirely** (a bilingual display title cannot match a single-language query stably). Dates use no Intl: format templates live in the dictionaries (message clock `clock.md`/`clock.ymd`, workspace hover `date.ymd`) and the formatters take `t` as a parameter, staying pure.

**Test and e2e doctrine**: `makeTranslate(...dicts)` (dsh-client-test-runtime) mirrors the service lookup chain (first-dict-wins, key fallback, `{name}` interpolation); component specs stub the `t` seat with it, typed against real props seats. Web e2e uniformly opens through `newEnglishPage` (an `en-US` browser) and the built-boot snapshot pins the same navigator language—goldens are immune to localization migrations; the settings language-switch scenario bypasses the helper and opens a `zh-CN` browser, since the provisional locale follows `navigator` before an explicit Host preference arrives ([browser-derived initial locale](../feature/2026-07-31-browser-derived-initial-locale.md)).

The "apply layer subscribes to `locale/change` and re-registers for fresh labels" mechanism in the [settings/locale/theme layering note](../../proposed/architecture/2026-07-25-client-settings-locale-theme.md) is superseded by this decision (thunk + revision lifecycle).

## Alternatives considered

- **Keep labels as strings and re-register on switch** (the early adopters' original shape): boot already registers once per package, and `locale/change` listeners re-registering amplifies into a storm; ledger version churn also busts every version-keyed projection cache. Thunks move the refresh cost to read points that already follow the revision.
- **A locale context/injection channel for ui-primitives**: breaks the zero-cordis boundary (atoms would depend on the runtime) and drags unlocalized consumers (ui-trajectory) along. Props let each consumer decide independently.
- **Error strings in the dictionaries**: the error surface is a debugging surface — verbatim English is what gets searched and compared in reports; wire pass-throughs are untranslatable anyway, and half-translation manufactures mixed-language text.
- **`toLocaleString()`/Intl for dates**: follows the browser/OS language, not the app locale, guaranteeing mixed text after a switch; the dictionary templates are tiny and isomorphic to the message clock.
- **Blank rows matching search (against localized or stored titles)**: either choice yields "visible but unfindable" in one language; placeholder rows carry no information, so whole-row exclusion is the stable semantic.

## Consequences

- A language switch refreshes the whole UI instantly with zero re-registration; adopting a new package is three steps (dictionary + declare-merge + `locale: NS`), no hand-written glue.
- Cost: list-label consumers must know `resolveSlotLabel` (a raw `options.label` read can now hold a function); the `SlotLabel` type catches most misuse statically.
- ui-primitives' Chinese defaults still render Chinese under the English locale **until a consumer passes labels** — the unmigrated JsonTree consumer (ui-trajectory) showing its English defaults happens to match that package's all-English status quo.
- Pinning e2e to English means the zh default is covered mainly by package-level component specs and the settings language-switch scenario; browser e2e no longer asserts zh copy.
