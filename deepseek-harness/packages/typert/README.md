# Typert

English | [中文](README.zh.md)

Typert separates source analysis, runtime storage, and Loader discovery.

| Package | Role | Cordis key |
|---|---|---|
| [`registry/`](registry/README.md) | Stores runtime package reflection and schemas | `ctx.typert` |
| [`loader/`](loader/README.md) | Discovers Loader entries and registers generated host artifacts | consumes `ctx.loader` and `ctx.typert` |
| [`generator/`](generator/README.md) | Generates runtime artifacts from source types | build-time library |
