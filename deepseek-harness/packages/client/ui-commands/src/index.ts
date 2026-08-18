/**
 * Command UI plugin, node half. Pure UI plugin: the empty apply exists so
 * the plugin appears in the host cordis.yml / Loader; the browser half ships
 * via exports["./client"], discovered through the package.json dsh.client
 * declaration. The host command registry itself mounts separately
 * (bootHost + CommandUiRuntime).
 */

/** Host plugin body — no host-side behavior for the command UI plugin. */
export function apply(): void {}
