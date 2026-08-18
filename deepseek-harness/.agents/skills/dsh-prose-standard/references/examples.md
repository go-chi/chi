# Distilled prose examples

Use these examples to identify the governing principle, not as text templates. “Balanced” preserves every load-bearing proposition with the least explanation needed at that location.

## Preserve every factual clause

**Original:** “The coordinator carefully serializes writes per session, flushes buffered events before disposal resolves, and reports backend failures to the caller.”

**Over-trimmed:** “The coordinator serializes persistence.”

**Balanced:** “The coordinator serializes writes per session, flushes buffered events before disposal resolves, and reports backend failures to the caller.”

Remove decoration and repetition, not propositions. Actor, per-session scope, disposal ordering, and failure visibility are separate facts.

## Explicit skill scope is functional

**Over-trimmed:** “Read the sources and use judgment.”

**Balanced:** “This skill is guidance, not a complete checklist. Use judgment beyond the named checks; documented requirements still apply.”

**Over-detailed:** Several paragraphs defending why lists cannot replace independent reasoning.

Keep the explicit limitation because it changes how an agent applies the workflow. Trim repeated persuasion, not the guardrail.

## A cookbook keeps action and verification

**Over-trimmed:** “Add tests for the tool.”

**Balanced:** “Test registration and disposal at unit level, exercise the tool through the real loader path, and add a snapshot when its rendered output changes. Verify the assertion observes the external result rather than the model's report.”

**Over-detailed:** A walkthrough of every fixture file and assertion already visible in the example code.

Keep the test tiers, required action, real entry path, and observable verification. Remove fixture narration.

## Preserve ownership and timing

**Over-trimmed:** “Provider work is cancelled during teardown.”

**Balanced:** “The runtime requests provider cancellation before releasing the child scope; the provider remains responsible for joining its workers before disposal resolves.”

**Over-detailed:** A chronological account of every promise and callback used to implement teardown.

The actor, ordering, point where ownership changes, and completion guarantee are separate factual clauses.

## Event JSDoc preserves boundary timing

**Over-trimmed:** “Composes and caches the session prefix.”

**Balanced:** “Composes the session prefix once before the first pre-step and model request. Listener appends join the current request, and pre-step pressure accounting receives the composed prefix.”

**Over-detailed:** A walkthrough of the loop helpers, cache fields, and promise callbacks that implement the ordering.

Event order and its current-request consequence are caller-visible behavior, not implementation narration.

## Orient complicated code without narrating it

**Over-trimmed:** “Worker realm support.”

**Balanced:** “Owns the worker realm and its host bridge. Realm initialization is single-shot; disposal terminates the worker and rejects later calls. See the worker-isolation Agent Note for the protocol rationale.”

**Over-detailed:** A paragraph-by-paragraph preview of the classes and helper functions below.

Keep the module's role, dependencies, responsibilities, and non-obvious lifecycle behavior. Link architecture rationale and let the code show local control flow.

## Public JSDoc includes failures

**Over-trimmed:** “Returns the realm global.”

**Balanced:** “Returns the initialized realm global. Throws if initialization has not completed or the realm has already been disposed.”

**Over-detailed:** The internal state-machine branches and exact helper calls that lead to each throw.

Throws and state preconditions are caller-visible contract facts.

## Keep a concise implementation mapping

**Over-trimmed:** “Search provider backed by an external API.”

**Balanced:** “Maps each provider result to the shared search-result fields, preserving the title, URL, and text while omitting provider-only ranking metadata.”

**Over-detailed:** A field-by-field restatement of the mapping code, including fields with identical names and obvious assignments.

Keep mapping details that explain where an adapter drops or changes information.

## Link rationale while keeping the local contract

**Over-trimmed:** “Disposal is documented in the lifecycle Agent Note.”

**Balanced:** “Disposal aborts the run and waits for provider quiescence. See the lifecycle Agent Note for ownership and race handling.”

**Over-detailed:** Repeating the Agent Note's promise choreography and rejected ownership models beside every disposer.

Keep the behavior and completion guarantee where callers need them. Link aggressively for the algorithm and rationale; a link cannot replace the local contract.

## Implemented Agent Notes retain verification contracts

**Over-trimmed:** Deleting the entire Testing section because the Agent Note has already shipped.

**Balanced:** “Unit tests cover cancellation before and after publication, disposal quiescence, and provider reload. A built-entry smoke covers the real loader path; snapshot coverage is deferred because the transport is process-specific.”

**Over-detailed:** A file-by-file walkthrough of fixtures and assertions with no additional behavioral distinction.

Remove migration tasks and test narration. Keep the tiers, behaviors they pin, real entry path, and named coverage gaps.

## A security boundary may need one concrete example

**Over-trimmed:** “Mounted plugins share the host's authority.”

**Balanced:** “Mounted plugins share the host's authority; for example, access to `ctx.shell` permits commands with the host executor's privileges.”

**Over-detailed:** A list of every service a plugin could misuse and every hypothetical exploit.

Keep one example when it makes an otherwise abstract security limit operationally clear.

## Delete reasoning transcripts entirely

**Over-detailed:** “First the loop checks whether the value is absent. If it is absent, the next branch returns early. Otherwise it continues, which is why the final assertion is safe.”

**Balanced:** No comment when the code already expresses those branches. If the early return protects a non-obvious invariant, state only that invariant.

Do not compress a reasoning transcript into shorter narration; remove it.

## Configuration comments explain what the tree cannot

**Over-detailed:** “This entry loads the local filesystem provider, followed by the policy plugin, followed by the read, write, and edit tools,” when the adjacent entries already show that order.

**Balanced:** “Load policy before the model-facing tools so their write and edit calls pass through the read-before-mutation gate.”

Keep the consequence of order, a surprising scope rule, or a security boundary. Let the configuration show its own inventory.

## Do not trim for word count alone

**Current:** “The adapter converts provider errors into the shared error type so callers can handle authentication, rate-limit, and transient failures uniformly.”

**Shorter but worse:** “The adapter normalizes provider errors.”

**Balanced decision:** Keep the current sentence unless a link or surrounding contract already lists the failure categories. The shorter version loses the consequence and distinctions without improving structure.

## Model-visible text follows ownership

**Over-trimmed:** “The tool returns errors when a call fails.”

**Over-detailed:** Copying another package's schema and renderer strings into this backend's README.

**Balanced:** Quote stable prompt, result, and error text owned by this package. Link the generated tool catalog for schemas and the consumer README for text another package owns; state only this package's conditions or deltas locally.

Wording that reaches a model is behavior, but duplication still drifts. Exactness belongs at the owner.

## Generated summaries must stand alone

**Over-trimmed:** “Approval request and policy service.” The owner explains policy order and audit logging later, but the catalog exports only its first sentence.

**Over-detailed:** Moving the service's full lifecycle and prompt-notice behavior into the extracted sentence.

**Balanced:** “Approval service that applies session policy before answerers and logs every ask/outcome pair to the requesting session.” Keep non-catalog detail in later sentences.

Know what the generator extracts. That fragment must preserve the contract needed on its generated output.

## Limitations are contracts, not debt inventories

**Over-trimmed:** Omitting a process-lifetime cache that makes configuration changes require plugin reload.

**Over-detailed:** Listing private helper cleanup and unused test-only accessors with no caller or maintainer consequence.

**Balanced:** “Provider selection is cached for the plugin lifetime; installing or repairing a provider requires reload.” Keep ordinary cleanup in its TODO or Agent Note.

Retain gaps and non-obvious constraints that affect use or safe maintenance. A package README is not a backlog dump.
