# Agent Note: Guarded-mutation errors append the recovery instruction at the model boundary

Status: implemented

English | [中文](2026-08-03-fs-tool-error-remedy.zh.md)

## Problem

Guarded `write` and `edit` failures reach the model with messages that state the condition but not the only correct recovery: `FS_STALE_VERSION` ("file changed since it was read") and `FS_NOT_OBSERVED` ("edit requires reading … first"). The model must guess that the recovery is a re-read (or a first read) followed by a retry, and the retry/permission/UI layers that route on the structured code see the same message text. The provider-owned messages are part of the storage seam's machine-oriented vocabulary ([filesystem capability seam](../architecture/2026-06-17-filesystem-capability-seam.md)), so the remedy cannot live there without leaking model-facing wording into every consumer of `FsError`.

## Decision

`dsh-tool-fs` owns a model-facing error wrapper, `remediateFsError` in `src/error.ts`, applied in `write.ts` and `edit.ts` after the sandbox denial mapping. It appends the recovery instruction to the two guarded-mutation codes and passes everything else through untouched:

- `FS_STALE_VERSION` (including a missing edit target, which shares the stale code) gains `— re-read the file, then retry`.
- `FS_NOT_OBSERVED` gains `— read the file, then retry`.

The structured `FsError` code is preserved so retry/permission/UI layers keep routing on it, and the original error chains as `cause`. Provider messages stay machine-oriented and unchanged.

In `edit.ts` the `fs/edit-intent` waterfall now sits inside the same `try` as the provider mutation, so the policy plugin's `FS_NOT_OBSERVED` refusal thrown from the intent slot also receives the remedy — both refusal paths reach the model with the same recovery wording.

## Alternatives considered

- **Append the remedy to the provider messages in `dsh-fs` / `dsh-fs-local`.** Rejected because those messages are machine-oriented seam vocabulary consumed by retry, permission, UI, and model-facing layers; model-facing wording belongs at the model boundary, where `dsh-tool-fs` already owns result formatting ([filesystem capability seam](../architecture/2026-06-17-filesystem-capability-seam.md)).
- **Add the recovery to prompt guidance instead.** Rejected because the failure arrives mid-task; a static instruction does not reliably reach the retry decision, while the error message is present exactly when the model must act.
- **Signal the remedy with a new `FsError` code.** Rejected because the two failures are the same conditions retry layers already handle; splitting the code would fork routing on identical semantics.

## Consequences

Model-visible text for the two codes changes; the `fs-policy-reject` keyless snapshot is re-recorded, and the READMEs of `dsh-tool-fs` and `dsh-fs-observation-policy` pin the exact appended text. Unit tests cover the wrapper directly (remedy text, code preservation, cause chaining, passthrough of other codes and non-`FsError` values) and the assembled tool paths assert the remedy reaches the model for both codes.

The [filesystem absence-observation follow-up](../bug-fix/2026-08-09-filesystem-absence-observation.md) makes the stale remedy actionable for external deletion. The failed reread still returns `FS_NOT_FOUND`, but records confirmed absence: edit then returns `FS_NOT_FOUND` without another stale remedy, while write retries as an atomic `createIfAbsent` and preserves any concurrent creator.
