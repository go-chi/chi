# @deepseek-ai/dsh-tool-lsp

[English](README.md) | 中文

面向模型的 **`lsp` 工具**，基于 `ctx.lsp`：一个只读工具，通过四种操作执行精确代码导航。它拥有模型 schema、提示词指引、坐标转换、结果限制与格式化，以及 UI 呈现；不导入任何提供方。

Namespace 插件（`name`／`inject`／`Config`／`apply`，无默认导出）。注入 `tools`、`lsp` 和 `systemPrompt`。

## 工具

`lsp` 接受 `operation`（`goToDefinition` | `findReferences` | `goToImplementation` | `hover`）、`file_path`、`line` 和 `character`。`line` 与 `character` 是正的、从 1 开始的 UTF-16 光标坐标；工具将其转换为 seam 从零开始的位置，并把渲染位置转换回来。`findReferences` 包含声明，因此影响分析不会遗漏定义位置。提供方、language id、工作区根目录、限制、超时、初始化和可执行文件均不进入模型输入。

该工具要求从会话 `header.cwd` 取得工作区根目录，没有回退值：缺失时会在查询前以 `LSP_WORKSPACE_REQUIRED` 失败。其规范结果是完整的已规范化 Service Definition 联合类型：`{ kind: "locations", locations, resolvedWorkspaceUri }` 或 `{ kind: "hover", hover }`；Code Mode 可以直接检查每个已取得的位置和从零开始的范围。原生渲染以提供方的规范工作区 URI 为基准，投影按文件稳定分组的 `path:line:character` 条目，而不对会话 cwd 应用宿主平台路径规则。`file:` URI 落在该工作区 URI 内时成为工作区相对路径，位于其外时成为从 URI 派生的绝对路径；格式错误的 URI 与非 `file:` URI 保持原样。空位置和 `null` hover 都是成功的无结果响应；格式错误的提供方载荷仍是结构化错误。

## 配置

| Key | 默认值 | 含义 |
|---|---|---|
| `maxLocations` | `100` | 出现省略标记前可渲染位置的最大数量。 |
| `maxResultChars` | `16000` | 完整渲染结果的最大长度，包括截断元数据。 |
| `timeoutMs` | `60000` | 由 `dsh-tool-call-timeout-policy` 强制执行的工具调用超时预算；覆盖完整的排队打开／查询／关闭生命周期，且模型不可配置。 |

## 模型体验

### 系统提示词

#### 模型看到的内容

一个系统提示词区段（顺序 112）将 LSP 定位为精确辅助工具，文本如下：

##### 逐字指引

```markdown
Use search/read for ordinary navigation. Use lsp when textual matches are ambiguous or before a change requires precise definitions, implementations, or references. Positions are one-based line and character (UTF-16) at the cursor; an off-symbol position may return no results. findReferences always includes the declaration.
```

#### Token 影响

插件处于活跃状态时，每次请求承担固定指引成本。

#### KV Cache 影响

只要插件 scope 与指引文本不变，前缀就保持稳定；激活或 dispose（资源释放）可能使从该区段起的复用失效。

### 工具 schema

#### 模型看到的内容

模型会看到生成的 [`lsp` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-lsp)。

#### Token 影响

启用期间，每次请求承担固定 schema 成本；`timeoutMs` 预算绝不会发给模型。

#### KV Cache 影响

只要可见工具定义与顺序不变，前缀就保持稳定；注册生命周期或 scope 限制可能使从第一个变化的 schema token 起的复用失效。

### 结果

#### 模型看到的内容

按文件分组的 `path:line:character` 位置行或规范化 hover 文本，先由 `maxLocations` 限制，再由 `maxResultChars` 限制；省略与截断标记计入完整字符上限。这些上限只影响原生／模型呈现，不影响规范值。空结果使用不同的 `No results.`／`No hover information.` 行。

#### Token 影响

每项工具结果以 `maxResultChars` 为上限，`maxLocations` 还会限制导航项数量。

#### KV Cache 影响

工具结果追加在已缓存请求前缀之后，不会直接使其失效。

### UI 呈现

#### 模型看到的内容

无。客户端渲染通用搜索卡片：`{ card: 'generic', kind: 'search', title, locations: [{ path, line }] }`；从 args 派生的标题携带操作与从 1 开始的光标，跟随焦点对准查询行，标题则保留列号。

#### Token 影响

直接 token 影响为零，因为渲染只发生在客户端。

#### KV Cache 影响

无；UI 呈现位于模型请求之外。

## 已知限制与暂缓事项

- **UTF-16 光标坐标**：列坐标与协议精确一致，但模型难以在非 BMP 字符周围计数；未落在符号上的位置可能返回空结果，因此提示词解释了该约定，但不鼓励广泛使用 LSP（见 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-07-15-lsp-capability-seam.md)）。
- **不承诺跨服务器完整性**：受支持的服务器仍可能根据索引就绪情况返回空或部分结果；该工具不承诺跨语言或服务器的完整性。
