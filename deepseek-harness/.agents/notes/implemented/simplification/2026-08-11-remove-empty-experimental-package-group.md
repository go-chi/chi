# Agent Note: Remove the empty experimental package group

Status: implemented

English | [中文](2026-08-11-remove-empty-experimental-package-group.zh.md)

## Problem

The package hierarchy reserves `packages/experimental/` for prototypes and internal-only plugins, but no package has used the group. The empty group adds placement, dependency, promotion, and release rules without a current package or release mechanism that needs them.

The original group aimed to let the team share prototypes against the real plugin graph without implying product support. That need remains possible, but it does not justify a permanent repository category before a concrete package exists.

## Decision

The package hierarchy has no reserved experimental or internal-only group. Packages continue to live in groups selected for their current product role.

A concrete package that needs different release, stability, or dependency treatment requires a decision based on its actual consumers and release mechanism. That decision may reintroduce a dedicated group when it can also define and enforce the exclusion rules.

This note consolidates and supersedes the experimental-package-group decision, whose active triplet is removed with the empty directory.

## Alternatives considered

**Keep the empty group.** It provides an obvious future incubation location, but it also keeps repository rules with no current owner, package, or enforcement mechanism.

**Move the experimental rules into the general package instructions.** This preserves the policy without an empty directory, but makes every package change carry rules for a hypothetical package class.

**Put concrete experimental packages in product-role groups with README labels.** This preserves product-role colocation, but labels alone cannot enforce release and runtime-dependency rules. A future package can evaluate this option against its actual release mechanism.

**Treat every package as experimental until the first tagged release.** This applies a broad temporary status without providing durable treatment for packages that remain experimental after releases begin.

**Require prototypes to stay outside the repository.** This would lose access to the real plugin graph, examples, snapshots, and lifecycle checks. Removing the reserved group does not impose that restriction; a concrete prototype can establish the placement it needs.

## Consequences

The hierarchy loses an unused group and its special release and dependency policy. It also gives up a predeclared location for team discovery and a ready-made promotion path.

The first package that needs experimental or internal-only treatment must define where it lives, how releases exclude it, which runtime dependencies are allowed, and what condition promotes or removes it. A dedicated group can return when those rules have a current consumer and enforceable mechanism.
