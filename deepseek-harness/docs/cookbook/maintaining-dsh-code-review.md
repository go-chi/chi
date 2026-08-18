# Maintaining the dsh-code-review skill

English | [中文](maintaining-dsh-code-review.zh.md)

The [`dsh-code-review`](../../.agents/skills/dsh-code-review/SKILL.md) skill is kept current by a single designated operator running a private periodic maintenance tool. This cookbook is the entry point for that operator — and for anyone taking over the role — and for repo contributors who want to understand why skill updates arrive as small periodic PRs rather than one-off audits. The workflow itself is specified in the [human-review skill-maintenance Agent Note](../../.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md).

## What the maintainer receives

The operator invokes the wrapper manually, daily with a two-UTC-day overlap; a manual weekly recovery run uses a seven-day window. The workflow:

1. It selects PRs merged in the chosen window (default two UTC days for the daily cadence, seven for weekly) whose merge commit is reachable from `origin/master`. PRs whose merge commit is not reachable (stacked branches whose parent was squashed) or that exceed a 250-commit acquisition cap are logged to `skipped-pulls.json` and skipped rather than aborting the run.
2. It collects pre-merge human review feedback with commit anchors (inline comments and review submissions), then compares feedback-time and final landed PR patches. It does not acquire PR conversation comments because current GitHub state cannot give them a force-push-safe feedback-time baseline, and it excludes target-branch-only changes from adoption evidence.
3. Two independently configured reviewer adapters classify who wrote each item and whether the change adopted it, then classify agreed-adopted items against the current skill.
4. The primary adapter drafts a complete revised `SKILL.md`; both adapters review the same diff; blocking findings loop until both approve.
5. `pnpm run doc-sync` and `pnpm run lint` run against the candidate before the tool declares success.

Each run stores its artifacts on the operator's machine. The saved diff, candidate `SKILL.md`, and promotion manifest land under `~/dsh-code-review-outputs/` named by timestamp. The manifest records the source master commit and skill blob, source feedback IDs and URLs, landed evidence ranges, adapter verdicts, and gate results; raw per-adapter I/O stays in a private temp directory whose path is written to the notification and to the daily log under `~/Library/Logs/dsh-code-review-maintainer/`. The maintenance worktree itself is restored clean after every run so the operator is never tempted to edit the maintenance copy in place.

## What the operator does with a candidate diff

When a run produces a candidate, a macOS notification arrives with a `dsh-code-review-promote <timestamp>` hint.

1. **Read the diff on its own merits.** Do not defer to "the reviewers approved"; the maintainer contract is that the operator makes the final decision. Look for checklist bloat, historical prose, unsupported extrapolation from a single incident, and duplicated coverage with existing skill or authoritative-doc content.

   ```sh
   ls ~/dsh-code-review-outputs/                         # every candidate ever produced
   less ~/dsh-code-review-outputs/2026-07-16T02-00-00Z.diff
   less ~/dsh-code-review-outputs/2026-07-16T02-00-00Z.SKILL.md
   less ~/dsh-code-review-outputs/2026-07-16T02-00-00Z.manifest.json
   ```

2. **Cross-check against the run artifacts.** The promotion manifest maps each proposed rule to source feedback and landed evidence; detailed per-adapter I/O, consensus, and adopted evidence live under the run's private temp directory (path shown in the log). Spot-check at least one candidate: does the linked human comment actually support the added rule? Does the linked PR actually adopt it?

3. **Decide one of three:**
   - **Discard.** Delete the saved candidate. The tool re-considers the same feedback on the next run under whatever the current skill then says.

     ```sh
     rm ~/dsh-code-review-outputs/2026-07-16T02-00-00Z.{diff,SKILL.md,manifest.json}
     ```
   - **Batch.** Keep the candidate aside if the update is small and could combine with a future one. The source-skill check still applies; rerun the analysis or manually rebase and re-review the diff if `master` changes first.
   - **Promote.** From a clean `master` checkout of the repo, run the promote helper. It refreshes `master`, verifies that the current skill matches the recorded source blob, applies the saved diff, and opens a draft PR whose body lists the source feedback URLs or IDs, landed commit range, originating run, checks, and operator edits. It stops on skill drift rather than overwriting newer guidance; the operator still reviews the PR on GitHub and either merges it or closes it.

     ```sh
     cd ~/path/to/deepseek-harness   # clean master
     dsh-code-review-promote 2026-07-16T02-00-00Z
     ```

4. **Do not commit adapter output verbatim.** Small edits during promotion — tightening wording, removing an example that only makes sense with the source PR's context, folding a rule into an existing one — are expected and preserve the "reviewer judgment" the workflow depends on. Amend the branch before merging.

## When a run produces no candidate

That is the common case after every nonempty classification stage has produced at least one valid adapter result. The tool records "no candidate" in its daily log, sends no notification (to avoid alert fatigue), and moves on. Days without a skill update are the workflow behaving correctly, not a stall.

## Interruptions and handoff

The mechanism lives on one machine. Interruptions the operator handles as they arise:

- **Daily run missed.** The two-day overlap window catches one skipped day automatically; longer gaps recover by running the wrapper manually with `DSH_CODE_REVIEW_SINCE=<Nd>`. Overlapping windows are idempotent: guidance already in the current skill is classified `covered` and does not re-enter as a candidate.
- **Adapter provider outage.** The tool refuses to run when the two reviewer commands resolve to byte-identical executables. A single batch whose adapter response fails schema or id validation is failed closed at the batch level (every item in the batch marked unclear) and the run continues; the raw output is preserved for debugging. If either adapter produces no valid result for any nonempty batch in an operation, the run fails, writes a failure record, and notifies the operator; it never collapses a total-provider outage into "no candidate."
- **Handoff to another maintainer.** Open a follow-up Agent Note that supersedes the current one: either move the mechanism into the repository or record the new operator's private setup. Do not silently transfer the tool — the "single-maintainer bus factor" in the Agent Note's Risks section is the reason the handoff needs a documented decision.

## Where the operator's private setup lives

The tool source, reviewer adapters, provider credentials, and scheduler are the operator's private infrastructure and are outside this repository by design (see the Agent Note's "Where the mechanism lives" section). This cookbook and the Agent Note describe **what the workflow guarantees**; **how** those guarantees are implemented is a private-infrastructure concern. If you are the new operator, the Agent Note's `## Proposal` sections are the specification you build against.
