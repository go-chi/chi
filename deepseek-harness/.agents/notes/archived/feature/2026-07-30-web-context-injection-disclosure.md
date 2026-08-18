# Agent Note: Web context injection disclosure

Status: implemented
Archived: 2026-08-07

English | [中文](2026-07-30-web-context-injection-disclosure.zh.md)

## Problem

The Web conversation rendered every logged non-user message through the generic `JsonBlock`. That presentation used a textual triangle, compact label typography, a bordered JSON panel, and unrelated spacing, so context injection did not match the Tool calls disclosure shown in the product design. Restyling the generic primitive would also change unknown events and attachment fallbacks.

## Decision

`MessageItem` routes context nodes to `ContextInjectionRow`. The row starts collapsed, names the presentation `上下文注入`, uses the existing browse glyph, and exposes the whole 24px header as one pointer and keyboard disclosure target. Its expanded body begins 4px below the header at the shared 22px content indent and renders the design's 141px scrollport with 8px radius, code-block background, 11/16 code text, and no border.

`ContextInjectionRow` serializes both logged `content` and `source` into one inline JSON value, preserving provenance alongside model-visible material. The display remains bounded by the existing 20,000-character truncation policy. It changes no session event, runtime fold, or context-producing plugin.

The package-internal `DisclosureRow` owns the header geometry, icon-to-chevron transition, controlled open state, and Enter/Space behavior shared by context and `ToolRow`. `ToolRow` remains the semantic owner of tool state, summaries, file links, and expanded tool bodies. Context does not enter the keyed toolview slot and gains no context-specific slot while all context sources share one presentation.

## Verification

Conversation component tests pin the collapsed default, browse glyph, whole-row pointer and keyboard toggles, inline JSON shape, truncation, and unchanged generic unknown-event rendering. The keyless assembled-Web history scenario injects context through the real Agent API, records the collapsed row in its ARIA golden, and measures the design's icon, header, indent, gap, scrollport, padding, radius, typography, color, and overflow in Chromium.

## Alternatives considered

**Restyle `JsonBlock` globally.** Unknown surface events and miscellaneous content blocks use that primitive for a separate generic fallback, so a global visual change would couple unrelated presentations.

**Render context as a read tool.** Reusing `ToolRow` directly would add false tool semantics, state and keyed dispatch to a logged non-user message.

**Add a keyed context-view slot.** Every current context source uses the same title and provenance body. A registration seam has no present consumer and can be added without changing the row if distinct source-owned presentations emerge.

## Consequences

Context injection matches the Tool calls visual language without changing its durable meaning. The shared disclosure header prevents the two rows from drifting, while the dedicated context body and generic `JsonBlock` remain independently evolvable. The fixed-height body trades automatic expansion for a stable transcript rhythm and requires scrolling to inspect long injected instructions.
