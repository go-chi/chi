# web-cordis

English | [中文](README.zh.md)

Self-referential demonstration of [`@deepseek-ai/dsh-tool-cordis`](../../packages/extensions/tool-cordis/README.md). The agent can inspect its current Cordis process and mount or unmount model-authored plugins in memory. Temporary plugins disappear when they are unmounted or the process exits and may affect other sessions in the same process.

## Run it

Start the browser interface:

```sh
pnpm run demo:cordis
```

Start the ACP automation server instead:

```sh
pnpm run demo:cordis acp
```

Both commands require `DEEPSEEK_API_KEY`. The [Cordis tool reference](../../packages/extensions/tool-cordis/README.md) defines the tool arguments, lifetime, cleanup, and safety contracts.
