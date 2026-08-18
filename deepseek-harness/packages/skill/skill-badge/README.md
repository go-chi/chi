# @deepseek-ai/dsh-skill-badge

English | [中文](README.zh.md)

Optional bundled skill provider that contributes `dsh-badge` to `ctx.skills`. The skill supplies the official “powered by dsh” Markdown snippets and the packaged PNG for systems that cannot import a remote image reliably.

Mount the plugin to enable the provider. It has no configuration. The shipped CLI composition includes the plugin as `disabled: true`; users must explicitly enable its `skill-badge` row before the skill enters a catalog.

The provider exposes its packaged `assets/` directory as the skill resource base. `dsh-badge.png` is the 726×120 source asset, and consumers render it at 121×20.

## Model Experience

Indirectly, through `@deepseek-ai/dsh-tool-skill`, which renders the catalog entry and selected skill body.

#### KV Cache effect

Disabled by default, the plugin changes no request. When enabled, its catalog entry and any loaded body change the provider KV prefix at their insertion points.

## Known Limitations and Deferred Work

- The provider contributes one fixed skill and has no runtime customization.
- Remote Markdown uses Shields.io; use the packaged PNG when the target cannot fetch remote images reliably.
