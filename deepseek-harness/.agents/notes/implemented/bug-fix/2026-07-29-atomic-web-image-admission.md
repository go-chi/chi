# Agent Note: Atomic Web image admission

Status: implemented

English | [中文](2026-07-29-atomic-web-image-admission.zh.md)

## Problem

Image prompt admission and `session.selectModel` each read session modality state across asynchronous model and attachment lookups. Without one ordering boundary, an image prompt could validate an image-capable target while a concurrent selection installed a text-only target, or selection could miss a prompt after inbox dequeue but before its durable message event. Scanning the immutable event log avoided the second race but permanently blocked a text-only selection even after compaction removed the image from current model history.

## Decision

Each live Web agent has one private promise chain shared by image-bearing prompt admission and model selection. A failed operation settles its caller normally and leaves the chain usable. Text-only prompts bypass the chain because they cannot change the modality constraint.

The pending-publication set records a queued occurrence at dequeue and a steering occurrence already at enqueue (steering items never enter the queued UI mirror), and retains each until its matching `user/message` or `steering/message` event publishes. If admission ends without publishing, the transition to idle retires the entries; inbox discard retires the listed work, and session disposal retires every remaining entry. Model selection checks that set, the queued UI mirror, and `Session.deriveMessages()`, which is the current model-visible history after compaction.

Provider adapters remain the final enforcement boundary. The host ordering only prevents its mutable route and pending image state from contradicting each other before request assembly.

## Alternatives considered

**Scan every immutable session event.** This catches published images but treats compacted-away content as permanently model-visible, preventing a valid later switch to a text-only route.

**Retire the pending mirror at inbox dequeue.** Dequeue precedes the durable message append and leaves the exact interval in which model selection can miss both pending and published state.

**Serialize every prompt and session mutation.** Text-only prompts and unrelated session operations cannot introduce an image requirement. A broader lock would add latency and ownership without closing another modality race.

## Consequences

An image prompt and a concurrent model selection have deterministic order, and a text-only target cannot strand an image that has been admitted but not yet published. Selection may wait for an in-flight image admission, while unrelated prompts retain their existing concurrency. Compaction can make a text-only target valid once no pending or derived image remains.
