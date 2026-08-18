# Agent Note: Card tool rows collapse through one ToolRow

Status: implemented
Archived: 2026-08-07

English | [中文](2026-07-31-web-cards-toolrow.zh.md)

## Problem

The Web client grew five card render intents over successive PRs — terminal, diff, read, search, web — each landing as a keyed toolview registrant under `packages/client/ui-conversation/src/client/toolviews/`. They diverged in two ways the earlier PRs each acknowledged but deferred:

- **Chrome duplication.** `read-row`, `search-row`, `web-row`, and `file-mutation-row` each hand-drew the summary row (leading state slot, visually-hidden status, title, separator dot, path-link/summary) as their own `<div className={css.root}>` with a private `.module.css`, instead of composing the shared `ToolRow`. `read-row` carried a `jscpd:ignore` marker naming the duplication and pointing at "a separate change tracked for all rows at once" — this change.
- **Resident vs. collapsed.** Those four rows kept their card (`ReadBlock`/`SearchBlock`/`WebBlock`/`DiffBlock`) resident below the summary — always expanded — while the terminal card (via `GenericToolCard`/`BashRow`) and every text row started collapsed behind ToolRow's whole-row expand. A conversation with several read/search/web/edit calls became a wall of always-open cards, defeating the summary-surface purpose of the message flow.

## Decision

`ToolRow` owns every card kind, and every keyed card row composes it. ToolRow already took `terminal` and `diff` card material; it now also takes `read`, `search`, and `web`, rendering whichever is present in its collapsed-by-default expanded body through the matching primitive (capped at the chat `CHAT_*` bounds). A call carries at most one card kind, so the props are mutually exclusive and the body picks the first present.

The four keyed rows — `ReadRow`, `SearchRow`, `WebRow`, `FileMutationRow` — drop their hand-drawn chrome and private CSS and become thin `ToolRow` compositions, exactly like `AskQuestionRow`: derive the card model, pass it as the matching ToolRow prop, forward `filePath`/`onOpenFile` for the file tools and `output`/`errorSummary` for the cardless failure paths. Each row is now `ToolRowProps & PropsLocale<'conversation'>` and registers with `locale: NS`, because ToolRow needs the conversation `t` for its terminal/code body copy. `GenericToolCard` (the render-site fallback) does the same for read/search/web, so a card-declaring tool without its own keyed row collapses identically.

The `DetailsPanel` Output section is unchanged: the panel is the single-call reading surface, so it renders each card resident at the primitive's full height, and a capped search keeps its recovery footer there.

## Consequences

- One expand interaction across all tool rows: collapsed one-line summary, whole row toggles the card. The card is not in the DOM until expanded (`DisclosureRow` renders `children` only when open), so tests assert absent-then-present around a `[data-expandable]` click.
- Deleted: `read-row.module.css`, `search-row.module.css`, `web-row.module.css`, `file-mutation-row.module.css`, `GenericToolCard.module.css`. The rows carry no CSS of their own; ToolRow's module owns the chrome and the card-body indentation.
- The cardless failure paths (an errored mutation, an errored/nested/legacy search) no longer draw their own `.failure`/recovery `<div>`; they ride ToolRow's `output` (Output section) and `errorSummary` (collapsed summary first line), which already flatten the result text with the `error.name: error.code` fallback.
- `bash-sample` keeps its own local expand chrome deliberately (the third-party-posture exemplar that never imports the chat domain); it was already collapsed, so its behavior is unchanged.

## Alternatives considered

- **Keep the rows resident, only unify chrome.** Rejected: the user's requirement is default-collapsed, and resident cards are what made the flow unscannable.
- **A shared `CardRow` wrapper between the rows and ToolRow.** Rejected: ToolRow already is that wrapper once it takes every card kind; a second layer would be the premature extraction the package rules warn against.
