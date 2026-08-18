# Agent Note: A pi-ai model declares its own input modalities, and undeclared means text

Status: implemented

English | [中文](2026-08-12-pi-ai-route-default-input-modalities.zh.md)

## Problem

Nothing in `settings.yaml` could describe a hand-declared pi-ai model as accepting images, and the adapter assumed text-only for every model the installed pi-ai catalog does not describe. Every model a deployment adds through the web UI's "add a custom provider" card is such a model, so an OpenAI-compatible gateway serving a vision model reported `inputModalities: ['text']` no matter what it actually served.

The harness treats an omitted modality as negative capability, and three admission points act on it before any request is built: model selection refuses to switch into a session that already holds images, prompt admission refuses an image, and `read_image` refuses to read one. Their diagnostics tell the user to select an image-capable model — advice with no reachable referent, because no configuration key could make a hand-declared model image-capable. The route was closed at the metadata, not at the capability: the request converter and every pi-ai wire protocol carry images, and `llm-pi-ai`'s own stream guard is the only thing that would have stopped one.

The assumption was justified in the source as the adapter's real capability rather than a deployment choice, and [[2026-08-03-pi-ai-declared-provider-catalog]] recorded the same reasoning when it decided which `Model` fields the configuration surface would expose ("nothing reads them: … `context.ts` keeps only text blocks"). That justification described the DeepSeek chat-completions adapter, whose serializer genuinely rejects image blocks, and had never been true of the pi-ai route. This note supersedes that one on modalities alone; pricing stays closed there for its own, still-current reason.

## Decision

**Modalities resolve entry `input` → installed catalog entry → route `defaultInput`, which itself defaults to `[text]`.** That is the chain `contextWindow` and `maxTokens` already use, field for field. pi-ai types `Model.input` required and per-model, so the entry field mirrors upstream directly: one route can serve a vision model beside a text-only one, and an override can correct a catalog model whose gateway serves other modalities than the catalog records. The route field spares a gateway whose *undescribed* models all take images from repeating itself on every entry.

**The route value is a fallback, not an override — the catalog outranks it.** This is the `default*` ordering rather than `compat`'s, and the two are not interchangeable: `compat` shadows the catalog because a route-level protocol repoint invalidates the catalog's reasoning-dispatch facts wholesale, while a modality is a per-model property the catalog states accurately for the models it ships. Making the route value win would mean `defaultInput: [text]` silently strips images from every catalog vision model on the route — a footgun with no matching benefit, since narrowing one such model is what that model's own `input` is for.

**Undeclared means `[text]`, and that is the absence of a declaration rather than a guess at the endpoint.** Nothing can interrogate a gateway for its modalities — no OpenAI-compatible listing endpoint reports them — so the only honest floor is the modality every supported protocol certainly carries. This is where the modality fallback parts company with the capacity ones: 262,144 tokens is merely plausible and wrong in both directions (a gateway serving 8k overflows, one serving 1M is wasted), while text is safe in one direction. The two wrong answers do not cost the same either. Under-claiming refuses the image before it is attached, naming the model, and the remedy is one documented line. Over-claiming admits an image the provider then rejects mid-turn, *after* prompt admission has committed the message durably, so the session keeps re-sending a request that cannot succeed and model selection refuses a switch to any text-only model. A cheap refusal at the earliest resolvable point beats an expensive one at the latest.

**An entry's empty list means the same as an absent one; the route's is refused.** `[]` describes a model that accepts nothing and could serve no request, so it states no answer and resolution continues past it. That reading is not cosmetic: the config schema materializes `[]` for an absent array, so treating it as "accepts nothing" would silently strip images from every catalog vision model a `models` list happens to name. The route value has nothing below it to answer instead, so its empty list is refused where it is written. The route's `models` list already resolves absent-and-empty the same way for the same reason.

**No configuration surface edits `input`.** It joins `compat`, `reasoningEfforts`, `thinkingBudgets`, and `headers` as a settings-document field, and the model-list editor stays a hand-written form over id, name, and the two capacities. This costs nothing durable because that card was already built to carry fields it does not edit: its row patch spreads the stored row before applying changes, and adoption keeps an existing row over a rediscovered candidate, so a hand-written `input` survives both.

