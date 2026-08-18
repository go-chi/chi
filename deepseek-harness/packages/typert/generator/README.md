# @deepseek-ai/dsh-typert-generator

English | [中文](README.zh.md)

TypeScript project analyzer and model-driven Typert generator. It converts the developer-authored source type tree into compiler-independent `FaceModel` and `TypeGraph` data before any artifact is rendered. Static analysis can consume that model without Cordis; emitters never receive TypeScript AST or checker objects.

The analyzer can use independent `ts.Program` instances seeded from `tsconfig.host.json` or `tsconfig.client.json`. Direct project references establish compiler-face membership, while package subpaths establish Typert runtime-face contributions: an ordinary single-project package declaring `dsh.client` may contribute both Host and Client runtime models, and only a split project explicitly referenced through `tsconfig.host.json` or `tsconfig.client.json` is restricted to that corresponding face. `package.json#exports` establishes every cross-package public boundary, and source imports or re-exports are the only allowed cross-face edges. Types owned by NPM dependencies, including global declarations from `@types` packages, remain `external` references instead of being expanded.

## Analysis Model

Each face contains package exports, Cordis services and events, explicitly tagged objects and schemas, and a type graph for their reachable declarations. The graph preserves declaration identity, generic parameters and applications, explicit inheritance, conditional and mapped types, import attributes, abstract modifiers, and source JSDoc. Service and `@typert object` APIs expose public instance members only; constructors, static members, and non-public members are excluded.

`WorkspaceAnalyzer` defaults to `check` mode and fails on TypeScript syntax or semantic diagnostics, missing reachable public annotations, private cross-package references, and reachable declaration merges that the model cannot retain losslessly. `write` mode inserts checker-derived annotations, rebuilds the program, and returns a clean check-mode model.

## Emission and Opt-in Publication

`FaceModelEmitter` consumes only the model. It emits executable JavaScript containing supported Zod schemas and a `TYPERT` contribution, plus a declaration file whose schemas are typed as `z.ZodType<SourceType>` through the package's public export. Unsupported Zod projections fail instead of flattening or weakening the source type.

`WorkspaceTypertGenerator` discovers contributors by walking package public exports reachable from Cordis `Context` or `Events` augmentations and explicit `@typert` declarations. When invoked for artifact publication, it requires host artifacts at `lib/typert.host.{js,d.ts}` exposed as `package/typert`, and client artifacts at `lib/typert.client.{js,d.ts}` exposed as `package/client/typert`. Generated declarations expose `TYPERT` as `unknown`, so contributing business packages do not depend on the runtime registry.

Publication is package opt-in, and business packages without the corresponding public entry do not need Typert artifacts. The repository's Host tsdown runs workspace Typert generation with `tsconfig.host.json` as its only program seed; it produces both Host reflection artifacts and the `typert.remote-client.*` projection of Host Remote contracts for the Client. The subsequent Client tsdown neither starts Typert nor analyzes `tsconfig.client.json`. Static consumers can still call `WorkspaceAnalyzer` directly, explicitly select a face and package subset, and process packages in batches without publishing or loading runtime artifacts.

## Repository-specific Cordis projection

The root package export includes the model-driven extraction, completeness checks, and deterministic text renderers used by this repository's Cordis catalogs. They accept a `CordisCatalogPolicy`; repository-owned type links, foundation/exemption classifications, and inherited Cordis entries remain in `scripts/gen-cordis-catalog.ts` and are passed in explicitly. The generator package therefore contains projection mechanics, not a hidden copy of this repository's documentation taxonomy.

## Model Experience

None, as this package runs at build or test time and never contributes to a model request.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Package export patterns are skipped; contributing packages need concrete export targets.
- Cross-face named and star re-exports produce links; namespace re-exports fail until `TypeTargetModel` can represent a module namespace without flattening it.
- The Zod emitter supports a deliberate subset of the modeled TypeScript graph. Generic schema declarations and computed constructs such as conditional or mapped schema roots fail until a concrete schema-factory policy exists.
- Cross-face links are represented for analysis, but no generated schema currently requires a runtime cross-face Zod import.
- Discovery follows source files reachable from concrete public exports; declarations that are neither exported nor imported by that graph are intentionally outside the package model.
