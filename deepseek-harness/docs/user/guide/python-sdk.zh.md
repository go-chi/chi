# Python SDK 快速上手

[English](python-sdk.md) | 中文

本教程介绍 Web UI 之外的程序化使用方式：安装已发布的 Python SDK、运行仓库内置的 agent（智能体）组合，并在自己的程序中调用同一套 API。

## 前置要求

- Python 3.10 或更高版本
- Git
- Linux x64、Linux arm64 或 macOS 14 或更高版本的 arm64
- DeepSeek 兼容的 API 端点与凭据
- agent 可以修改的隔离 workspace

## 安装 SDK

克隆仓库以使用其中的可运行示例，创建虚拟环境，并安装 SDK 及其同版本内置运行时：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
python -m venv .venv
. .venv/bin/activate
python -m pip install deepseek-harness-sdk
```

安装后的运行时不需要系统提供 Node.js。需要从源码构建运行时或 wheel 包的仓库贡献者应使用 [Python 贡献者工作流](../../../python/development.md)。

## 运行仓库内置示例

请在环境中设置凭据。如果模型不是由默认 DeepSeek 端点提供，而是通过 OpenAI 兼容代理提供，还需要设置 `DEEPSEEK_BASE_URL`。

```sh
export DEEPSEEK_API_KEY=sk-your-key-here
# export DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1
# export DSH_MODEL=deepseek-v4-flash
# export DSH_SYSTEM_PROMPT='You are a helpful software engineer assistant.'
```

针对隔离的 workspace 和会话目录运行一个任务：

```sh
python examples/jsonrpc-agent/minimal.py \
  --workspace /absolute/path/to/workspace \
  --session-root /absolute/path/to/sessions \
  --session-id example-001 \
  "Inspect the repository and fix the failing tests."
```

脚本会打印 assistant 的最终回复。会话目录会收到 JSONL 日志，其中包含组装后的模型请求与工具调用。

## 在自己的程序中使用 SDK

仓库内置示例是以下 SDK 调用的轻量包装：

```python
from pathlib import Path

from deepseek_harness import DeepSeekHarness

config = Path("examples/jsonrpc-agent/minimal.cordis.yml").resolve()
workspace = Path("/absolute/path/to/workspace").resolve()
sessions = Path("/absolute/path/to/sessions").resolve()

with DeepSeekHarness(
    provider="deepseek-official",
    model="deepseek-v4-flash",
    max_tokens=49_152,
    cwd=str(workspace),
    session_root=str(sessions),
    cordis=str(config),
) as harness:
    result = harness.run(
        "Inspect the repository and fix the failing tests.",
        session_id="example-001",
    )

print(result.final_response)
```

`DeepSeekHarness` 会延迟启动内置运行时，并持续复用，直至退出上下文管理器。复用同一个 harness 与 session id 会保留该会话拥有的 Bash 进程，包括其工作目录、已导出的变量与 shell 函数。独立任务应使用新的 session id；只有下一次调用需要延续同一段持久化对话时，才复用原有 id。

## 了解示例组合

| 属性 | 值 |
|---|---|
| 系统提示词 | `DSH_SYSTEM_PROMPT`；未设置时使用 `You are a helpful software engineer assistant.` |
| `minimal.py` 使用的模型 | `--model`，其次为 `DSH_MODEL`，最后为 `deepseek-v4-flash` |
| 面向模型的工具 | 仅持久 `bash` 与 `str_replace_editor` |
| Bash 超时 | 300 秒 |
| 编辑器输出上限 | 16,000 个字符 |
| 上下文压缩 | 已关闭 |
| 文件系统 | 裸本地后端；编辑器使用绝对路径，可以访问运行时进程可见的任何路径 |
| 会话持久化 | `DSH_SESSION_ROOT` 下未压缩的 JSONL |

该组合省略了 harness 身份、workspace 提示词文本、skill（技能）、一次性 Bash、任务工具、上下文压缩和其他所有面向模型的插件。沙箱策略事实记录为运行时用户上下文，而不会追加到系统提示词中。

## 选择 workspace 与 session id

`cwd` 用于选择 agent 可访问的 workspace，`session_root` 用于保存会话日志和状态。独立任务应使用新的 session id；只有下一次调用需要延续同一段对话和持久 shell 状态时，才复用原有 id。

该组合使用 `danger-full-access`。只能在可丢弃的 checkout 或容器内运行：Bash 与编辑器可以修改运行时进程有权访问的任何路径。持久 PTY 后端需要 POSIX 终端环境，因此该组合不支持 Windows agent。

准确的组合内容归 [`jsonrpc-agent` 示例参考](../../../examples/jsonrpc-agent/README.md)所有。[Python SDK 参考](../../../python/sdk/README.md)介绍生命周期、结果、通知、运行时选择和配置；[Cordis primer](../../cordis-primer.md)介绍组合语法。
