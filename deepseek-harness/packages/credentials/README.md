# credentials/ — credential references

English | [中文](README.zh.md)

The credential capability family separates reference resolution from its provider:

| Package | Role | ctx key |
|---|---|---|
| [`credentials/`](credentials/README.md) | Credential-reference seam | `ctx.credentials` |
| [`credentials-local/`](credentials-local/README.md) | Environment and local-file provider | registers `ctx.credentials` |

Configuration carries references, not secret values. Consumers resolve those references at their operation boundary; the child READMEs own mutation, precedence, and storage semantics.

The subsystem reference — `CredentialRef`, per-operation resolution, UI-safe `CredentialInfo`, provider layers — is [docs/subsystems/credentials.md](../../docs/subsystems/credentials.md).
