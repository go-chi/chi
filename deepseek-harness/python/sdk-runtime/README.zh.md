# DeepSeek Harness 运行时 wheel 包

[English](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk-runtime/README.md) | 中文

Python SDK 的运行时载体包（分发名 `deepseek-harness-runtime-bin`，模块名 `deepseek_harness_runtime`）：它定位 `deepseek-harness-sdk` 客户端要 spawn 的内置运行时二进制，并附带支撑零配置运行的默认配置。

## 运行时载体

两种载体并存于 `src/deepseek_harness_runtime/runtime/` 之下，均由仓库的 `scripts/build-exe-for-python-sdk.ts` 构建注入，且均被 git 忽略：

- **exe（生产）**——单文件 Node 可执行程序 `dsh-jsonrpc-agent-pkg-<platform>-<arch>`（platform：`linux`/`macos`；arch：`x64`/`arm64`）。macOS 构建还会随附 `node-pty` 在该平台使用的原生 `-spawn-helper` 伴随文件。目标机器无需安装 Node。这是唯一随 wheel 包分发的载体；本包不发布 sdist。
- **node（仅限开发）**——`runtime/node/` 下的完整部署闭包（`package.json` + `node_modules/`），在系统 Node >= 22.19 上以 `node runtime/node/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js` 执行。它是当前检出的源码构建，仅用于仓库本地的开发与验证；不会被自动选中，也不进入分发物。

两种载体承载相同的内容，且只定义一次：本包根目录的 [package.json](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk-runtime/package.json) 是 single-exe 流水线的部署根目录——一份零代码的纯依赖 manifest，其依赖闭包既是编译进 exe 的插件集，也是物化到 `runtime/node/` 的文件树。往分发物里加插件，就是在那里加一行依赖再重新构建。

exe 缺失时抛出 `FileNotFoundError`，并写明两种获取途径：在 deepseek-harness 检出中经 `scripts/build-exe-for-python-sdk.ts` 构建，或安装 `build-exe-for-python-sdk` CI 工作流生成的对应平台运行时 wheel 包。仅限开发的 node 载体缺失时只提示构建脚本这一条途径。该工作流只保留 wheel 包，不保留独立 exe 归档。获取策略与查找接口刻意分离，之后可以换成按需下载而不改动任何调用方。

每个 wheel 包只包含一个运行时可执行文件。macOS wheel 包还包含与其匹配的原生 spawn helper；缺少伴随文件意味着该安装不完整，并会在启动时硬失败，即使所选 Cordis 组合不使用 PTY 工具也是如此。Linux wheel 包不包含 spawn helper，因为 `node-pty` 直接使用暂存的 `pty.node` 原生插件。固定标签为 `py3-none-manylinux_2_28_x86_64`、`py3-none-manylinux_2_28_aarch64` 与 `py3-none-macosx_14_0_arm64`；macOS 标签保守匹配内置 Node 24 可执行文件的 macOS 13.5 部署目标。本包的 `platforms.json` 统一定义仓库发行构建器与隔离构建钩子使用的固定标签和可执行文件名。构建钩子会拒绝 `py3-none-any`、不存在运行时文件、存在多个运行时文件、文件不可执行以及不支持的平台标签。仓库根目录的 `package.json` 为本包和 SDK 提供共同版本，`python-v<repository-version>` 发布标签必须与其匹配。

## 解析 API

- `resolve_bundled_launch_args(mode=None) -> tuple[str, ...]`——启动内置运行时的 argv 元组：exe 模式下为 `(exe_path,)`，node 模式下为 `(node_path, bin_js_path)`。模式选择：显式参数 > `DSH_RUNTIME_MODE` 环境变量（`exe` | `node`）> 自动。自动解析只找生产 exe——仅限开发的 node 载体必须显式选用，从而生产部署绝不会悄悄跑在源码构建上。
- `bundled_runtime_path() -> Path`——平台 exe 路径（仅 exe 载体，并会在 macOS 上校验必要的 `-spawn-helper` 伴随文件也已安装）。node 载体没有单一路径的等价物，经由上面的 argv 元组启动。
- `bundled_default_config_path() -> Path`——检入的默认配置（见下文）。
- `bundled_package_dir() -> Path`——已安装包的数据根目录。

## 零配置设计

运行时二进制始终要求显式配置（`$DSH_CORDIS_CONFIG`，或作为 argv 位置参数的配置路径），缺了就报错退出——这一强制语义是运行时设计的一部分，本包不会弱化它。bin（`dsh-jsonrpc-agent`）只启动配置里列出的插件；对外服务接口（stdio JSON-RPC 服务器）也是其中一个条目（`@deepseek-ai/dsh-sdk-jsonrpc-server`），缺了它，启动出的 agent（智能体）就没有对外通道。本包检入的 `runtime/cordis.yml` 包含 JSON-RPC 服务条目、agent 核心、预载的 DeepSeek 适配器、JSONL 持久化、显式组合的语义检查点策略、本地 bash，以及用于有界加载工作区指令的本地文件系统提供方。持久化后端负责持久存储，独立的策略则选择请求、工具分发和已完成步骤的检查点。DeepSeek 适配器读取 `DEEPSEEK_API_KEY` 与 `DEEPSEEK_BASE_URL`，持久化、bash 和文件系统提供方则使用 `DSH_SESSION_ROOT` 和 `DSH_CWD`，并为手动运行提供回退值。调用方未使用任何显式配置通道时，`deepseek_harness` 客户端把该文件路径注入 `DSH_CORDIS_CONFIG`（注入条件见 [sdk README](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk/README.md)）。因此，零配置是包装层中一次显式、可见的参数传递，而不是运行时中的隐藏回退。
