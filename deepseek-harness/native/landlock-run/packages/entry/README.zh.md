# @deepseek-ai/node-addon-landlock-run

[English](README.md) | 中文

用于在 Linux 上限制子进程的 Landlock「先限制自身、再执行」启动器：此入口包定位对应平台的预构建二进制文件，运行功能性强制执行探测，并构建其授权 argv。消费方无需自行拼写启动器标志或解析启动器输出。

```js
import { grantArgs, launcherPath, probe } from '@deepseek-ai/node-addon-landlock-run';

const launcher = launcherPath();
if (probe(launcher) !== 'unusable') {
  const argv = [launcher, ...grantArgs({ readOnly: ['/'], readWrite: ['/tmp/work'] }), '--', 'bash', '-c', command];
}
```

启动器在自身上安装 Landlock 规则集，再 `exec` 被包装的命令；该规则集会跨 `execve` 继承，因此整个进程树都在限制下运行。未授予的一切都被拒绝；启动器失败时以 `125` 退出且不运行命令：采用失败闭合策略，绝不在失败时放行。二进制约定锁定在仓库的 `docs/cli-contract.md` 中；C 源码作为 `src/main.c` 随该 tarball 分发，便于审计。

平台包（由 `os`/`cpu` 选择的可选依赖，内部不含 JavaScript）：`@deepseek-ai/node-addon-landlock-run-linux-x64`、`@deepseek-ai/node-addon-landlock-run-linux-arm64`。在缺少对应包的宿主上，`launcherPath()` 返回一个固定但不存在的路径，`probe()` 报告 `'unusable'`；系统有意不提供安装时编译回退。
