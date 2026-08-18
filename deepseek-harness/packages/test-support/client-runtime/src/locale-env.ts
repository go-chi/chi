/**
 * Browser-language pin for specs that assert localized copy. A fresh
 * LocaleRuntime with no stored preference opens in the language `navigator`
 * asks for, and jsdom reports the runner's own (`en-US`) — so a spec asserting
 * the product's Chinese copy states the browser it assumes instead of
 * inheriting the machine's.
 */
import { afterEach, beforeEach } from 'vitest'

/**
 * Pin `navigator.languages`/`navigator.language` for every test in the
 * calling file (or describe block), restoring the environment's own values
 * afterwards. Call at suite level, like the other vitest hooks.
 * @param primary - most preferred BCP 47 tag; also becomes `navigator.language`.
 * @param rest - further tags in preference order.
 */
export function usePinnedBrowserLanguages(primary: string, ...rest: string[]): void {
  beforeEach(() => {
    Object.defineProperty(navigator, 'languages', { value: [primary, ...rest], configurable: true })
    Object.defineProperty(navigator, 'language', { value: primary, configurable: true })
  })
  afterEach(() => {
    // Deleting the own properties uncovers the environment's own accessors
    // again (Navigator declares both readonly, hence the erased receiver).
    const own = navigator as unknown as Record<string, unknown>
    delete own.languages
    delete own.language
  })
}
