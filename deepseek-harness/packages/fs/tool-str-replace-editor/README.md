# @deepseek-ai/dsh-tool-str-replace-editor

English | [中文](README.zh.md)

Standalone model-facing `str_replace_editor` over `ctx.fs`. It can be composed with persistent Bash, one-shot Bash, sandboxed Bash, or another terminal surface.

## Config

| Key | Default | Meaning |
|---|---:|---|
| `maxOutputChars` | `16000` | Prefix characters retained for file and directory views. |
| `description` | Editor command guide | Model-facing tool description. |

## Tool

The schema provides `view`, `create`, `str_replace`, and `insert` over absolute paths. File views use one-based line numbers and preserve content tabs, so displayed text remains valid literal replacement input; directory views omit hidden, dependency, and Python-cache entries and descend two levels. A metadata miss from `view`, `str_replace`, or `insert` records confirmed absence before returning `FS_NOT_FOUND`, so a later `create` can recover an externally deleted path through the mounted policy's guarded-create flow; absence never authorizes `str_replace` or `insert`. Replacement requires one unique literal match and reports errors only in the public `old_str` vocabulary. Insert follows the selected zero-based insertion boundary without adding an implicit trailing newline. Mutations preserve tabs outside the requested edit.

## Model Experience

### Tool schema

#### What the model sees

The generated [`str_replace_editor` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-str-replace-editor), including the configured `description`. The plugin contributes no standalone system-prompt section.

#### Token effect

Fixed schema cost while `str_replace_editor` is visible.

#### KV Cache effect

Prefix-stable while the configured description and schema remain unchanged.

### Tool results

#### What the model sees

Views return numbered text or a shallow directory listing. Calls expose file locations, and create/replace calls expose diff cards to presentation surfaces. Mutations return concise confirmations. Long views keep their prefix and append a clipping notice.

#### Token effect

Data-dependent and bounded by `maxOutputChars` plus the fixed clipping notice.

#### KV Cache effect

Append-only tool results follow the reusable request prefix.

## Known Limitations and Deferred Work

- Operations target UTF-8 text; binary files are unsupported.
- `str_replace` intentionally rejects zero or multiple matches and has no `replace_all` argument.
- Every mutation goes through `fs/write-intent` or `fs/edit-intent`, resolves the current session sandbox policy, and delegates enforcement to the mounted filesystem and policy plugins.
