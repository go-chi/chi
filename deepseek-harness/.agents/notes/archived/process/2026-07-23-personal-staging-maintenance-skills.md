# Agent Note: Personal staging maintenance skills

Status: implemented
Archived: 2026-08-10

English | [中文](2026-07-23-personal-staging-maintenance-skills.zh.md)

## Problem

Personal dsh customizations need a repeatable way to locate the installed source, isolate task work, serialize integration, and incorporate upstream changes without rewriting the checkout used by running sessions. User-local instructions solve this for one installation but cannot guide other users or remain synchronized with repository installer behavior.

## Decision

The repository distributes [`dsh-customize`](../../../../skills/dsh-customize/SKILL.md), [`dsh-upgrade`](../../../../skills/dsh-upgrade/SKILL.md), and [`dsh-upstream-customization`](../../../../skills/dsh-upstream-customization/SKILL.md) from its root `skills/` directory. Their descriptions name both the operation and user requests that select it. The shipped TUI supplies that directory to the local skill provider at startup, below project and user roots in discovery priority. The workflows derive the active checkout and staging branch from the installed launcher rather than a user-specific path or branch name, defer to repository-local instructions, require task worktrees, and serialize staging mutations with the staging worktree's established `.agents/merge.lock`.

Before rebasing, an upgrade inspects the Git log and commit ranges to identify incoming upstream changes, personal commits, duplicates, and likely conflicts. It drops customizations already supplied upstream; when only a documentary local diff remains for such a customization, it also drops that account unless it adds an independently useful current contract absent upstream. Each attempt uses one UTC basic timestamp for its independent `dsh-staging-<timestamp>` sibling clone, local `dsh-upgrade/prepare-<timestamp>` branch, new `dsh-staging/<timestamp>` branch, private upstream and recovery refs, and launcher backup. The sibling name does not derive from the current directory name, and collisions fail rather than acquiring ad hoc suffixes. The workflow derives the current DSH process source from the process command and runtime environment rather than the shell working directory, then treats the repository and checkout behind the installed launcher as immutable except for holding its existing merge lock.

After validation in the independent clone, the workflow creates and verifies the timestamped staging branch, then atomically moves the launcher once from the unchanged old staging checkout to the new staging checkout. The launcher never targets a preparation, feature, review, publication, or detached checkout. Failure before cutover leaves the installed checkout and launcher unchanged; failure after cutover restores and verifies the launcher backup. The old staging checkout, its branch, the recovery ref, and the launcher backup remain available until a restarted process proves that DSH runs from the new staging branch and the user explicitly approves rollback cleanup.

`dsh-upstream-customization` owns upstream publication independently from local maintenance and upgrades. It recommends bug fixes, additive non-conflicting plugin features, and visual improvements; intrusive changes require maintainer approval first. At the end of an upgrade, the agent classifies remaining customizations, explains their upstream value, recommends whether to propose each one, and asks which named candidate the user wants to upstream. Only that selection loads the publication workflow; each feature still requires explicit approval before a push or draft PR. Approved changes start from current upstream `master` without unrelated personal commits. Draft PRs for TUI features preferably include a screenshot from the assembled application after credentials and personal data are removed. `dsh-customize` requires interactive TUI behavior to be exercised in a dedicated tmux session before integration.

## Alternatives considered

**Keep the workflows user-scoped.** This preserves personal flexibility but prevents other users from discovering the same safety rules and lets the workflow drift from the installer shipped by the repository.

**Rebase the active staging checkout in place.** This is simpler but changes many files during preparation, can disrupt new dsh launches, and cannot provide atomic publication or an unchanged rollback checkout.

**Update the existing staging checkout after moving the launcher elsewhere.** This retains one staging path but requires a mid-upgrade launcher target that is not a staging branch and still rewrites a checkout that may host a running process.

**Lock only the final branch switch.** This shortens lock duration but permits a customization merge against the old base while the rebase is being prepared, invalidating the prepared history.

**Open one upstream PR for all personal changes.** This reduces branch management but publishes unrelated customizations and removes the user's per-feature approval boundary.

## Consequences

Upgrade preparation holds the installed staging merge lock while dependencies and checks run, so local customization integration waits for a consistent result. One upgrade creates an independent timestamped clone and staging branch, performs one atomic launcher cutover, and requires one restart afterward; it never writes into the repository or checkout behind the launcher except to hold its existing lock. Each workflow records preconditions, repeats them before mutation, inspects state after interrupted mutations, restores the launcher backup on cutover failure, reruns failed checks after correction, and reports final state. The old staging checkout remains rollback storage until explicit user-approved cleanup. Checked-in evaluations cover selection, process-source protection, unsafe repository states, rollback, and publication authorization; repository documentation checks validate skill links and formatting, while technical review remains responsible for Git and filesystem correctness.
