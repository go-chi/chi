---
name: cordis-plugin-development
description: Create, modify, debug, or extend dynamic Cordis Plugins, including Host Services and Events, Client Slot and theme UI, Package-private Client-to-Host calls, dynamic Tools, version updates, approval failures, and runtime diagnostics. Use this Skill to route a user request to the correct platform and Inspect Provider, then define, run, repair, or roll back the Plugin.
---

# Develop Dynamic Cordis Plugins

First determine whether a capability belongs on Host or Client, then query the real interface before writing code. Never infer a complete API from a Service name, Event payload, Slot props, theme token, or example.

## Standard workflow

1. Call `cordis_inspect_list` to obtain the Providers, methods, and schemas currently registered on Host and Client.
2. Select the smallest set of `cordis_inspect_query` calls needed to read the exact Services, Events, Builtins, Slots, Theme tokens, or Tools that the implementation will use.
3. For a new Plugin, design its first Package. To modify an existing Plugin, first use `cordis_inspect_self(pluginId, packageId)` to read the base source and diagnostics.
4. Write plain JavaScript in `code.host`, `code.client`, or both, then call `cordis_define`.
5. Call `cordis_run` with the final `pluginId` and `packageId` returned by define.
6. Handle approval, waiting, Client loading, and render failures from the Run card, steering messages, or `cordis_inspect_self`.
7. Use `cordis_stop` to disable the Plugin temporarily. Use `cordis_undefine` only when it is no longer needed.

Do not wait in the same turn for user approval or asynchronous browser results. After `cordis_run` returns `awaiting-approval` or `starting`, end the current Tool flow and wait for the system to report the final outcome through state updates and steering.

## Tool usage guidance

| Tool | Use it when | Do not |
| --- | --- | --- |
| `cordis_inspect_list` | Discover current Host/Client Providers and method schemas in one call; refresh after the runtime capability directory changes | Hard-code Provider names and skip list; treat a manifest as business data |
| `cordis_inspect_query` | Confirm exact Service methods, Event modes, Builtins, Slots, tokens, or Tool schemas before writing code | Use it instead of calling a real Service from the Plugin; assume a Client query will finish without a responding page |
| `cordis_inspect_self` | List current Plugins, inspect version pointers, or read exact Package source and runtime diagnostics | Fetch all source just to build a list; use it to modify or start a Plugin |
| `cordis_define` | Create a Plugin's first version or append an immutable Package to an existing Plugin; let the user preview the code first | Expect define to execute `apply`, request approval, or update current |
| `cordis_run` | Activate an exact Package; use `run` for first activation, restart, or rollback, and `update` to switch versions | Use `run` to switch versions implicitly; treat pending or starting as success |
| `cordis_stop` | Pause current effects while preserving Packages, grants, and version pointers for later use | Use stop to mean permanent deletion |
| `cordis_undefine` | Permanently remove a Plugin and all of its Packages and clear historical business views | Call it while rollback, inspection, or restart is still needed |

## Choose a platform

| Requirement | Preferred platform | Inspect first |
| --- | --- | --- |
| Files, commands, processes, or networking | Host | `fs`, `bash`, `subprocess`, `pty`, and `web` in `Service.listService` |
| Agents, durable Session data, or Host lifecycle | Host | The relevant Service and `Event.listEvents` |
| Register a dynamic Tool callable in the next model step | Host | `harness` in `Builtin.listBuiltins`, plus `Tool.listTools` |
| Page theme, layout, or current page state | Client | `Theme.listTokens` and Client `Service.listService` |
| Conversation Snapshot or session/workspace lists | Client | The target Slot's standard props and owner props |
| Settings pages, sidebars, input areas, overlays, or Tool cards | Client | `Slots.listSubTree` |
| Fetch on Host and display on Client | Both | Host Service + `harness.handle`; Client Slot + `host.call` |

Prefer the capability closest to the data owner. If Slot props already provide the Conversation Snapshot, do not fetch it again through Host. If only the Package's own styles need to change, do not override the global theme. If only a small entry point is needed, do not replace an entire product UI region.

## Provider navigation

Select methods from the actual `cordis_inspect_list` result. Common initial methods include:

