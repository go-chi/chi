# @deepseek-ai/dsh-client-ui-input-trigger

English | [中文](README.zh.md)

Input trigger pipeline plugin: `/` and `@` detection under the caret (word-boundary + guard-tier rules), the grouped candidate menu, and pick routing to registered sources. `ctx.inputTriggers` owns the source roster and resolves one `InputTriggerController` per session scope (`sessionOf`); the conversation wiring layer drives `track`/`arbitrate`/`onSpace`/`adjudicate` on the controller. The same controller exposes `toggleSource` for a chrome launcher to open exactly one registered source over a synthetic selection span; the resulting candidates still use the ordinary menu, keyboard arbitration, pick callback, and scoped input mutations. Sources receive a `ClientSessionContext` projection per call — sessions are always agent-backed, so the projection is the session identity alone. A source is warmed in every session controller it can reach: the roster present at scope birth warms during controller construction, and a source registered later is warmed into every live controller by the registration itself. Sources whose `lexicon` roll changes after warm implement `subscribeLexicon(session, listener)`; the controller re-polls on each notification and publishes the aggregation through its `lexicon` snapshot store. The pipeline is command-agnostic: space/enter adjudication polls the optional `matchSpace`/`matchEnter` hooks in registration order and the first non-undefined answer wins.

Layering: `src/core/` is the pure core — `detectTrigger`, `menuReduce`/`seedGroups`/`MENU_CLOSED`, `exactMatch`, zero React/DOM/cordis; `src/client/service.ts` is the shell wiring the core to the menu snapshot store, the per-hit candidate fetch (generation-gated, `AbortSignal`-superseded, failed sources drop silently with a console record), and the three pick paths. `src/types.ts` and the two `contract.ts` files are the frozen cross-package contract; changes require main-thread arbitration.

MenuView renders the menu store into the `conversation.input.overlay` slot (list kind, session scope) and renders null while closed. Typed triggers seed every source registered for that trigger; a programmatic launcher seeds only its requested source and publishes the source name through the controller's `launcher` snapshot store until the menu closes or typed tracking resumes. Groups sort by the optional `InputTriggerSource.order` (lower first, default 0, ties keep registration order) under title rows localized through the `inputTriggers.menu` locale namespace (an unknown source shows its raw name); the list height clamps to the space above the composer, and a pointer down outside both the menu and the surrounding composer card dismisses it. The slot is owned by ui-conversation's composer entry (anchor, children declaration, lifecycle); its SlotMap type merge lives in this package's `src/client/slots.ts` because the dependency direction (ui-conversation → ui-input-trigger) admits no reverse type import. Combobox pattern: focus stays in the textarea, rows pick on mousedown, the highlight rides `aria-activedescendant`.

The `/client` exports are the plugin body (`apply`/`inject`), `InputTriggerService`, `MenuViewInjected`, and the contract types. MenuView itself is internal — the slot registration closes over it.

## Model Experience

None, as the trigger pipeline is browser presentation only — picks produce `CommandClaim`/`ReferenceInsert` data whose model-visible consequences (host command execution; inserted reference text riding an ordinary prompt) are owned by the consuming host and input-machine packages.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Global source layer only** — session-scope source registration (per-session shadowing, ScopedLayers-alike) is designed but not enabled; the ledger tracks the trigger condition (a real per-session source need).
- **`InputTriggerCandidate.icon` renders as text** — MenuView drops the string into the icon slot verbatim; wiring to the design-system icon enum (iconFile five-variant family) lands when that enum ships.
- **Overlay SlotMap merge home is split from slot ownership** — the sole `conversation.input.overlay` merge lives here, while ui-conversation owns its anchor, children declaration, and lifecycle because the dependency direction is ui-conversation → ui-input-trigger.
