# @deepseek-ai/dsh-session-title-all-prompts-llm

English | [中文](README.zh.md)

Optional `ctx.sessionTitle` provider that summarizes every eligible human message through `ctx.llm`. It registers the `all-prompts` cadence and starts a new revision after each new human prompt, using seeded history as well as child-session prompts. A newer revision aborts and supersedes older work; even a provider that ignores cancellation cannot commit stale output.

The plugin uses the complete required [shared LLM configuration](../session-title-llm/README.md#configuration). Omit both `provider` and `model` to inherit the exact route from each current logged main request, or set both to route title generation independently. If the final framed aggregate prompt exceeds `maxInputBytes`, the request fails instead of truncating history; automatic use warns and keeps the prior title.

## Model Experience

### All-messages title request

#### What the model sees

The title model receives the shared title instruction and a JSON array of all eligible human messages through the current revision, in log order with exact seqs. Seeded history is included.

#### Token effect

One auxiliary request may follow every new eligible prompt, bounded per request by `maxInputBytes` and `maxOutputTokens`; explicit refreshes may add calls. The main agent request gains zero tokens.

#### KV Cache effect

No main-request invalidation. Auxiliary input grows or changes after each prompt, so provider-specific cache reuse ends at the first changed JSON token.

## Known Limitations and Deferred Work

- Input overflow retains the prior title; this provider has no summarization-of-summaries or retention policy for very long sessions.
- It treats all eligible human messages equally and offers no weighting, filtering, or manual-title precedence.