- `Service.listService`: without `service`, returns every callable Service with its purpose and exact method signatures. Query the selected `service` again for access rules, structured method descriptions/parameters/returns, and only its referenced types.
- `Event.listEvents`: without `event`, returns every Event with its purpose, dispatch mode, and exact listener signature. Query the selected `event` again for its structured listener contract and only its referenced types; a Waterfall listener must call `next()`.
- `Builtin.listBuiltins`: returns evaluator-provided symbols and signatures that cannot be obtained through `ctx.get()`.
- `Slots.listSubTree`: without `root`, returns compact live trees with each Slot's purpose, kind, scope, registration keys, replacement risk, and children. With an exact `root`, it also returns that selected Slot's full contract, props, and current occupants while keeping descendants compact.
- `Theme.listTokens`: returns theme tokens that may currently be queried and overridden; it does not modify the theme.
- `Tool.listTools`: returns Tool schemas actually visible to the current Agent, including dynamically registered Tools.

Provider names, methods, and inputs must come from the current list result. The Service/Event Catalog describes which interfaces this version permits; it does not guarantee that a Service is currently mounted. At runtime, use real Services and Events rather than caching or displaying Catalog query results.

## Execution environment

Both `code.host` and `code.client` are plain JavaScript function bodies that return a Cordis Plugin. They are not compiled by TypeScript, JSX, or a bundler.

Do not use:

- `import`, `require`, TypeScript types, `as`, decorators, or JSX;
- globals not confirmed by `Builtin.listBuiltins`;
- guessed access to `window`, `document`, `process`, `Buffer`, `fetch`, or native timers.

Client React code must use `React.createElement(...)`.

Correct:

```js
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('tool.view.cordis', () => slots.register(
      { name: 'tool.view.cordis', key: 'self' },
      () => React.createElement('div', null, 'Hello'),
    ))
  },
}
```

Incorrect:

```jsx
return {
  apply(ctx) {
    return <div>Hello</div>
  },
}
```

JSX is not the only problem in this example. `apply()` registers lifecycle contributions and cannot return a React Element as the Plugin result. UI must be registered in a queried Slot.

## Access Services

Read optional capabilities with `ctx.get(name)` by default and handle their absence:

```js
return {
  apply(ctx) {
    const service = ctx.get('serviceName')
    if (service === undefined) return
    service.someMethod()
  },
}
```

Declare `inject` only when a Service is a hard dependency and the Plugin must enter waiting until Cordis reactivates it after the Service appears:

```js
return {
  inject: ['requiredService'],
  apply(ctx) {
    ctx.requiredService.someMethod()
  },
}
```

Do not overuse `inject` merely to avoid an `undefined` check. Do not access `ctx.requiredService` without declaring the injection; the Guard rejects undeclared dependencies.

## Manage side effects

Every contribution must be removed after the Plugin is stopped, updated, or removed. Prefer Cordis lifecycle APIs:

- Use `ctx.on()` to register Event listeners.
- Use `ctx.effect()` to own an external subscription that returns a disposer.
- Retain disposers returned by Cordis Service, Tool, Slot, timer, and theme APIs.
- Do not create process-wide or page-wide side effects at module scope or outside `apply()`.

Recommended:

```js
return {
  apply(ctx) {
    const service = ctx.get('serviceName')
    if (service === undefined) return
    ctx.effect(() => service.subscribe((value) => {
      console.log(value)
    }))
  },
}
```

If `subscribe()` does not return a disposer, first query whether the Service provides a supported cleanup mechanism. Do not assume unload automatically removes arbitrary third-party callbacks.

## Host and Client timers

On both platforms, the timer is a Service named `timer` with the same interface; it is not a Builtin. Query `{ "service": "timer" }` through the corresponding platform's `Service.listService` before using it. Declare `inject: ['timer']` before using the timer mixin.

One-shot delay:

```js
return {
  inject: ['timer'],
  apply(ctx) {
    const onClick = () => {
      ctx.timeout(() => console.log('done'), 300)
    }
    // Pass onClick to a queried Slot UI.
  },
}
```

Periodic work in a React component:

```js
return {
  inject: ['timer'],
  apply(ctx) {
    function Clock() {
      React.useEffect(() => ctx.interval(() => console.log('tick'), 1000), [])
      return React.createElement('div', null, 'Running')
    }
    // Register Clock in a queried Slot.
  },
}
```

Incorrect:

```js
return {
  apply(ctx) {
    ctx.timeout(() => console.log('invalid'), 300)
  },
}
```

```js
setTimeout(() => console.log('invalid'), 300)
```

The first example does not declare the timer hard dependency. The second uses a global timer that does not exist.

## Listen to Events

Query the Event Provider first to confirm the platform, parameter order, return value, and `mode`.

Ordinary emit Event:

```js
return {
  apply(ctx) {
    ctx.on('some/event', (payload) => {
      console.log(payload)
    })
  },
}
```

