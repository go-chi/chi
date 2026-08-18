# @deepseek-ai/dsh-tool-str-replace-editor

[English](README.md) | 中文

基于 `ctx.fs`、面向模型的独立 `str_replace_editor`。它可与持久 Bash、一次性 Bash、沙箱 Bash 或其他终端接口组合。

## 配置

| 键 | 默认值 | 含义 |
|---|---:|---|
| `maxOutputChars` | `16000` | 文件和目录查看结果保留的前缀字符数。 |
| `description` | 编辑器命令指南 | 面向模型的工具描述。 |

## 工具

schema 提供针对绝对路径的 `view`、`create`、`str_replace` 与 `insert`。文件查看使用从 1 开始的行号，并保留内容中的制表符，因此显示的文本仍可作为有效的字面量替换输入；目录查看忽略隐藏、依赖与 Python 缓存条目并下探两层。`view`、`str_replace` 或 `insert` 发生元数据未命中时，工具会在返回 `FS_NOT_FOUND` 前记录确认缺失，因此后续 `create` 可以通过已挂载策略的防护创建流程恢复外部删除的路径；缺失状态绝不会授权 `str_replace` 或 `insert`。替换要求字面量唯一匹配，错误只使用公开的 `old_str` 词汇。插入遵循所选的零基插入边界，不会隐式补尾换行。修改操作会保留请求编辑范围之外的制表符。

## 模型体验

### 工具 schema

#### 模型看到的内容

生成的 [`str_replace_editor` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-str-replace-editor)，其中包含配置的 `description`。本插件不贡献独立系统提示词段。

#### Token 影响

`str_replace_editor` 可见时产生固定的 schema 成本。

#### KV Cache 影响

配置的描述与 schema 不变时前缀稳定。

### 工具结果

#### 模型看到的内容

查看操作返回带行号文本或浅层目录列表。调用会提供文件位置，创建/替换调用还会向展示层提供 diff 卡片。修改操作返回简洁确认。长查看结果保留前缀并追加截断提示。

#### Token 影响

随数据变化，并受 `maxOutputChars` 与固定截断提示约束。

#### KV Cache 影响

工具结果以追加方式位于可复用请求前缀之后。

## 已知限制与暂缓事项

- 操作面向 UTF-8 文本，不支持二进制文件。
- `str_replace` 刻意拒绝零匹配或多匹配，且没有 `replace_all` 参数。
- 每个修改操作都会经过 `fs/write-intent` 或 `fs/edit-intent`，解析当前会话的沙箱策略，并交由挂载的文件系统与策略插件实施约束。
