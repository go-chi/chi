# native/

[English](README.md) | 中文

与 DeepSeek Harness 一同维护的原生源码和公开包。[`landlock-run/` workspace](landlock-run/README.md) 负责 harness 使用的 Landlock 自限后执行启动器，包括其架构、由三个包组成的 npm 包家族、平台支持、开发工作流和[发布流程](landlock-run/docs/release.md)。

## Workspace 与发布边界

`landlock-run/` 及其包属于仓库根 pnpm workspace，并共用根锁文件。开发和 CI 中的 harness 消费方直接使用当前 workspace 的入口包，因此启动器约定变更与消费方更新可以在同一个改动中落地并一起测试。

主仓库的 `Landlock Run` 工作流为每个受支持架构构建并测试。`Landlock Run Release` 汇集这些原生产物，打包并验证三个 npm tarball，随后可选择以同一个启动器版本发布。入口包继续将平台包声明为 npm 可选依赖，因此 npm 仍然只会安装与用户操作系统和 CPU 匹配的包。
