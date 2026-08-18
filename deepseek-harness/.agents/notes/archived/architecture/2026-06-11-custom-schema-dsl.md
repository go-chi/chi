# Agent Note: Custom typed tool-schema DSL instead of schemastery

Status: implemented
Archived: 2026-07-26

English | [中文](2026-06-11-custom-schema-dsl.zh.md)

## Problem

Tool parameters must reach the model as standard JSON Schema while giving tool authors typed `execute(args)` without casts. Schemastery already serves plugin config, but the tool-author API needs per-property `required: true` booleans rather than JSON Schema's separate `required` array.

## Decision

This decision is superseded by the [unified JSON-value schema DSL](2026-07-20-unified-json-value-schema-dsl.md), which retains the small authoring surface while making parameters and typed values share one vocabulary. `ParameterSchemaSpec` keeps per-property `required: true`; `InferArgs<S>` maps required keys to non-optional properties; `parameterSchemaSpecToJsonSchema()` compiles the implicit open object root; and `defineTool()` ties inference, compilation, and validation together. Raw JSON-Schema `ToolDefinition`s remain accepted by `ToolRegistry.register()` for MCP and other external tools.

## Alternatives considered

**Schemastery** (already vendored, used for plugin Config) was evaluated and rejected for this use: it targets validation / transformation against StandardSchema, not JSON Schema *generation*, so it would add indirection without producing the wire format cleanly.

## Consequences

- First-party tool authors get zero-cast typed args; the type gymnastics cost stays inside the core package (sanctioned by the AGENTS.md type-safety policy).
- The owning unified note defines the current nodes, literal constraints, unions, JSON-value boundary, and object-openness rules.
- The `InferArgs` mapping is regression-tested at the type level after an early optionality bug.
