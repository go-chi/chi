# Agent Note: Periodic human-review maintenance for dsh-code-review

Status: proposed

English | [中文](2026-07-13-human-review-skill-maintenance.zh.md)

## Problem

The `dsh-code-review` skill records failure modes that require reviewer judgment, but one-off audits are expensive to repeat and easy to scope inconsistently. Treating every comment as a lesson produces checklist bloat; treating merge, thread resolution, or an author's “fixed” reply as proof of adoption promotes feedback that the final code may not implement. The maintenance process needs enough evidence and independent review to fail closed without requiring a webhook service, durable event state, or automatic repository promotion before the workflow has proven useful.

## Proposal

Periodic out-of-repo maintenance. A private tool, kept on the skill maintainer's machine rather than committed to this repository, runs against a clean full-history checkout at refreshed `origin/master`. The intended scheduler runs daily with a two-UTC-day overlap; manual runs accept another `--since` duration or repeated `--pr` arguments for an explicit set. The scan is idempotent against the current skill and stores no repository cursor. The only repository file changed by promotion is [.agents/skills/dsh-code-review/SKILL.md](../../../skills/dsh-code-review/SKILL.md); the draft PR lists the source feedback URLs or IDs and adoption evidence without exposing the private adapter logs.

```mermaid
flowchart TD
  A["Maintainer or scheduler runs the tool on origin/master"] --> B["List PRs merged in the overlap window"]
  B --> C["Collect pre-merge User feedback and final PR evidence"]
  C --> D["Two reviewers verify the author and adoption"]
  D --> E{"Both confirm human-authored and adopted?"}
  E -- "No" --> F["Exclude or retain as unresolved"]
  E -- "Yes" --> G["Two reviewers classify against the current skill"]
  G --> H["Draft a complete candidate from agreed guidance"]
  H --> I["Two reviewers inspect the same skill diff"]
  I -- "Blocking finding" --> J["Bounded revision loop"]
  J --> I
  I -- "Both approve" --> K["Run documentation and lint checks"]
  K --> L["Leave a reviewed local working-tree diff"]
```

### Acquisition contract

Each selected PR is filtered before any feedback is retrieved: its merge commit must be an ancestor of `origin/master`. Merge-commit reachability is the sole eligibility check — a stacked PR whose direct base is a feature branch is admitted whenever the base has since reached master, because the code the reviewer commented on is now on master regardless of the intermediate stack. The tool also resolves the landing merge's target parent; a landing shape it cannot reconstruct is logged to `skipped-pulls.json` and skipped. A single PR that fails preflight, acquisition, or evidence collection is skipped rather than aborting the whole run. The search stage fails loud when the window would exceed GitHub's 1,000-result search cap so no merged PR is silently omitted. The acquisition stage reads complete paginated connections for inline review comments, review submissions, and PR commits. PR conversation comments are not acquired because current GitHub state cannot prove which surviving commit preceded them after a force-push, so the adoption contract would exclude them unconditionally. The workflow admits acquired feedback only when GitHub reports the actor `type` as `User`, and only when both creation and last-edit timestamps strictly predate the PR merge (an equal-timestamp edit is treated as post-merge); review submissions use GraphQL `lastEditedAt` because the REST representation omits edit time.

### Adoption evidence

Each feedback item carries a stable source ID and bounded change evidence. When the reviewer's `commit_id` still belongs to the PR (force-push fail-closed), the tool selects the latest PR commit whose committer timestamp strictly predates the feedback as the baseline — not the reviewer's clicked commit, which may be an older commit. It never compares that baseline directly with the landing merge: such a diff includes unrelated changes from an advancing target branch. Instead, it gives the adoption reviewers two PR-specific patch snapshots. Let `B` be the feedback baseline, `T` the landing merge's target parent, and `M` the landing merge. The feedback-time snapshot is the tree diff from `merge-base(B, T)` to `B`; the final snapshot is the tree diff from `T` to `M`. A target-only change therefore appears in neither PR patch, while a change added to the PR after feedback appears only in the final snapshot. Force-pushed reviews, feedback that predates every surviving PR commit, and landing shapes whose target parent cannot be reconstructed are deterministically classified `unclear` before any reviewer sees them. Merge status, a resolved thread, an author's “fixed” reply, or a same-file edit is context rather than adoption proof; the PR author's own comments never reach the adapter as they cannot be adoption of themselves.

