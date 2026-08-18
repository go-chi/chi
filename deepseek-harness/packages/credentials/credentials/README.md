# dsh-credentials

English | [中文](README.zh.md)

Credential Service Definition (`ctx.credentials`). One doctrine, three consequences:

**Configuration carries references to secrets, never the secrets.** A settings section or `cordis.yml` entry says `apiKeyEnv: DEEPSEEK_API_KEY`; the value behind that reference lives with a credential provider. So the settings document stays safe to sync and to render in a configuration UI, `describe()` can answer "is this configured, where from, can I write it" without ever holding a value, and rotating a secret touches no configuration file.

**Consumers resolve per operation.** `resolve(ref)` is called at the start of each operation (the LLM adapters resolve once per model request) and never cached across operations — that read is what makes a changed credential reach the very next request without restarting any plugin.

**An empty stored value is absent.** Everywhere: `resolve` skips it, `describe` reports it unconfigured. A blank can never masquerade as a configured secret.

## Surface

```ts
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

declare const ctx: Context

const ref = credentialRef('DEEPSEEK_API_KEY')            // POSIX shell identifier, branded
const hit = await ctx.credentials.resolve(ref)           // { value, source } | undefined
const info = await ctx.credentials.describe(ref)         // { configured, source?, writable } — never the value
await ctx.credentials.set(ref, 'sk-…')                   // rejects while a read-only source shadows the ref
await ctx.credentials.unset(ref)                         // no-op when absent; same shadowing rule
```

`credentials/updated (ref)` fires after a committed change to a provider-managed source — a `set`, an `unset`, or an external edit observed in storage. Ambient process-environment changes are not observable and never emit. Consumers do not need the event (they re-resolve per operation); it exists for configuration UIs refreshing a "configured" badge. Its declaration lives in the client-safe `./types` subpath export together with the `CredentialRef` type it names (the package root re-exports the type), so a consumer outside the Host compilation face reads the very signature the Host emits instead of restating it.

The shadowing rule on `set`/`unset` is deliberate fail-loud: when a read-only source (the live process environment, in the local provider) currently supplies the reference, a write would appear to succeed while resolution keeps returning the shadowing value — the seam rejects instead, and `describe().writable` lets a UI render the reference read-only up front.

## Providers

[`dsh-credentials-local`](../credentials-local/README.md) layers the inherited process environment over its managed `$DSH_HOME/.credentials.yaml` document, with the launcher's project and user `.env` layers as fallbacks. The seam shape leaves room for keyring-, helper-command-, and KMS-backed providers; a remote settings provider never needs to carry secrets.

## Model Experience

Indirectly, through the consuming LLM adapters: a resolved value authorizes their provider requests, and the adapter owns every model-visible surface.

#### KV Cache effect

No direct invalidation; credentials never enter a request prefix.

## Known Limitations and Deferred Work

- **No enumeration** — the seam answers questions about references it is given; configuration surfaces learn the references from settings schemas, so a `list()` has no current consumer.
- **References are environment-variable-shaped** — one flat POSIX-identifier namespace until a provider needs richer addressing.
- **Process-environment changes are invisible** — no event can fire for them; a UI only re-reads `describe()` on its own navigation.
