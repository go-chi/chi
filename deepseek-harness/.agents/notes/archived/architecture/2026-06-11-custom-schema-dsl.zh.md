# Agent Note: 使用自定义类型化工具 schema DSL 替代 schemastery

Status: implemented
Archived: 2026-07-26

[English](2026-06-11-custom-schema-dsl.md) | 中文

## 问题

工具参数必须以标准 JSON Schema 形式到达模型，同时让工具作者在 `execute(args)` 中获得类型化的参数而无需类型断言。Schemastery 已用于插件配置，但工具作者 API 需要逐属性的 `required: true` 布尔值，而非 JSON Schema 的独立 `required` 数组。

## 决策

该决策已由[统一 JSON 值 schema DSL](2026-07-20-unified-json-value-schema-dsl.md)取代；新设计保留小型编写接口，同时让参数与类型化值共享一套词汇。`ParameterSchemaSpec` 保留逐属性的 `required: true`；`InferArgs<S>` 将必需键映射为非可选属性；`parameterSchemaSpecToJsonSchema()` 编译隐式开放的对象根；`defineTool()` 则将类型推导、编译与校验串联起来。原始 JSON Schema 的 `ToolDefinition` 仍是 `ToolRegistry.register()` 接受的输入，供 MCP 和其他外部工具使用。

## 曾考虑的替代方案

**Schemastery**（已作为 vendor 引入，用于插件 Config）经评估后被否决：它面向的是基于 StandardSchema 的校验／转换，而非 JSON Schema *生成*，因此会增加间接层却无法干净地产出协议格式（wire format）。

## 后果

- 第一方工具作者获得零类型断言的类型化参数；类型体操的成本留在核心包内部（符合 AGENTS.md 的类型安全策略）。
- 当前节点、字面量约束、联合类型、JSON 值边界与对象开放性规则均由上述统一说明定义。
- `InferArgs` 映射在类型层面有回归测试，源于早期一个可选性 bug。
