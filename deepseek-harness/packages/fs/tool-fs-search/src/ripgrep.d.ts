/**
 * Minimal type surface for the `@vscode/ripgrep` package: an ESM module that
 * resolves the platform ripgrep binary (`@vscode/ripgrep-<platform>-<arch>`
 * optional dependency) and exports its absolute path as the named export
 * `rgPath` (no bundled type declarations).
 * @module @deepseek-ai/dsh-tool-fs-search/ripgrep-types
 */

declare module '@vscode/ripgrep' {
  /** Absolute path to the packaged ripgrep executable for the current platform. */
  export const rgPath: string
}
