# Typert

[English](README.md) | 中文

Typert 将源代码分析、运行时存储和 Loader 发现机制分离。

| 包 | 职责 | Cordis 键 |
|---|---|---|
| [`registry/`](registry/README.md) | 存储运行时包反射和 schema | `ctx.typert` |
| [`loader/`](loader/README.md) | 发现 Loader 条目并注册生成的宿主产物 | 使用 `ctx.loader`、`ctx.typert` |
| [`generator/`](generator/README.md) | 从源代码类型生成运行时产物 | 构建时库 |
