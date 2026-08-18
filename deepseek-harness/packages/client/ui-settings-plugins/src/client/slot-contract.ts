/**
 * The `settings.plugin.item` slot type — one plugin's card inside the
 * configurable-plugins tab, keyed by the settings namespace the card edits.
 * Options: `key` (the namespace). A card draws its own internals; the tab only
 * decides which namespaces to dispatch and stacks what comes back.
 *
 * Keying on the namespace is what lets a plugin distributed outside this
 * repository contribute a card: it registers its own settings namespace on the
 * Host and its own card under that key in the browser, and the tab pairs the
 * two without ever learning what the namespace means.
 *
 * TYPE HOME RATIONALE: the tab declares this slot at runtime, and a plugin
 * registering its own card already depends on this package for the slot's
 * declaration. The type therefore lives with its declarer.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One plugin's card inside the plugin configuration section (see module JSDoc). */
    'settings.plugin.item': { kind: 'keyed'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}
