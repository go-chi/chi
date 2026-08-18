# Agent Note: Documentation-site navigation and repository chrome

Status: implemented

English | [中文](2026-08-12-documentation-site-navigation-and-chrome.zh.md)

## Problem

The reference sidebar rendered its 43 subsystem pages first, ahead of every other group: `sectionOrder` in the VitePress config listed no position for the subsystem groups, nor for the group holding the Python SDK page, so `indexOf` returned `-1` and sorted them ahead of the ordered sections. Clicking the `参考` navigation item landed on the architecture page whose own sidebar entry was link 44 of 62, 1549px down a 2478px sidebar — outside the viewport. Four subsystem pages carried `order` values already taken by other pages in the same section, resolved only by `Array.prototype.sort` stability and the order the manifest's arrays happened to be concatenated.

The navigation bar named `/guide/` while the manifest published the guide's first page at `guide/quickstart.md`, so that item served a 404: written-down navigation targets drift from the routes the manifest publishes.

Separately, every canonical page carries lines written for its GitHub reader — a language switcher under the heading, and for some, a repository badge — which the site projected verbatim even though its navigation bar already offers both.

## Decision

[website/docs.ts](../../../../website/docs.ts) owns section placement. `sections` declares the groups per locale, and `sectionSpec(locale, label)` returns a group's position and collapse behavior, throwing when a locale declares no placement for a label. A group absent from the declaration now fails the build instead of sorting silently to the top. Placement is per locale because the two sidebars name their groups independently, and a label both use — `SDK` — cannot hold one rank against `入门` and against `Guide` at once.

Subsystem pages are grouped by concern — overview, core and scopes, sessions and persistence, model and context, execution and tools, policy and interaction, platform and access — and the six topical groups render collapsed until one holds the page being read. The groups sort last within the reference sidebar: expanded, they outnumber every other group combined, so anything placed after them is reachable only by scrolling past the whole list. Page `order` derives from array position rather than a hand-written number.

`landingLink(locale, collection)` derives each navigation item's target from `orderedPages`, the same ordering the sidebar renders, so an item always opens its collection's first published page.

`projectedPageContent` in [scripts/project-doc-site.ts](../../../../scripts/project-doc-site.ts) drops the language-switcher line and the repository badge. The switcher match is confined to the first eight lines so a tutorial that shows the convention still renders its example.

The navigation-bar title is the DeepSeek wordmark inlined into `siteTitle`, which VitePress renders as HTML. Inlining is what lets the mark's `currentColor` fills follow the active theme; `themeConfig.logo` renders an `<img>`, which freezes the mark at the colors its file declares and would need one asset per theme. The sidebar scrollbar rests invisible and appears while scrolling, marked by a `data-` attribute rather than a class because Vue rewrites `class` wholesale when it patches the element.

## Alternatives considered

**A search tokenizer for Chinese queries.** Built and reverted. The premise — that MiniSearch leaves Chinese prose as untokenizable whole sentences — was tested against a term (`子代理`) that appears nowhere in the corpus; the Chinese pages write `Subagent` and `子 agent`. Measured against the unmodified index, `插件配置` returns 120 hits, `会话持久化` 85, `工作流` 28, `沙箱` 12, each ranking its own page first: `prefix: true` already reaches Chinese terms through the short tokens punctuation produces. Adjacent-character pairs grew the Chinese index from 1.23MB to 2.12MB for no gain. The attempt also surfaced a trap worth keeping: VitePress ships search-option functions to the browser through `Function.prototype.toString` and rebuilds them with `new Function`, so any such function that closes over a module-level constant throws in an empty scope and silently returns no results.

**Placing the subsystem groups directly after `概念`.** Rejected: it restores the architecture page to the top but leaves generated reference, the Cordis API, and the cookbook below 43 rows.

**Rewriting filename link text during projection.** The subsystem index table writes `[core.md](core.md)`, which reads as a repository file index on the site. `scripts/project-doc-site.spec.ts` asserts that exact row format, so the filenames are a deliberate convention rather than an oversight; changing what the site displays means changing the convention and its gate together, not working around them in the projector.

## Consequences

The reference sidebar measures 1452px with every subsystem group collapsed, against 2478px before, and the architecture page is its first entry. Section placement and collapse are declared in one manifest instead of split between the manifest and the config, and `scripts/project-doc-site.spec.ts` pins three invariants: every sidebar-owning page resolves a placement, an undeclared section is refused, and no two pages share an `order` within a section.

Canonical Markdown is unchanged by the chrome stripping — the switcher and badge still serve GitHub readers. The cost is that the projector now knows two presentation conventions of the source corpus, which a page written with a different switcher wording would not match.

The wordmark is a second copy of a mark that also lives in `apps/web/public/favicon.svg` and `packages/client/ui-primitives/src/FishLogo.tsx`, each carrying its own presentation. A change to the DeepSeek wordmark reaches the documentation site only by updating this copy.
