# @deepseek-ai/dsh-code-runtime

[English](README.md) | 中文

**`CodeRuntime`**（`ctx.codeRuntime`）定义代码运行时做什么，即针对宿主提供的一组异步绑定运行一段模型编写的程序，并报告 `{ value, logs, error? }`，而不规定如何实现。

此包承担该能力的 Service Definition 角色（以 bash 三包结构为模板，参见[能力 seam](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)）：提供方通过继承 `CodeRuntime` 并注册服务接入；Consumer 是工具注册表的 Code Mode，它生成面向模型的 SDK，并桥接工具分发。这两项职责均由 [Code Mode Agent Note](../../../.agents/notes/implemented/feature/2026-06-15-code-mode.md) 规定，首个提供方是 Node worker 线程后端。运行时不了解工具或会话：调用方只向它提供具名异步函数与程序字符串；所有与工具有关的内容都留在 Consumer。

## 服务 API（`ctx.codeRuntime`）

| 成员 | 语义 |
|---|---|
| `run(request)` | 针对请求的绑定执行一段程序。**所有程序失败结果都通过 resolve 结果中的 error 字段报告**：包括解析／转换失败、抛出异常、无效完成值、输出溢出、预算到期、中止或执行基底终止（由 `CodeRunFailure` 的正交 `kind` 分类表示）；只有调用方误用 Service Definition 约定时才 reject（例如 dispose（资源释放）后仍提交运行）。程序作为异步函数的函数体运行，因此顶层 `await`／`return` 可用，无损 JSON 完成值会成为 `result.value`。 |
| `language` | 只读描述符：`run` 期望的源语言。已知值为 `'typescript'` 与 `'python'`——`dsh-tools` 能呈现的那些；其中只有 `'typescript'` 有已发布的后端。仅供参考，不作门禁；生成语言专用呈现的消费方会根据该值选择分支，遇到无法呈现的语言时明确失败。 |
| `isolation` | 只读描述符：执行基底（`'worker-thread'`、`'process'`、`'container'`）。供部署与诊断使用，**不构成安全声明**。 |

每个实现都必须遵守以下语义（完整约定见类 JSDoc）：绑定调用会桥接完整的无损 JSON 参数与 resolve 值，seam 层不设字节上限；程序被视为敌对对等方（任意绑定名称都会成为自有属性，格式错误的通信绝不能使宿主崩溃）；不同运行之间不保留任何状态；dispose 会终止进行中的运行，并且在完成前等待其退出。

## 词汇

`CodeRunRequest`（`program`、`bindings`、`signal?`）携带运行时操作所需的全部内容；默认值解析（时间预算与外层输出上限）属于提供方的已验证配置，绝不能是隐藏的 `??`，更不能藏在 `run()` 内部。`bindings` 是 `CodeBindingNamespace` 列表（`global` + `functions` + 可选 `errorClass`）；每个命名空间会作为一个由异步可调用函数组成的全局对象公开给程序，这些函数返回 `CodeJsonValue`。后者是服务本地、与规范 `JsonValue` 结构等价的类型，使 Service Definition 包保持独立于会话。`errorClass` 描述符点名真实的程序全局构造器，以及用于接收被拒绝成员名称的自有属性；运行时不依赖 `ToolCallError` 等 Consumer 术语。`CodeRunResult` 报告无损 JSON 完成值 `value?`、有序的 `logs: string[]` 和 `error?`（`CodeRunFailure`：`kind` + 可反馈给模型的 `message`）。完整约定见 `src/types.ts`。

binding-global 与 error-class 名称是**语言可移植**的：必须匹配标识符子集 `[A-Za-z_][A-Za-z0-9_]*`（不含 JS 专有的 `$`）并通过 seam 导出的排除集，因此同一份 `bindings` 列表对每个后端都有效，无论其 `language` 为何。本包导出每个后端都执行的约定——`PORTABLE_RESERVED_WORDS`（ECMAScript ∪ Python 保留字）、`RESERVED_BINDING_GLOBALS`（如 `console` 等后端拥有的 global）、`RESERVED_ERROR_MEMBERS` 与 `DUNDER_MEMBER`（error-member 排除）——因此 `$tools`、`lambda`、`__dsh_main__` 之类的名称会让 `run()` 在任何后端上作为 seam 误用而 reject，而非只在某些后端。确切集合与理由见 `src/index.ts`。

## 模型体验

通过 `dsh-tools` 中的 Code Mode 间接提供；后者公开 `run_code`，并将程序日志、值或失败作为保留的工具结果 token 返回。

#### KV Cache 影响

不会直接失效；由上述消费方负责请求前缀变更。

## 已知限制与暂缓事项

- **`run()` 是一次性的**：`logs` 只有在 `CodeRunResult` resolve 后才能获得；seam 不提供正在运行的程序所产生输出的流式日志或进度接口。
- **持久 REPL 风格内核已记录为未来工作**：在持久内核后端带来自己的日志方案前，运行之间不保留状态的约定继续有效（参见 [Code Mode Agent Note](../../../.agents/notes/implemented/feature/2026-06-15-code-mode.md)）。
- **目前只提供 worker 线程后端**：`'process'`／`'container'` 是已经声明但没有实现的已知 `isolation` 值；强安全边界需要等待容器后端。
- **中间绑定值没有字节上限**：实现仍受 structured-clone 成本与进程内存约束，而提供方或执行器可能已经应用自己的获取上限。
