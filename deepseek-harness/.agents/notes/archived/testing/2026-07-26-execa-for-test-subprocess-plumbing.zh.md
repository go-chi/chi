# Agent Note: 采用 execa 替换手写的测试子进程管道代码

Status: implemented
Archived: 2026-08-07

[English](2026-07-26-execa-for-test-subprocess-plumbing.md) | 中文

## 问题

大约十个 e2e/冒烟测试文件各自手工重写过同一套「spawn、收集输出、超时终止」编排：用 `setEncoding` 加 `data` 处理器做 `let stdout = ''` 式累积，用 `setTimeout` → `kill('SIGKILL')` 设定超时截止，再以 `once('exit')`/`once('error')` 结算结果，各处只有细微差别。这些位置是：`runLoaderSmoke` 的内层 spawn 代码块（`packages/support/loader-smoke/src/index.ts`）、`apps/cli/tests/built-bin.e2e.ts` 与 `packages/examples/cli-demo/tests/built-bin.e2e.ts` 中的 `runBuiltBin`、`packages/examples/acp-demo/tests/built-bin.e2e.ts` 中的 `runBinExpectingExit`、`lsp-local` 与 `code-runtime-worker` 中基于构建产物的 e2e 辅助函数、`examples/tui-agent/tests/pty-harness.ts` 的外层收集器、`examples/jsonrpc-agent/tests/keyless-smoke.e2e.ts`，以及部分涉及的 `apps/web/tests/smoke-real.e2e.ts` 和 `session-checkpoint-policy/tests/crash-recovery.e2e.ts`。

另有两处相关的测试基础设施手写代码进一步强化了替换的理由：

- `packages/support/llm-mock-server/src/cli.ts` 曾手工逐个切分 17 个带值的 `--flag value` 选项外加若干布尔标志（约 45–60 行的循环与取值辅助函数），而 `node:util` 内置的 `parseArgs` 早已是本仓库的惯用写法（`cli-demo`、`acp-demo`、`verify-runtime-closure.ts`、`packages/sdk/scripts`）。
- `apps/web/tests/smoke-real.e2e.ts` 与 `apps/web/tests/scaffold.ts` 曾携带两份逐字相同的正则 `.env` 解析器拷贝（约 20 行），而内置的 `process.loadEnvFile` 恰好具备所需的「不覆盖已有值」语义；并且 vitest 的 e2e/snapshot/web 配置在这些文件运行之前就已用它加载了根 `.env`，这两份拷贝实为死代码。
- 快照 harness 曾手写三个「轮询直到截止时间」的循环（`packages/support/acp-snapshot/src/harness.ts` 中的 `waitForPersistedTurnStart`/`waitForPersistedTurnEnd`/`waitForWorkspaceFile`，约 55 行），外加 `crash-recovery.e2e.ts` 中的 `waitForFile`，而 `vi.waitFor`/`expect.poll` 正好覆盖这种形态；vitest 本来就是 `dsh-acp-snapshot` 的运行时依赖，因此这不新增任何东西。

## 决定

- `execa` 是根 devDependency，同时是 `@deepseek-ai/dsh-loader-smoke`（唯一的 `src/` 消费方）的运行时依赖。上述 spawn、收集、超时的代码位置统一经由 `await execa(cmd, args, { cwd, env, timeout, killSignal: 'SIGKILL', reject: false })` 运行：其结果以相互独立的字段报告 `{ stdout, stderr, exitCode, signal, timedOut, failed }`，与本仓库防御模式中「正交的子进程结果各自独立上报」的规则一致。`runLoaderSmoke` 传 `input: ''` 以兑现其 stdin 关闭契约；断言固定精确流字节的位置传 `stripFinalNewline: false`。
- 真正定制的部分继续保持定制，只是架在 execa 拥有的子进程之上：cli-demo 在流中遇到标记即中断的逻辑、jsonrpc 基于行谓词的协议驱动，以及 crash-recovery 在故障点发送 SIGKILL 的编排。`smoke-real.e2e.ts` 的三个长驻交互式服务器保留原生 `spawn`——跨双流监听就绪行加上分级的 SIGTERM→等待→SIGKILL 拆除就是该处的全部内容，execa 在那里删不掉任何东西；本 Agent Note 涉及该文件的部分，仅是那份已成为死代码的 `.env` 解析器。
- `llm-mock-server` 的 CLI（命令行界面）经由 `parseArgs` 切分（strict、不允许位置参数）；数值转换、边界检查与跨选项约束仍手工实现，固定错误消息的测试改为采用 `parseArgs` 自己的切分器文本。
- 两份 `loadRootEnv` 拷贝被整体删除：拥有它们的 vitest 配置（`vitest.web.config.ts` 无条件、`vitest.snapshot.config.ts` 在 record 模式下）在这些文件运行之前就加载了仓库根部的 `.env`。
- 那四个轮询循环改用 `vi.waitFor`，显式传入 `{ interval, timeout }`，并在回调中抛出带描述信息的错误；`waitForPersistedTurnStart` 把「持久化记录格式非法」的校验错误捕获到重试循环之外，使其立即让运行失败，而不是被重试到截止时间。

## 曾考虑的替代方案

- **用 `tinyexec` 代替 execa。**它已经作为 vitest 的传递依赖存在于 `node_modules` 中，API 也更小；但它没有终止信号逐级升级，不会把丰富的输出嵌入错误对象，而且传递依赖并不构成契约。如果最终更倾向这个更轻的包，替换的形态完全相同。
- **仓库内共享的 spawn 辅助函数（不引入新依赖）。**可行，供应链成本也更低，但当一个久经实战的包恰好负责这件事时，它把截止时限、终止与结算逻辑的维护留在了仓库内；这与[依赖策略](../process/2026-07-26-dependencies-over-hand-rolling.md)背道而驰，它还得重新踩坑换来 execa 已经自带的跨平台超时、终止与结果规范化行为。
- **`get-port`、`wait-on`、`tempy`、`tree-kill`。**逐一不予采纳：仓库仅有的一处端口探测替换后收支相抵；文件等待场景已由 `vi.waitFor` 更优地覆盖；临时目录处理在各处已经使用内置的 `mkdtemp` + `rm {recursive}`；acp-snapshot 的 `close()` 是排空顺序逻辑，不是进程树遍历。

## 后果

- 手写的收集/超时代码块全部移除，包括 `loader-smoke` 中两个标注 `/* v8 ignore */`、无法人为诱发的 OS 错误分支：spawn 与流故障如今经由 execa 的结果字段结算，这个 `src/` 文件不再携带任何覆盖率豁免，逐文件门禁覆盖其余全部分支。
- 捕获的输出如今受 execa 默认 100 MB `maxBuffer` 约束（溢出即终止子进程），此前是无界的；`loader-smoke` README 的局限条目反映了这一点。
- 直接子进程的超时终止以及退出/信号结果规范化均由 execa 跨平台负责，不再逐处手写；如 `loader-smoke` README 所述，这些辅助函数依然不负责终止进程树。每个改写后的套件在本次变更中已在 POSIX 上重新运行，另一平台由 Windows CI 通道负责。
- execa 是新增的根 devDependency（此前完全不存在于 lockfile 中）；它是 npm 上被依赖最多的包之一且维护活跃，exe/运行时闭包不受影响（仅测试使用）。
- mock-server CLI 切分器层面的错误文本不再由本仓库决定：未知选项、缺失取值与多余位置参数报告 `parseArgs` 的措辞，并在 `tests/cli.spec.ts` 中如此固定。
