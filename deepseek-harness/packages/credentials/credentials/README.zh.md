# dsh-credentials

[English](README.md) | 中文

凭据 Service Definition（`ctx.credentials`）。一条准则，三个推论：

**配置只携带对机密的引用，绝不携带机密本身。** settings 分节或 `cordis.yml` 条目写 `apiKeyEnv: DEEPSEEK_API_KEY`，引用背后的值存放在凭据提供方处。于是设置文档可以放心同步、放心渲染进配置界面；`describe()` 无需持有值就能回答「配置了吗、来自哪层、能否写入」；轮换机密不触碰任何配置文件。

**消费方按操作解析。** `resolve(ref)` 在每个操作开始时调用（LLM（大语言模型）适配器每次模型请求解析一次），绝不跨操作缓存——正是这次读取让改过的凭据无需重启任何插件就作用于下一次请求。

**空的存储值等于不存在。** 处处如此：`resolve` 跳过它，`describe` 报告未配置。空白永远不会伪装成已配置的机密。

## 接口

```ts
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

declare const ctx: Context

const ref = credentialRef('DEEPSEEK_API_KEY')            // POSIX shell identifier, branded
const hit = await ctx.credentials.resolve(ref)           // { value, source } | undefined
const info = await ctx.credentials.describe(ref)         // { configured, source?, writable } — never the value
await ctx.credentials.set(ref, 'sk-…')                   // rejects while a read-only source shadows the ref
await ctx.credentials.unset(ref)                         // no-op when absent; same shadowing rule
```

`credentials/updated (ref)` 在提供方管理的来源发生已提交变更后触发——`set`、`unset` 或在存储中观察到的外部编辑。进程环境变量的变化不可观测，永不触发。消费方不需要该事件（它们按操作重新解析）；它服务于配置界面刷新「已配置」徽标。它的声明住在 client-safe 的 `./types` 子路径出口，与其点名的 `CredentialRef` 类型同处一处（包根继续 re-export 该类型），于是 Host 编译面之外的消费方读到的正是 Host 发射的那一份签名，而不必再写一遍。

`set`/`unset` 的遮蔽规则有意采用明确报错的方式：当只读来源（本地提供方中即当前进程环境）正在提供该引用时，写入会表面成功而解析仍返回遮蔽值——seam 选择直接拒绝，并通过 `describe().writable` 让界面提前把该引用渲染为只读。

## 提供方

[`dsh-credentials-local`](../credentials-local/README.md) 把继承的进程环境叠加在其受管 `$DSH_HOME/.credentials.yaml` 文档之上，并以启动器的项目和用户 `.env` 层作为后备。该 seam 的接口为 keyring、辅助命令和 KMS 后端提供方预留了扩展空间；远端设置提供方永远不必携带机密。

## 模型体验

经由消费它的 LLM 适配器间接生效：解析出的值为适配器的提供方请求授权，所有模型可见接口都由适配器负责。

#### KV Cache 影响

无直接失效；凭据绝不进入请求前缀。

## 已知限制与暂缓事项

- **不提供枚举**——seam 只回答被问到的引用；配置界面从 settings schema 得知引用集合，`list()` 没有当前消费方。
- **引用限定为环境变量形状**——在有提供方需要更丰富的寻址方式前，保持单一扁平的 POSIX 标识符命名空间。
- **进程环境变化不可见**——不可能为其发事件；界面只能在自身导航时重新读取 `describe()`。
