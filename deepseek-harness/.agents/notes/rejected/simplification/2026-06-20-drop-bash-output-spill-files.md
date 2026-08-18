# Agent Note: Drop bash full-output spill files

Status: rejected — full-output recovery is a real bash behavior. A future artifact/blob service may generalize it, but dropping spill files before that replacement would lose useful command output.

English | [中文](2026-06-20-drop-bash-output-spill-files.zh.md)

## Problem

`dsh-bash-local` keeps bounded in-memory output and spills large stdout/stderr streams into private temp files. That requires a private directory, random owner-only file creation, close-failure handling, byte-offset incremental reads, lossy read reporting, path rendering in model-facing text, and cleanup discipline. The tool then tells the model to read a local spill path when output was truncated.

This solves a real problem, but in a narrow and leaky way. A spill path is a process-local filesystem artifact exposed to model output, not a durable harness artifact with scoped access, retention, or UI affordances. It also complicates background-job reads because a lossy incremental read has to point at one or two spill files.

## Proposal

Keep tail truncation, drop full-output spill files. A bash result contains the bounded tail plus a clear truncation marker; no path is emitted. If users need full-output recovery, add a generic artifact/blob service with explicit ownership, cleanup, and UI rendering, then let bash attach large outputs to that service.

This proposal can land independently of [a generic long-running tool runtime](../../implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md). If background jobs stay, `bash_output` should still report that output was dropped, but without advertising a spill path.

## Acceptance criteria

- `CollectedOutput` no longer carries spill paths.
- `OutputCollector` keeps bounded buffers only and deletes the temp-file machinery.
- `renderResult()` reports truncation without a filesystem path.
- Tests cover tail truncation and no longer assert full-output file contents.
- Security guidance in [docs/defensive-patterns.md](../../../../docs/defensive-patterns.md) stops treating private spill files as a model-visible interface.

## What we give up

A model or user cannot recover the omitted prefix of a huge command output from a temp file. That is acceptable until there is a real artifact service. The current spill path is too much bespoke machinery for a feature whose lifecycle and permissions are not designed.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