### Dual-reviewer classification and drafting

Two independently configured reviewer adapters classify who authored every eligible item (`human-authored`, `forwarded-automation`, or `unclear`) and whether the change adopted it (`adopted`, `rejected`, or `unclear`). Only matching `human-authored` plus `adopted` verdicts proceed. The adopted set then receives a second independent classification against the current skill: candidate, already covered, implementation-specific, or not feedback. A singleton may qualify; recurrence is not required. Disagreement receives one bounded re-evaluation and remains visible in run artifacts if unresolved. A single batch whose adapter output fails schema or id validation is failed closed at the batch level — every feedback item in it is marked unclear and routed to `excluded` — rather than aborting the whole run; the offending raw output is preserved under the run's private artifacts for debugging. If either adapter returns no valid result for any nonempty batch in an operation, the run exits non-zero and emits a failure record instead of reporting “no candidate.”

The primary adapter drafts from structured agreed guidance, never raw review text. It remains tool-free and read-only by adapter-author contract: it returns complete candidate file content, which the tool validates before writing the sole target. Both adapters then review the same complete skill diff; blocking findings return to a bounded revision loop, and both must approve the same revision. The tool rejects staged changes and edits outside the target skill both before running the documentation and lint gates and again before reporting success, so a gate or concurrent process that adds another path cannot slip through. It restores its own write on failure using best-effort compare-and-swap so a concurrent maintainer edit is not overwritten. On success it saves a candidate bundle containing the source `origin/master` commit, source skill blob ID, reviewed diff, complete candidate, source feedback IDs and URLs, landed evidence ranges, adapter verdicts, and gate results; it never commits, pushes, opens, or merges a PR.

### Reviewer adapter protocol

Each private executable receives a byte-bounded, versioned JSON request on stdin and returns byte-bounded, schema-conforming JSON on stdout. The tool refuses to run when the two reviewer commands resolve to byte-identical executables — a minimum-bar mechanical check; guaranteeing that primary and secondary are backed by independent providers or models is the deployment operator's responsibility. The `access` and `tools` fields are contract markers on the adapter author, not an OS sandbox: reviewer subprocesses spawn with a scrubbed environment, `cwd` set to a private run directory rather than the repository root, and feedback wrapped in a nonce-tagged `<untrusted-feedback nonce="…">` block that every prompt instructs the model to treat as data; the 128-bit nonce prevents an untrusted body from forging the closing tag. Every subprocess uses bounded, abort-aware process-tree cleanup. Adapter authors implement each operation as pure read-only inference — even the `edit` operation returns complete candidate content in JSON, which the tool validates and writes to the sole target. Every production `git`/`gh`/gate spawn also uses the scrubbed environment so a pre-push hook's routing variables cannot silently redirect the maintainer. Candidate writes and the failure rollback use best-effort compare-and-swap against the last written content; the rollback also unstages the target so an adapter- or gate-staged candidate cannot survive a failed run into a later commit.

### Promotion contract

The promote helper starts from a clean checkout at refreshed `origin/master` and refuses to apply a candidate when the current skill blob differs from the bundle's recorded source blob. The operator then reruns the maintenance analysis or manually rebases the diff and repeats the candidate review; the helper never replaces a newer `SKILL.md` with stale complete-file output. After applying a current candidate, it opens a draft PR whose body lists the source feedback URLs or IDs, the landed commit range used as adoption evidence, the originating run, gate results, and any operator edits. Raw adapter prompts and responses remain private, but repository reviewers receive those concrete inputs so they can judge whether each proposed rule follows from adopted human feedback.

### Where the mechanism lives

The tool source, adapter binaries, provider credentials, and intended daily scheduler are kept private to the maintainer's machine rather than committed to this repository. This document specifies the protocol; the reference implementation is private infrastructure. The mechanism serves a single skill maintained by a single operator, so the ongoing cost of vetting mechanism edits through repository review outweighs the benefit of committing the tool and its history. If the mechanism is ever handed off to a second maintainer, that handoff is a follow-up Agent Note that revises this decision — the operator doc at [docs/cookbook/maintaining-dsh-code-review.md](../../../../docs/cookbook/maintaining-dsh-code-review.md) is the entry point for anyone taking over.

