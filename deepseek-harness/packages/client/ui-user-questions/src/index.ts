/**
 * Web question plugin, node half.
 *
 * Deliberately empty. Mounting `ask_user_question` here put it in the tools
 * registry's GLOBAL layer, so every agent saw it no matter which preset
 * composed it — a two-tool benchmark preset actually presented three, and a
 * locally authored `bash-only` preset presented two. Rendering a question is
 * a host UI capability; having the tool is an agent capability, and only a
 * preset decides that. The `tool-ask-user` row belongs in the presets that
 * want it (and in the TUI composition, which has no presets).
 */

/** Host plugin body — the model-facing tool is composed per preset, not here. */
export function apply(): void {}
