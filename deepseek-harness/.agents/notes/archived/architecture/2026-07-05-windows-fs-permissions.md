# Agent Note: Windows write-permission semantics — inherited DACLs, not mode bits

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-05-windows-fs-permissions.zh.md)

The replacement-file decision in this record is superseded by [Windows DACL preservation](../bug-fix/2026-07-19-windows-atomic-write-dacl-preservation.md).

## Problem

`writeFileAtomic` in `@deepseek-ai/dsh-fs-local` protects write-in-progress content with POSIX mode bits: the staging directory is created `0o700`, the temp file is opened `0o600`, and new files default to `0o600`. On POSIX this keeps temporary content owner-only regardless of the parent directory's permissions.

Windows has no working equivalent behind the same API. Node's `chmod` there drives only the read-only attribute (every mode this package passes carries owner-write, so the calls are benign no-ops), and `stat().mode` reports synthetic `0o666`/`0o444` bits. The real security state is the file's DACL: a newly created file or directory inherits from its parent, while replacement needs the explicit handling owned by the superseding Agent Note.

## Decision

New Windows files use directory inheritance rather than synthetic mode bits: the staging directory is created inside the target's parent directory (`dirname(absolutePath)`), so it and the temp file inherit the destination directory's DACL. Replacement files follow the stricter [DACL preservation contract](../bug-fix/2026-07-19-windows-atomic-write-dacl-preservation.md).

Tests assert mode bits on POSIX only. Native Windows coverage pins the package-owned replacement behavior; new-file inheritance remains an operating-system contract rather than a machine-specific ACL allowlist.

## Alternatives considered

**Explicit owner-only DACLs for new files.** Rejected because they would break inheritance and surprise users whose project directories are deliberately shared. Replacement writes copy the target's existing DACL rather than inventing an owner-only policy.

**Test-side ACL verification.** A `Get-Acl` SID allowlist or `icacls` would verify Windows inheritance and the machine's `%TEMP%` ACL rather than package behavior; `icacls` also localizes well-known account names, making parsing locale-fragile.

**Skip `chmod` on Windows.** Platform-guarding benign no-op calls adds branches without changing behavior.

## Consequences

POSIX keeps owner-only temp content regardless of the parent directory. A new Windows target inside a broadly accessible directory inherits that accessibility by design; a replacement retains the target's narrower DACL when one exists.

Mode preservation across a replace degenerates to a no-op on Windows: a writable file probes as `0o666`, and replaying that through `chmod` leaves the read-only attribute clear. A read-only target cannot be replaced there because publication fails before the synthetic mode would matter.