The last parameter of a Waterfall Event is `next`. Unless the listener intentionally stops downstream processing, it must call and return it:

```js
return {
  apply(ctx) {
    ctx.on('some/waterfall', (payload, next) => {
      console.log(payload)
      return next()
    })
  },
}
```

## Register Client UI

Query `Slots.listSubTree` without `root` to choose a target from the compact purpose and topology tree, then query the exact Slot with `root` before writing its registration. The exact result determines:

- the Slot's purpose in the layout;
- whether its registration protocol is `single`, `list`, `keyed`, or `chain`;
- registration options;
- scope standard props and business owner props;
- current occupants, replacement risks, and descendant Slots.

Use `ctx.get('slots')` and handle its absence. Then use `slots.inject` to wait for the Slot declaration and call `slots.register` inside the callback:

```js
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('target.slot', () => slots.register(
      { name: 'target.slot', id: 'my-view' },
      (props) => React.createElement('div', null, String(props.someValue)),
    ))
  },
}
```

`ctx.get('slots')` does not require an injection. Do not rewrite it as `ctx.slots` unless `inject: ['slots']` is declared:

```js
return {
  apply(ctx) {
    ctx.slots.register({ name: 'target.slot' }, () => null)
  },
}
```

Do not guess an `id`, `key`, selector, or props before querying the Slot protocol. Do not default to root-level `root`, `sidebar`, `conversation`, or `details` Slots; replacing an entire occupant also removes the descendant Slots it declares.

### Settings pages

A full settings UI should usually register its own section through `settings.section` to obtain a complete content area. `settings.general.item` is only appropriate for one compact, general-purpose preference. Query the actual subtree, options, and props for both, then select the narrowest entry point that is still sufficient.

Dynamic Plugins are temporary and process-local, so their settings UI does not need persistent storage. Do not add durable settings or another persistence mechanism for it. Register the UI in the appropriate settings Slot and keep any transient interaction state in memory for the lifetime of the Plugin.

### Session and page data

A session-scoped Slot may provide `useSession`, `useSessions`, `useWorkspaces`, `useProjection`, input state, or actions through standard props. Follow the query result and prefer owner or standard props directly; do not add a Host RPC for data already present there.

Select only the fields that the UI actually needs. Do not copy or render an entire Conversation Snapshot, Session, Tool call, or Slot props object.

### Cordis Run-specific panel

To place interactive UI in the latest `cordis_run` card, register `tool.view.cordis` with `key: 'self'`:

When the feature needs user interaction tied to this Package's result, this region is often a good fit because it keeps the controls in the conversation flow beside the Run card. It is not the default target for every Client UI: settings, sidebars, message actions, and overlays should use their own queried Slots when those locations better match the feature.

```js
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('tool.view.cordis', () => slots.register(
      { name: 'tool.view.cordis', key: 'self' },
      (props) => React.createElement('div', null, `Package ${props.packageId}`),
    ))
  },
}
```

At runtime, `self` binds to `pluginId + packageId`. Do not include `pluginRunId` in the key. When the same Package runs multiple times, the latest Run card hosts the UI and older cards automatically degrade.

### Ordinary Tool cards

To customize the call card for an ordinary model Tool, query `tool.call.toolview`. Its key is the Tool name; registering an existing key may replace the product's default card. When customizing only a newly added Tool, first verify its schema with `Tool.listTools`, then query the complete `ToolCallOwnerProps`.

### Overlays and local entry points

- For toasts, status notices, and frame-wide overlays, query `shell.overlay` first; observe its pointer-events and ordering rules.
- When the selected target is a global overlay Slot, decide whether the UI should be draggable, how the user shows and hides it, and which existing layers it must cover or remain below.
- For small sidebar actions, prefer additive inner Slots such as `sidebar.footer.action`; do not replace the entire sidebar.
- For supplementary content after a conversation turn, query `conversation.chat.turnTail` and register according to its returned chain selector and fallback rules.

## Themes and styles

Determine the scope of the change first:

1. Global theme: first query `Theme.listTokens`, then query `{ "service": "theme" }` through Client `Service.listService`. Supply light and dark values for each override as required by the query, and retain the returned disposer.
2. The Package's own components: use `styles.insert(css)` and prefer theme CSS variables for colors.
3. New visible content: choose a Slot first, then decide between local CSS and global tokens.

Do not manipulate `document.body`, `window`, or hard-coded product DOM selectors. The theme Service changes tokens but does not create UI. Slots create UI but do not replace the theme system.

## Call Host from Client

