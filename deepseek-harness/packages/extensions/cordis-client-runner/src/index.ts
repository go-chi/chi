/**
 * Dynamic-package runner plugin, node half. Pure browser-side capability: the
 * empty apply exists so the row appears in the host cordis.yml / Loader, while
 * the browser half ships through exports["./client"], discovered from the
 * package.json dshClient declaration.
 */

/** Host plugin body — this package contributes nothing host-side. */
export function apply(): void {}
