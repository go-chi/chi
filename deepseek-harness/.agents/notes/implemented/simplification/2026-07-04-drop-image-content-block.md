# Agent Note: Drop the `image` content block until a path can honor it

Status: implemented

English | [中文](2026-07-04-drop-image-content-block.zh.md)

## Problem

`ImageBlock` (`packages/llm/llm/src/types.ts`) had no production producer, and every consumer on every path DROPPED it: the DeepSeek adapter's serializer skipped image blocks (a documented MVP limitation), the pi-ai converter skipped them as unrepresentable, and the compaction estimator charged a flat token constant and rendered `[image]`. ACP independently rejected image prompt content. An `ImageBlock` constructed then would silently vanish from the provider wire — the vocabulary advertised a capability no path honored, which is the silent-data-loss shape AGENTS.md's defensive patterns warn against. The only constructors anywhere were tests pinning the skip/drop/estimate branches.

## Decision

Remove `ImageBlock`, its map entry, and image-specific branches from adapters and compaction. Update the owning vocabulary docs and generated references in the same change. Unknown extension blocks still exercise default branches, and ACP continues to reject inbound image prompt content independently of the harness vocabulary.

## Alternatives considered

### Why not keep it?

`ContentBlockMap` can reintroduce images when adapters and compaction support them. ACP may remain a text-only automation protocol. Keeping a core type whose only implementation is rejection would advertise an unusable surface; absence gives producers an immediate compile-time failure instead.

The documented fallback, should the slot ever return ahead of a full feature: keep `ImageBlock` but replace every silent skip with a loud rejection, and document that policy in the vocabulary — the silent drop was the one state with no defender.

## Verification

No harness `ImageBlock` is constructed outside Agent Note records. ACP's independent inbound-image rejection remains tested, while adapter, codec, and compaction default branches are covered with plugin-defined block types.

## Consequences

Re-adding a core vocabulary type later touches several packages at once — but that coordinated change is the shape a real multimodal feature needs anyway (adapter mapping and compaction pricing), and none of it existed to preserve.