Host registers a Package-private method with `harness.handle(method, handler)`, and Client invokes it with `host.call(method, args)`. This is Client→Host JSON RPC.

Host:

```js
return {
  apply(ctx) {
    harness.handle('read-state', async (args) => {
      return { value: args.key }
    })
  },
}
```

Client:

```js
return {
  async apply(ctx) {
    const result = await host.call('read-state', { key: 'demo' })
    console.log(result.value)
  },
}
```

Arguments and return values must be lossless JSON. Do not pass functions, React elements, class instances, Contexts, Services, or other runtime objects; return `null` when there is no response data. Do not register a public Remote Service or use `ctx.remote` for Package-private communication.

## Register a dynamic model Tool

Host can use `harness` to register a Tool callable in the next model step. First query the current `harness` signature with Host `Builtin.listBuiltins`, then inspect existing Tool names and schemas with `Tool.listTools` to avoid conflicts.

Tool arguments and return values must be JSON-compatible. `execute` owns the business result; render and presentation own only what the model and native UI see. Tool registration must belong to the current Plugin Fiber so it is automatically removed after stop or update.

## Handle internal live data

Service instances, Event payloads, Slot props, Session and Conversation Snapshots, Tool state, and other DSH/Cordis objects are internal live data.

Do not:

- call `JSON.stringify` or `structuredClone` on these objects or their descendants;
- recursively enumerate, fully copy, or display them as a whole;
- place Host objects in the Package's long-lived state or RPC return values.

Read only the leaf fields required by the current feature. Extract the minimum strings, numbers, booleans, and other scalar values before constructing owned JSON.

## Versions, approval, and repair

- A Plugin is the stable instance identified by `pluginId`.
- A Package is an immutable code version identified by `packageId`.
- Every activation attempt has its own `pluginRunId`.
- `currentPackageId` is the latest successful version; it does not imply that the Plugin is currently running.
- `nextPackageId` is the target awaiting approval, activating, awaiting Client activation, or most recently failed.

Choose the `cordis_run` mode as follows:

| Current state | Target | mode |
| --- | --- | --- |
| No current | Any Package under the Plugin | `run` |
| Has current | The same Package | `run` |
| Has current | A different Package | `update` |
| Update failed | `nextPackageId` | `update` to retry |
| Update failed | `currentPackageId` | `run` to roll back |

An unauthorized Client Package returns `awaiting-approval`. A single check mark authorizes only the current Package; double check marks authorize future versions of the same Plugin. A grant remains after a technical runtime failure. An authorized Package returns `starting` and completes asynchronously in the browser.

After a technical failure:

1. Use `cordis_inspect_self(pluginId, packageId)` to read the failed version's source and exact diagnostics.
2. If the error involves an unknown capability, list and query the corresponding Provider again.
3. Define a new Package under the same Plugin; do not overwrite the failed Package.
4. Run again with the new `packageId` and the correct mode.

Do not retry automatically after the user rejects approval. A failed update does not automatically restore the old physical Run; explicitly run current when recovery is required.

## Modify @pluginId

When the user identifies a target with `@pluginId`, do not create another Plugin. The injected context contains only identity, version pointers, and the default base Package, not source code.

Modify it as follows:

1. Read the base Package with `cordis_inspect_self(pluginId, packageId)`.
2. Preserve the Host or Client half that does not need to change and modify only the target code.
3. Call `cordis_define` with `plugin.kind: 'existing'` and the original `pluginId`.
4. Use the returned `packageId`; when current exists, activate the new version with `update` in the usual case.

If the reference is unavailable, explain that the Plugin was removed, belongs to another Session, or was lost on process restart. Do not create a same-named replacement.

## Common failure checks

| Failure | Check first |
| --- | --- |
| `service "x" is not declared` | Whether code uses `ctx.x` without declaring `inject: ['x']` on the Plugin object; switch to `ctx.get('x')` with an absence check or declare a true hard dependency |
| `cannot get property "timer" without inject` | Query the timer Service and declare `inject: ['timer']` |
| Client parse failure | Whether the code uses JSX, TypeScript, import, or an unavailable global |
| Slot registration failure | Whether the live subtree was queried, the Slot exists, and options, key, or selector satisfy the returned protocol |
| UI loads but the page reports an error | Inspect the `client-render` diagnostic and stack; the error belongs to an exact Run, so define a new Package to repair it |
| `host.call` failure | The Host handler name, current `pluginRunId`, JSON arguments, and real Service dependencies inside the handler |
| Update failure | Preserve current/next semantics; repair next and update, or run current to roll back |
