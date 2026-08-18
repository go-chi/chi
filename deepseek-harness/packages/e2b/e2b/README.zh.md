# @deepseek-ai/dsh-e2b

[English](README.md) | 中文

一个 E2B 沙箱的共享生命周期所有者。文件系统与进程管理适配器注入 `ctx.e2b`，等待其唯一的 SDK 句柄，因此处于同一个远程 Linux 工作树与进程环境中。本包固定使用 `e2b@2.29.1`；可选组合见[包族索引](../README.md)。

## 配置

```yaml
- id: e2b
  name: '@deepseek-ai/dsh-e2b'
  config:
    cwd: /home/user/workspace
    timeoutMs: 300000

- id: subprocess-e2b
  name: '@deepseek-ai/dsh-subprocess-e2b'

- id: fs-e2b
  name: '@deepseek-ai/dsh-fs-e2b'
```

`apiKey` 可省略；省略时读取 `E2B_API_KEY`。该密钥只配置宿主 SDK 连接，绝不会安装进沙箱。`cwd` 默认为 `/home/user/workspace`，并且必须是绝对 POSIX 路径。`timeoutMs` 默认为 5 分钟并控制沙箱生命周期；超时会删除沙箱。

## 生命周期与所有权

构造阶段会启动一次沙箱创建。服务在 `getSandbox()` 成功返回前，会创建 `cwd` 和私有的 `cwd/.dsh-e2b` 适配器状态目录，验证该预留路径是真实目录而非符号链接或其他文件类型，再把该目录的 mode 设为 `0700`。每个适配器内部的 E2B 命令 shell 都会获得一个位于根目录下、全新随机生成的 `HOME`，因此 SDK 固定使用的登录 shell 不会在控制命令之前解析可变用户主目录中的配置文件。

资源释放会先阻止继续获取新句柄，再等待初始化完成，然后删除沙箱。`SandboxNotFoundError` 表示沙箱已因超时或被另一个所有者删除，因此可视为完全停稳。初始目录设置失败时会尝试删除一次；若该尝试也失败，则由已配置的 E2B 超时约束沙箱的存活时间。提供方插件必须在该所有者之后加载，并在其之前 dispose（资源释放）。

## 模型体验

无。本共享运行时所有者不注册模型可见上下文；提供方适配器及其消费方拥有所有渲染效果。

#### KV Cache 影响

不会直接失效；本包不会贡献请求 token。

## 已知限制与延后工作

- **这不是完整的 harness 运行时**：Cordis 服务、agent（智能体）／会话状态、会话日志、LLM（大语言模型）请求、skill（技能）和 SDK 侧缓冲仍留在宿主进程中。
- **沙箱状态是短暂的**：资源释放和超时都会删除沙箱；重新连接、pause/leave 保留、模板、卷和快照均不在本 POC 范围内。
- **没有配置部署平台**：网络策略、宿主工作区同步和沙箱发现均不在本 POC 范围内。
- **`cwd` 是解析约定，而不是包含边界**：适配器和命令可以访问沙箱中的其他路径；E2B 网络访问也继续采用基础镜像的策略。