## Alternatives considered

- **Ship the tool inside this repository.** Rejected for a single-maintainer scope: repository maintenance overhead (typecheck, lint, coverage, cross-cutting refactors) would exceed the value of committed source and review history. Retained option for a later handoff.
- **Record every feedback-time PR head** — rejected: it improves causal isolation but requires a continuously running observer, durable event state, retries, and force-push reconciliation. Periodic maintenance uses reviewed-commit evidence where available and fails closed on broader whole-PR evidence.
- **Persist a processed-PR cursor** — rejected: an overlapping time-window scan is cheap and naturally idempotent against the current skill, while cursor state creates recovery and missed-event problems.
- **Run on every new comment** — rejected: review waves produce many related comments and lack the final artifact needed to judge adoption.
- **Treat merge or thread resolution as adoption** — rejected: a PR can merge with rejected, superseded, or intentionally unresolved feedback.
- **Create or merge repository changes automatically** — rejected: the tool first needs a track record of useful periodic output. The maintainer inspects and promotes the local diff through normal repository review.
- **Learn from bot findings that were fixed** — rejected: the source contract is human review feedback. Author type is filtered before analysis, and human accounts forwarding automated findings are excluded by the author check.
- **Use one reviewer as author and final judge** — rejected: independent verdicts expose unsupported generalization before it reaches the skill.

## Acceptance criteria

Promotion from `proposed/` to `implemented/` requires all of the following to be observed in a real end-to-end run against this repository:

- The private tool runs from a clean detached checkout at refreshed `origin/master` and either reports "no candidate" or produces a working-tree diff limited to `.agents/skills/dsh-code-review/SKILL.md`. **Observed on 2026-07-15:** 62 merged PRs scanned, 5 skipped (unreachable merge commit or >250-commit acquisition cap), 426 human feedback items considered, 0 candidates surfaced.
- Both reviewer adapters are independently configured (distinct providers or models) and complete an analyze / adopt / review pass without user intervention. **Observed on 2026-07-15:** distinct primary/secondary adapters completed adoption + analysis in ~8 minutes; batch fail-closed handled one adapter id-hallucination without aborting the run.
- A scheduler triggers the tool without an interactive terminal, and a candidate diff (or a "no candidate" record) reaches the operator through a durable notification channel.
- A controlled acquisition case advances the target branch with a feedback-matching change after the feedback baseline; the reviewer evidence excludes that target-only change while retaining a later PR-owned change.
- The promote helper rejects a candidate after the source skill changes, and a current candidate opens a draft PR with the source feedback IDs, adopted commit range, originating run, checks, and operator edits defined above.
- At least one candidate diff produced by this workflow is inspected by the operator and promoted to `master` through a normal repository PR review. That PR is the evidence that the workflow can turn adopted feedback into shipped skill guidance.

## Risks

- **Causality inferred from committer timestamps.** The feedback-commit baseline is selected by comparing GitHub commit timestamps with feedback creation timestamps; committer clock skew and rewrites still leave a residual false-adoption window. Cross-referencing GitHub's PR event stream would tighten this but requires event acquisition beyond the scope of the periodic tool.
- **Two-non-candidate classifications routed to `excluded` without a dispute round.** When both classifiers say "not a candidate" but disagree on which non-candidate reason applies (for example `covered` vs `specific`), the item is excluded rather than re-evaluated. Both classifiers agree the item does not become new reviewer behavior, so a dispute round would not change the outcome.
- **Dual-reviewer independence beyond byte-hash distinctness is a deployment contract.** The tool refuses to run when the two commands resolve to byte-identical executables, but cannot verify that two distinct wrappers back different providers or models. Operators must configure independent primary and secondary adapters.
- **Best-effort compare-and-swap for candidate writes and rollback.** File-based CAS on POSIX is not truly atomic; the window is one event-loop tick. The tool targets single-user periodic maintenance and a truly concurrent editor is out of scope.
- **Single-maintainer bus factor.** Because the mechanism lives on one machine, its interruption stops skill maintenance entirely until the operator restores service or hands off to a new maintainer through a follow-up Agent Note.
