# Agent Note: Collapsed sidebar upper controls share one entry motion

Status: implemented
Archived: 2026-08-12

English | [中文](2026-08-12-collapsed-sidebar-shared-entry-motion.zh.md)

## Problem

The collapsed sidebar rail renders four upper controls owned by two packages: the shell owns the toggle and New Session, while the workspace region owns add and search. Their opacity timing matched, but their geometry did not. Right-aligned controls moved with the narrowing column while left-aligned controls stayed fixed, so add appeared slower than search even under the same fade.

The bottom settings control has a different role. It is pinned to the rail foot and must not join the upper controls' horizontal entry.

## Decision

At the rail settle point, the four upper 36px controls start from one left-anchored layout and share one `150ms` animation from `translateX(49px)` to their final 10px inset. The shell applies the translation to its toggle and New Session seats and once to the workspace region, so add and search inherit the same path without nested transforms. Opacity uses the same animation timeline.

The settings seat uses a separate opacity-only keyframe with the same duration and easing. A page that starts collapsed renders the rail without an entry animation, and reduced-motion mode disables both keyframes.

## Alternatives considered

**Keep every rail control fixed at its final inset.** This removes the mismatch, but it also removes the requested horizontal entry from the four upper controls.

**Animate each workspace button independently.** This would duplicate shell timing inside `ui-workspace` and could apply both a region and child transform. Translating the registered region once keeps animation ownership in the sidebar shell.

**Translate the settings control with the upper controls.** Rejected because settings is a bottom-pinned foot action, not part of the upper control sequence.

## Consequences

- Toggle, New Session, add, and search follow the same horizontal coordinates throughout collapse.
- Settings fades at its final horizontal coordinate.
- Static collapsed renders retain their final geometry without startup motion.
- Style tests pin the shared animation assignments, translation distance, base anchors, and settings exception.
