# web-cordis

[English](README.md) | 中文

[`@deepseek-ai/dsh-tool-cordis`](../../packages/extensions/tool-cordis/README.md) 的自指示例。agent（智能体）可以检查当前 Cordis 进程，并在内存中挂载或卸载模型编写的插件。临时插件会在卸载或进程退出时消失，并可能影响同一进程中的其他会话。

## 运行

启动浏览器界面：

```sh
pnpm run demo:cordis
```

改为启动 ACP（Agent Client Protocol）自动化服务器：

```sh
pnpm run demo:cordis acp
```

这两条命令都需要 `DEEPSEEK_API_KEY`。[Cordis 工具参考](../../packages/extensions/tool-cordis/README.md)定义了四类约定：工具参数、存续时间、清理行为和安全性。
