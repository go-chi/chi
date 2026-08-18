# Agent Note: TUI generic-card Markdown rendering

Status: implemented
Archived: 2026-08-04

English | [中文](2026-07-23-tui-generic-card-markdown.zh.md)

## Problem

Tool presenters can put Markdown in generic-card content, including fenced `console` output used for background-task acknowledgements and execution errors. Rendering that content as plain text exposes the fence markers and diverges from assistant and user content in the same transcript.

## Decision

The TUI renders generic-card result content with its shared Markdown theme before applying the card's head-and-tail line limit. Terminal and diff cards retain their specialized plain-text renderers, and generic-card raw input remains literal because it represents tool arguments rather than presenter-authored prose.

The shared theme hides fence syntax, retains the optional language label, and colors the fenced body as code. Rendering precedes truncation so collapsed-card line counts and boundaries describe the visible terminal rows rather than Markdown source rows.

## Alternatives considered

**Strip fences in the Bash presenter.** This would fix one producer while leaving generic-card Markdown from other tools unrendered and would make the presenter depend on TUI behavior.

**Render every tool card as Markdown.** Terminal output and diffs have dedicated formatting and may contain Markdown punctuation that must remain literal.

**Apply the collapsed-card limit before Markdown rendering.** Source-line truncation can split a fenced block and makes the visible line count differ from the count used by the card.

## Consequences

Generic tool cards use the same Markdown vocabulary and sanitization path as conversation content. Markdown punctuation in a generic card is interpreted rather than always displayed literally; tools that require literal terminal output use the terminal card intent.

The focused TUI test pins hidden fences, retained language labels, and body text. The keyless terminal-state snapshot covers the behavior through an assembled TUI transcript.
