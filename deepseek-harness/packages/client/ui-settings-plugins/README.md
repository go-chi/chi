# dsh-client-ui-settings-plugins

English | [中文](README.zh.md)

The **Plugins** settings section and its **Plugin configuration** tab. The section owns the heading and compact tab chrome; feature plugins contribute pages through `settings.plugins.tab`. This package's own tab shows one expandable card per Host plugin whose configuration a user owns. A card shows the plugin's name and what it governs; expanding it in place reveals hand-written controls bound to that plugin's settings namespace, each field marking whether the user overrode it and offering a reset back to the value the deployment composed.

## What appears here

The configurable tab reads which settings namespaces the Host serves and dispatches one slot key per namespace, so what renders is the intersection of two ledgers: the namespaces a live Host plugin registered, and the cards registered under those keys. A served namespace no card claims renders nothing — another surface owns it, or this deployment ships no browser half for it — and a card whose namespace this deployment does not serve is never dispatched, so an uncomposed plugin leaves no trace and does not hold the tab back from its empty line. The empty line waits for the Host's first answer, so an unanswered read never reads as "this deployment configures no plugin". Cards appear in the order they registered, which is stable for the cards one package installs together and not stable across plugins: apply order between packages is unconstrained.

The cards this package ships cover the shell executor (`bash`), the agent loop's tool-call parallelism (`agent-loop`), and the DeepSeek search provider (`web-search-deepseek`).

## Extension point

The section declares `settings.plugins.tab`, a root list slot whose labels become ordered tabs. It keeps a tab mounted after its first selection, so local drafts and read-only snapshots survive tab switches. The package registers its own `configurable` contribution, which declares the nested `settings.plugin.item` slot — keyed on the settings namespace a card edits. A plugin that ships a browser half registers its own card under its own namespace and owns every part of it: chrome, controls, and copy. Keying on the namespace is what lets a plugin distributed outside this repository appear here — it registers the namespace on the Host and the card in the browser, and the tab pairs the two without learning what the namespace means. Tabs follow the contribution's `order`; cards follow registration order.

## Writes

A card stages what the user types and writes it only when they save. Each control renders staged text, so what is on screen is exactly what a save would store; **Discard** drops the drafts, and a card holding unsaved edits says so on its header even while collapsed. A reset stages the composed default rather than writing immediately, and a draft the field does not accept blocks the save instead of being dropped.

Saving writes each staged field through the client settings scope, which fences every write with the namespace revision it read, so a form that has drifted from the document is refused rather than overwriting a concurrent change. The Host is the only authority on whether a value was accepted — its validators own the constraints no schema can express — so the card reads the section back afterwards and reports a save that did not land, keeping those drafts for the user to correct.

A key can also be written from another surface — the Models page addresses the same reference — which changes no settings section, so the card re-reads on the forwarded `credentials/updated` event for the reference it watches.

A field's presence in the raw user layer — not its value — is what marks it overridden; a reset clears that field so it re-inherits the composition layer. Secret-role fields never ride a response, so a key control starts blank, reports only whether one is configured, and writes through the credentials domain rather than the settings section; a blank draft writes nothing and keeps the stored key.

## Model Experience

None, as the section renders a browser configuration UI; the values it writes reach a model only through the plugins that own them, each documenting that effect itself.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Only host-plane plugins appear** — a plugin an agent preset mounts carries its configuration inline in that preset's `agent.cordis.yml` and cannot register a settings namespace at all (a second session mounting the same preset would fail on a duplicate registration), so this section lists nothing for it. Editing those values remains the preset editor's job.
- **A card still needs a browser bundle** — the browser half must be a `dsh.client` package built in the client module system's lazy-CJS factory format, and the `clientBundle` preset that emits it lives in `packages/client/tsdown.client.ts` rather than a published package, so a plugin outside this repository has to reproduce that build itself. The bundle-purity gate also forbids importing this package's card chrome or form model as values, so such a card owns its own staging and revision fencing.
- **The served namespaces re-read on two signals only** — the wire announces settings-document commits and connection resets, not registrations, so a namespace whose owner registers after the tab's read joins the list on the next document commit or reconnect.
- **The shell card follows the composed executor** — the POSIX and PowerShell executor families share the `bash` namespace because a host composes exactly one of them, so the served schema differs by platform (PowerShell adds `pwshPath`) even though the card edits the same two fields on both, and a deployment composing neither shows no card.
