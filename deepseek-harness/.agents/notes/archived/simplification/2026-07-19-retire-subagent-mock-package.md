# Agent Note: Retire the standalone subagent mock package

Status: implemented
Archived: 2026-07-26

English | [中文](2026-07-19-retire-subagent-mock-package.zh.md)

## Problem

`@deepseek-ai/dsh-subagent-mock` was a configurable test double packaged as a workspace plugin. Its only external consumers were the `tool-subagent` unit suite and the tool-catalog generator; no runtime package, example, snapshot configuration, or real provider loaded it.

That narrow fixture carried a manifest, exports, peer and development dependencies, project references, package README obligations, Loader composition tests, module-graph membership, and documentation exceptions. The tool-catalog generator mounted it only to make production consumers register their schemas and never executed a child.

## Decision

The standalone package is deleted. Its scripted child behavior now lives in `packages/subagent/tool-subagent/tests/scripted-provider.ts`, where tests mount the real `SubagentService`, provider registry, tool implementation, and task runtime while replacing only the nondeterministic child boundary.

The local fixture retains deterministic replies, structured results, stop reasons, cancellation before and after publication, conversation-inheritance descriptors, and effect-scoped disposal. Package-specific Schemastery and Loader-export tests disappear because the fixture is no longer a deployable plugin.

The tool-catalog generator registers a minimal local `SubagentProvider` descriptor before mounting `ToolSubagent` or the workflow engine. The descriptor cannot start a child; it exists only to satisfy production load-time dependencies while harvesting schemas from the real consumers.

Workspace project references, package dependencies, lockfile entries, graph metadata, support-package prose, config-catalog entries, and README gate exceptions no longer name the retired package.

## Alternatives considered

**Keep a reusable mock package for future tests.** Reuse never materialized outside one test file and one generator. A future second behavioral consumer can extract a shared fixture after its contract is known; pre-packaging it made test infrastructure look like a supported backend.

**Generate subagent schemas without mounting production consumers.** Hand-constructing or importing schemas would weaken the catalog check that the real registry and tool composition expose the documented shape. A minimal provider descriptor preserves that check without carrying executable fake-backend behavior.

## Consequences

- The workspace has one fewer deployable package and no test-only node in the capability or module graphs.
- `tool-subagent` tests retain foreground, background-task, lifecycle, cancellation, reply, stop-reason, and structured-result coverage through production services.
- Tool-catalog output remains generated from production registrations and is byte-for-byte unchanged.
- Runtime and example packages gain no dependency on test fixtures.
