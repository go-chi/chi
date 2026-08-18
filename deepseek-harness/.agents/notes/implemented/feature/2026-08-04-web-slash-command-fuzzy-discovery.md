# Agent Note: Web slash-command fuzzy discovery

Status: implemented

English | [中文](2026-08-04-web-slash-command-fuzzy-discovery.zh.md)

## Problem

The web command menu required a command-name prefix, so discovery failed when a user remembered the significant letters but not their exact positions. Broadening menu matching could make discovery easier, but command execution must remain exact and deterministic: an approximate line must never execute a nearby command.

## Decision

The `/` command source fuzzy-matches the typed query against command names as a case-insensitive ordered subsequence. Exact prefixes form the highest ranking class. Within each class, the strongest alignment score rewards separator boundaries and adjacent characters while penalizing leading characters and gaps; equal scores retain the host-directory and client-contribution order. Position filtering still removes argument-taking commands from inline menus before ranking.

The scorer uses dynamic programming in `O(query length × name length)` time and `O(name length)` memory per candidate. Candidate scoring stays client-side and examines names only; descriptions do not affect matching. Menu selection still dispatches the selected exact name, while space and Enter adjudication continue to require an exact command token.

## Alternatives considered

**Keep prefix-only matching.** Rejected because it preserves the recall failure that motivates the feature; `/cpt` cannot discover `/compact`.

**Match unordered characters or descriptions.** Rejected because unordered matches are difficult to predict, while description matches can surface commands whose visible names do not explain why they ranked.

**Use a general fuzzy-search dependency.** Rejected because this surface needs one constrained subsequence rule over a small command catalog; a configurable search index would add bundle weight and ranking behavior not used by the product.

## Consequences

Users can discover a command from remembered in-order letters, and ranking remains stable across identical catalogs. The score is deliberately heuristic: a separator-aligned match can outrank a match with a shorter raw span. Package tests pin each ranking factor and stable ties, while the assembled Web replay snapshot pins `/cpt` resolving to `/compact`. Exact execution semantics are unchanged.