The DeepSeek chat-completions adapter is untouched. Its `['text']` is a fact about its serializer, not a missing declaration, and it keeps refusing before the send.

## Alternatives considered

- **An optimistic `[text, image]` default** — makes the motivating case work with zero configuration, and the web form writes no modality at all, so a conservative default leaves the remedy in a file a web-only user has no reason to open. Rejected on the severity of being wrong: a refused attachment is a speed bump with a documented fix, while a provider rejection poisons the session, presents as an unexplained repeating failure, and is escapable only by switching models or starting over. Documenting the remedy on the model-configuration page closes the discoverability gap; nothing closes the poisoned session.
- **A route value that overrides the catalog** (`compat`'s ordering: entry → route → catalog) — lets a deployment that repoints a catalog route at its own gateway declare "no vision here" once. Rejected because the same sentence then silently disables every catalog vision model on a route where someone wrote it by analogy with the capacity fields, and the legitimate case is served by that model's own `input`. An override would also have to be named `input` at the route, since calling it `default*` beside two genuine fallbacks would misdescribe it.
- **No route field at all, only the entry one** — closest to upstream, which has no route-level concept. Rejected on the bulk case the product's own flow produces: "fetch available models" adopts thirty ids with no modality, and an all-vision gateway would need `input` hand-written on each.
- **A route-level `defaultInput` with no entry field** — cannot mix modalities on one route or correct a single catalog model, leaving "split the provider across two route keys" as the only workaround, at the cost of a second permanent provider id and a duplicate entry in every model selector.
- **Probe the endpoint for its modalities** — no OpenAI-compatible listing endpoint reports them.
- **Infer from the model id** (`*-vision`, `*-vl`) — a naming convention is not a capability, and a gateway renames freely.
- **Keep refusing and improve the diagnostic** — the message was already accurate about the state and useless about the remedy; the missing thing was the remedy.

## Consequences

A vision model on a custom provider costs one line, `input: [text, image]`, written in the settings document — or one line at the route when every model it lists takes images. That is the whole of the fix: the three admission points then admit images on it and `read_image` works. A deployment that writes nothing keeps exactly the behavior it had, so no existing route changes what it reports.

The image-admission gate keeps its meaning everywhere, because every modality it reads is now either recorded by the installed catalog or written by a person. Nothing claims a capability on a deployment's behalf.

A model that declares images its endpoint does not serve is not caught locally — the claim is not verified — and the resulting failure is expensive. Prompt admission commits the user message durably (`agent/inbox/spliced`) before the request is built, so the rejected image stays in the session log: that model keeps re-sending it, and model selection refuses a switch to any text-only model. Recovery is to select a model that does serve images, fork before the image, or start a session. Making that failure non-destructive — rolling an unconsumed image message back out of the log when the send fails — is the change that would make an optimistic default reconsiderable, and is not attempted here.

## Testing

`packages/llm/llm-pi-ai/tests/catalog.spec.ts` covers each rung of the chain and both readings of an empty list at the resolver: one route mixing an undeclared model with entry-declared text-only and vision models, a route default answering an undeclared model while an entry still outranks it, a catalog vision model keeping its modalities under a narrower route default, an entry's `[]` inheriting rather than emptying, and the route's `[]` refused. A separate case re-asserts every rung end to end — a written settings section, the plugin's own registration, and `ctx.llm.listModels` / `resolveModelInfo` — so a break between the document and `LlmModelInfo` cannot pass.

`config.spec.ts` holds the schema boundary: an unknown modality refused at both levels, the empty route list accepted by the schema and refused by the namespace validator that the settings seam actually runs, and the `[]` materialization for an absent array that the inheritance rule depends on.

No keyless snapshot lane exercises a pi-ai route: the snapshot examples drive `dsh-llm-replay`, which declares modalities directly in its configuration, and a pi-ai route needs a live endpoint whose port a static `cordis.yml` cannot name. The admission points this change feeds are already covered there through that provider (`examples/acp-agent/image.cordis.snapshot.yml` and `image-text-route.cordis.snapshot.yml`) and are unaffected — what changed is what one adapter reports, not how a gate reads it.
