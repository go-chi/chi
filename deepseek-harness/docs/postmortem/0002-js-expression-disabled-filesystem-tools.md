# Post-mortem 0002: Filesystem snapshot tools were permanently disabled

English | [中文](0002-js-expression-disabled-filesystem-tools.zh.md)

Status: resolved

## Executive summary

The ACP example attempted to enable filesystem plugins conditionally with `disabled: !!js ...`, but Cordis evaluates JavaScript expressions only inside plugin `config`. The raw expression object was truthy, so the filesystem stack was always disabled. Snapshot refresh then accepted `UNKNOWN_TOOL` results as new expected outputs. The fix uses an explicit filesystem overlay and adds static-config and snapshot-result guards.

## Summary

The default ACP composition is intentionally bash-only because its sandbox cannot confine in-process filesystem providers. Filesystem snapshot scenarios still need `read`, `write`, and `edit`, so their plugins were placed in the default `cordis.yml` with a `disabled` expression intended to enable them only for full-access launches and snapshots.

Cordis Include parsed each `!!js` scalar into an expression object. The Loader recursively interpolated the plugin's `config`, but consumed entry metadata such as `disabled` directly. Every filesystem entry therefore saw a truthy object and remained disabled in every mode.

## Impact

Seven filesystem scenarios and the mixed workspace-edit scenario called tools that were absent from the registry. Their structured session logs carried `ToolNotFoundError` with code `UNKNOWN_TOOL`, while stdout rendered generic failed tool cards. The snapshot suite passed because both outputs matched the refreshed fixtures; it proved deterministic replay of the regression rather than successful filesystem behavior.

The live confined default did not gain unintended filesystem access. A naive interpolation fix would have created that risk: permission presets update bash sandbox and approval state at runtime, but cannot mount, unmount, or confine the filesystem stack.

## Timeline

- PR #261 consolidated ACP compositions and refreshed the filesystem snapshots while introducing conditional filesystem entries.
- All unit, coverage, snapshot, documentation, build, and hygiene checks passed.
- Review of the refreshed filesystem expected outputs found generic failed cards and structured `UNKNOWN_TOOL` results.
- A real Loader boot confirmed that every `disabled` value remained an expression object and every filesystem fiber was absent.

## Root cause

The implementation assumed `!!js` applied to an entire Loader entry. It applies only to `entry.options.config`: `Entry._resolveConfig()` interpolates that field, while `Entry.disabled` tests `entry.options.disabled` without interpolation. The YAML tag was syntactically valid, so loading produced no diagnostic.

The snapshot framework treated any deterministic transcript as valid behavior. Header pins verified the composed tool schemas, but the filesystem scenarios shared a pin from the default composition and therefore did not independently prove that their required tools were registered. Refresh rewrote the expected stdout and session logs before any semantic assertion rejected missing tools.

## Guardrails added

- Filesystem scenarios boot `fs.cordis.yml`, an explicit fixed full-access overlay with a paired replay config and its own request-header class.
- [`AGENTS.md`](../../AGENTS.md) and the [Cordis primer](../cordis-primer.md#loader-configuration) state that `!!js` is valid only under plugin `config` and conditional composition uses overlays.
- `verify-cordis-config` parses repository Cordis YAML and rejects expression nodes in Loader entry metadata, including include patches and inserted entries.
- `dsh-acp-snapshot` rejects structured `UNKNOWN_TOOL` results in fresh runs and committed session fixtures before they can be committed as expected outputs.

## Lessons

- A syntactically accepted configuration value is not necessarily evaluated at that location; document and verify exactly which fields are interpolated.
- A snapshot refresh is fixture production, not correctness review. Semantic impossibilities such as a missing registered tool need assertions independent of the expected output.
- Permission controls must describe only the capabilities they actually govern. Composition-time filesystem access cannot follow a runtime bash-only preset safely.
