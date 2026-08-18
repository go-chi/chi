# Agent Note: GUI pull request GIF evidence and assets-branch publication

Status: implemented
Archived: 2026-07-27

English | [中文](2026-07-26-gui-pr-gif-evidence-and-assets-branch.zh.md)

## Problem

A pull request that changes what a product user sees in the GUI is otherwise reviewed through prose and test names, neither of which shows the rendered result. The [browser-demo GIF recording](../../../skills/record-browser-gif/SKILL.md) skill produces truthful local GIFs but deliberately stopped at the local artifact, so each pull request that wanted to show one re-derived publication on its own — and committing the GIF to the pull request branch is never acceptable, because binary media in history bloats every future clone permanently.

The recording procedure itself also kept being re-learned failure by failure: screenshots written outside the browser tool's allowed roots or into missing directories fail at capture time, transient UI states polled across separate tool calls are lost because the turn settles between calls, substring completion predicates match the echo of the user's own prompt, and an inline environment-variable assignment on the encoder command expands too late to take effect.

## Decision

Every pull request that changes product-user-visible GUI behavior includes a demonstration GIF recorded with the [record-browser-gif skill](../../../skills/record-browser-gif/SKILL.md), with real provenance — a real server booted from that pull request's own branch tree, a real API key, and real model rounds — stated next to the embed. Fixture provenance is acceptable only when the user explicitly asked for it.

The GIF is published to a dedicated orphan assets branch — no parent commit, media only — never to the pull request branch; one assets branch serves a whole pull request series (existing branches: `code-mode-ui-assets`, `pr-613-assets`). Publication works in a shallow single-branch scratch clone, commits as `assets: <what it shows> gif (#<pr>)`, and the pull request body embeds the blob URL with the required `?raw=true` suffix. Assets branches are append-only: merged pull request bodies reference their URLs forever, so an assets branch is never rewritten or deleted.

Recording itself stays side-effect-free; publication is a bounded final step the skill performs only when the task includes attaching the GIF to a pull request. The [record-browser-gif skill](../../../skills/record-browser-gif/SKILL.md) remains the current contract for the recording half.

The skill folds in the operational lessons recording earned: frames go under `.playwright-mcp/`, ignored by the repository `.gitignore` and created before capture, because the browser tool writes only under its allowed roots and resolves relative names against the repository root; each pull request stages its own built tree with a fresh scratch workspace and a new session per scenario, and servers are stopped by PID rather than a broad process-name pattern; transient states are captured by driving a slow foreground operation and polling a concrete DOM marker inside one browser-script call; completion predicates match an exact-text element rather than a substring; and the encoder runs with `GIF_SKILL_DIR` exported on its own line, per-frame durations holding the settled state longest, and both a JSON-summary check and a visual read of the encoded GIF.

## Alternatives considered

**Commit the GIF to the pull request branch.** Binary media merged into the default branch stays in history for every future clone and fetch; a demo GIF's value ends at review while its cost never does.

**Attach the GIF as a GitHub upload.** Drag-and-drop `user-attachments` uploads are not available to a command-line workflow, cannot be re-created or audited from the repository, and leave the media's lifecycle outside repository control.

**Store GIFs with Git LFS.** LFS still couples media to the code branch's history, adds an infrastructure dependency to every clone and CI fetch, and buys nothing over an isolated branch that ordinary git already supports.

**One assets branch per pull request.** A branch per pull request sprawls the ref namespace and multiplies scratch clones during a series; one branch per series keeps publication a single push while staying isolated from code history.

**Keep publication out of the recording skill.** That was the prior state; it preserved a clean boundary but made every pull request re-derive the same procedure. The boundary survives as an explicit gate — publication runs only when the task includes attaching the GIF to a pull request — instead of as omission.

**Leave the GIF optional per pull request.** Optional evidence disappears under schedule pressure exactly where it matters most; a GUI change reviewed without a recording asks reviewers to imagine the rendered result or rebuild the branch themselves.

## Consequences

Every GUI pull request carries visual evidence with stated provenance, and reviewers see the change without rebuilding the branch. Repository history stays free of media; the cost moves to append-only assets branches that grow forever, stay cheap to clone shallowly, and can never be deleted. Mandatory real-provenance recording adds a real-key, real-model round to every GUI pull request's workflow — deliberate, because that run is the evidence. The recording half remains locally reversible, and a GIF request whose task does not include attaching it to a pull request still ends at the verified local artifact.
