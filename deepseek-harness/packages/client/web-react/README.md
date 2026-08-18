# @deepseek-ai/dsh-client-web-react

English | [中文](README.zh.md)

Shell-side React glue for the slot terminal design: createSlotRenderer (the SlotRenderer implementation the shell installs into the runtime SlotRegistry), SessionProvider (framework-wired render prop, also injected as a standard seat to entries declaring session-scope children), bindSnapshotSelector (the one hook constructor — hosts and engines traffic in bare observable sources; every hook binds here, cached per source), useInvoke. Chain-slot outlets run the registered selectors in chain order at render time and mount only the elected entry, its select return joining the props as `matched`; the `renderSlotChain` binding is per-entry cached like `renderSlot`. The snapshot-store engine and defineStore live in runtime; business plugins depend on ui-slots types only, never on this package.

## Model Experience

None, as the ctx↔React machinery runs entirely in the browser; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The persist middleware corrupts primitive-state stores** — it object-spreads state on save, so a `SnapshotStore<string>` round-trips as a character map; the engine hand-rolls persistence instead (see `attachPersistence`).
- **`UseSession` is deliberately wide (`object` snapshot)** — the dependency direction (runtime → web-react, never the reverse) keeps the real `ConversationSnapshot` type out of reach; session-slot consumers narrow once at their boundary.
- **`renderSlot` is the only rendering form** — there is no Suspense integration or per-entry lazy loading.
