# Agent Note: Product-first root README

Status: implemented

English | [中文](2026-07-22-product-first-root-readme.zh.md)

## Problem

The root README is the repository's product entry point. Its product-first structure and established voice remain useful, but concrete entry points and capability claims drift as the runtime grows. Rewriting sections whose facts remain correct increases the review surface and discards language that already works.

## Decision

The root README preserves its existing structure, order, and wording wherever the underlying fact remains correct. A refresh changes only stale claims and adds material needed to represent shipped surfaces; it does not use repository growth as a reason to reframe the whole page.

A note before installation thanks internal testers, states that features and experience remain unfinished, and asks for direct reports of failures, confusion, and friction through the WeCom group. The existing development-stage statement identifies DeepSeek Harness as being in internal testing.

The user-surface section adds the ACP automation server and Python/JSON-RPC SDK beside the existing Web, TUI, and headless entries. The installed TUI remains the single `dsh` command; the Web instructions build the active checkout before running `dsh web`, and custom or reused checkout paths stay explicit. These launch paths must remain executable through a real PTY and a production build/HTTP smoke, respectively. The capability paragraph keeps its compact inventory style while adding the shipped PTY, LSP, web, goal, planning, task, sandbox, approval, settings, credentials, session-query, and telemetry families and stating that compositions select subsets. One adjacent bullet records the authoritative-session-log rule because persistence, replay, queries, telemetry, and interfaces depend on it.

Detailed package and service inventories remain at their owning documentation. The English and Chinese README sides share the same technical structure, while their community sections continue to point to the primary channel for each language audience. The documentation website keeps a separate [quick-start entry route](../simplification/2026-08-11-quickstart-documentation-home.md) instead of presenting another product landing page.

## Alternatives considered

**Rewrite the README around a new product narrative.** A complete rewrite can make every current surface prominent, but it replaces accurate, reviewed copy and creates unnecessary churn. Current facts fit the established product-first structure.

**Present the repository as an SDK and package catalog.** This exposes implementation breadth immediately but makes a new reader reconstruct the product from package names. The package map and generated capability graph remain the authoritative inventories.

**Use a long marketing page with screenshots, badges, and duplicated tutorials.** Rich media can demonstrate a stable product journey, but it ages separately from commands and source contracts. The root stays compact and links to runnable examples and owned guides.

**Project the root README as the documentation website home page.** A single landing page avoids two narratives, but the website's user guide and the repository's product/developer entry point have different navigation and maintenance needs. The documentation root sends readers to quick start instead.

## Consequences

Reviewers can distinguish factual refreshes from editorial rewrites, and future updates retain established wording unless its meaning becomes false or incomplete. The README must still change with affected commands, entry points, release-stage claims, or high-level capability families, while exhaustive detail remains linked rather than copied.
