/** Fail activation with a deterministic stack so the user-visible startup diagnostic is snapshot-stable. */
export function apply() {
  const failure = new Error('startup activation snapshot failure')
  failure.stack = 'Error: startup activation snapshot failure\n    at activation-error-fixture'
  throw failure
}
