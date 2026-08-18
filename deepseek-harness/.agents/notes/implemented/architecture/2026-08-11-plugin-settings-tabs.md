# Agent Note: Feature-owned tabs in Plugins settings

Status: implemented

English | [中文](2026-08-11-plugin-settings-tabs.zh.md)

## Problem

Plugin configuration and the read-only Loader inventory each registered a top-level `settings.section`. They described the same Plugins domain but occupied two navigation rows, split search and configuration into unrelated pages, and gave the Settings shell no principled way to present them together. Combining their components directly would instead make one feature plugin import and own the other feature's data lifecycle.

## Decision

`@deepseek-ai/dsh-client-ui-settings-plugins` owns the single `settings.section` contribution with id `plugins`. It renders the shared title and compact tab chrome, declares the root-scoped list slot `settings.plugins.tab`, and projects that ledger's id, order, and locale-following label into its tabs. The slot's canonical type lives in `ui-settings`, so a tab contributor depends on the Settings domain contract rather than on another feature plugin.

The section owner contributes a `configurable` tab that declares the existing nested `settings.plugin.item` list. Configuration cards keep their namespace bindings, draft state, validation, and writes unchanged. `@deepseek-ai/dsh-client-ui-settings-plugin-inventory` contributes an `all` tab to `settings.plugins.tab`; its Host Loader observer, generated Remote namespace, DTO, and search semantics remain unchanged. Disabled inventory entries omit the redundant unmounted runtime state from summaries and details, while enabled entries continue to expose their Cordis phase.

The first ordered tab is selected by default. A tab mounts only when first selected and then remains mounted but hidden while the Plugins section stays mounted. This delays the inventory RPC until the user opens **Plugin list** and preserves drafts, search text, disclosure state, and the fetched snapshot while switching tabs. Closing Settings unmounts the section, so reopening it obtains a fresh inventory snapshot when that tab is selected again.

Both registrations use `ctx.slots.inject()`. If the section declarer unloads, the tab declaration and every contribution collapse with it; redeclaration lets each feature re-register without a static import or activation-order dependency.

## Alternatives considered

**Keep two Settings navigation rows and only rename them.** Rejected because the duplication is structural, not copy-related: both pages still represent the same Plugins domain and compete for navigation space.

**Import the inventory component into `ui-settings-plugins`.** Rejected because the configuration plugin would then own another plugin's Remote dependency and lifecycle. It would also turn an optional browser contribution into a package-level dependency.

**Hard-code the two tab labels and components in the section owner.** Rejected because a third feature would require editing the owner, and HMR teardown could leave chrome for a contribution that no longer exists. The slot ledger already provides identity, ordering, localization, and cascade semantics.

**Move Plugins aggregation into `ui-settings-general`.** Rejected because the Settings shell owns generic navigation and modal chrome, not feature content. Adding Plugins-specific tabs there would make every future Plugins view a shell change.

## Consequences

Settings has one Plugins navigation row, ordered before Agent Presets, with **Plugin configuration** and **Plugin list** tabs. Agent Presets remains an independent section because it edits per-session agent compositions rather than the live Host Loader tree.

Feature ownership remains explicit: `ui-settings-plugins` owns the Plugins page and editable cards, `ui-settings-plugin-inventory` owns the read-only inventory view, and the Host/RPC path does not change. A new Plugins view can join by registering one `settings.plugins.tab` contribution.

The aggregation depends on the section owner being composed: without `ui-settings-plugins`, `ui-settings-plugin-inventory` waits for a tab declaration and renders nothing. That is an intentional composition dependency carried by the slot registry rather than a static package import.
