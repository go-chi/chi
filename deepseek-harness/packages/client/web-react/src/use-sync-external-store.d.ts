/**
 * Local typings for use-sync-external-store 1.2.0: the package ships no types
 * and the DefinitelyTyped package is unavailable offline. Mirrors the shim's
 * with-selector build (the only entry this package consumes).
 */
declare module 'use-sync-external-store/shim/with-selector.js' {
  export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => Snapshot,
    getServerSnapshot: undefined | null | (() => Snapshot),
    selector: (snapshot: Snapshot) => Selection,
    isEqual?: (a: Selection, b: Selection) => boolean,
  ): Selection
}
