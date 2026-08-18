# `@deepseek-ai/dsh-llm-retry`

[English](README.md) | 中文

一个函数插件，通过 agent loop（智能体循环）在已关闭步骤上触发的 `agent/request-error` waterfall（瀑布式事件）应用确切提供方重试策略。它不包装 `ctx.llm.stream()`：每次适配器调用仍是一次提供方尝试，每次重试都会开启新的编号轮次。

每个提供方适配器都拥有可选的嵌套 `retryPolicy`；路由在 `ctx.llm` 上注册时会捕获该策略，任何到达该注册最终适配器边界的调用都会携带它。如果之后释放或替换路由，进行中的失败仍会保留当时为其提供服务的策略；在选中任何最终适配器前发生的失败没有提供方策略，会继续委托。省略策略时使用 normal mode：为 `EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT` 和 `TRANSPORT` 重试两次，并采用从 500 ms 到 10 秒的有界指数退避与 10% jitter。`EMPTY_RESPONSE` 是适配器对未产生任何持久内容的退化提供方完成所作的分类，因此可安全重复。normal 策略可以更改其有限预算、符合条件的 code 和退避配置。always mode 会先请求下游恢复，再无次数上限地重试每个模型请求失败；成功、取消或插件 dispose（资源释放）会在活跃的委托恢复完全停稳后终止它。

两种 mode 都使用带对称 jitter 的有界指数退避。有效 `providerRetryAfterMs` 不超过 `maxDelayMs` 时会替换本地退避，并且不加 jitter。超出上限的提供方延迟会使 normal mode 继续委托；always mode 则改用已配置的本地退避，避免该指令终止重试。

等待前，插件会追加一条不进入表层的 `llm/retry` 事件，其中包含共享 `retryId`、提供方、mode、已解析策略的规范 key、失败和计划延迟。该载荷由可安全用于浏览器的 `@deepseek-ai/dsh-llm-retry/types` 子路径导出，因此远程渲染器无需加载策略运行时即可使用该持久状态。该 key 包含所有影响行为的字段，并对 normal mode 的 code 排序，因为合格性采用集合成员关系判断。只有提供方与完整策略 key 都相同的事件才会延续重试编号；因此，用限制、code 成员关系或退避不同的路由替换后，会开始自己的历史。normal 事件包含有限上限；always 事件省略该上限，UI 会渲染 `∞`。等待完成时，插件会在返回 `{ kind: 'retry' }` 前立即追加 `llm/retry-started`，其中带有相同的 `retryId`、轮次、步骤与重试编号；退避期间取消则不会写入 started 事件。随后循环关闭失败轮次，并在同一持久历史上开启重试轮次。取消与插件 dispose 会中止活跃退避，在应用中止前等待活跃的委托恢复结算，并使 dispose 前捕获的 callback 只能以失败结束。

单独发布的 `./invariant` 配套模块会检查每个已调度重试是否指向当前开启轮次及其最新已关闭步骤，是否与失败请求的持久提供方匹配，是否携带非空的提供方与策略标识，是否满足 mode 特定边界，是否拥有唯一步骤记录和正确的提供方策略重试编号，以及是否携带有界定时器延迟。它还要求每个 `llm/retry-started` 事件通过相同的 `retryId`、轮次、步骤与重试编号指向一个先前调度的尝试，并拒绝重复的 started 事件。full jitter 可以在下界调度为零毫秒。

```yaml
- name: '@deepseek-ai/dsh-llm-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
    retryPolicy:
      mode: always
      backoff:
        initialDelayMs: 1000
        maxDelayMs: 30000
        jitterRatio: 0.2

- name: '@deepseek-ai/dsh-llm-retry'
```

执行器没有策略配置。`dsh-llm-pi-ai` 等多提供方适配器会把 `retryPolicy` 放在每个提供方 profile 内，避免维护第二份提供方名称列表。

## 模型体验

### 模型请求恢复

#### 模型看到的内容

模型不会看到重试事件、延迟、提供方错误或失败的部分输出。重试轮次会从持久表层历史中重建相同的显式提供方／模型请求，除非下游恢复策略有意更改该表层；失败分片绝不会进入派生消息。

#### Token 影响

每次重试都是新的提供方请求，可能重复计费输入 token。normal mode 具有有限预算；always mode 可以在成功或取消前消耗无界数量的请求。`llm/retry` 自身不产生 token。

#### KV Cache 影响

重建请求保留之前的前缀，并可根据该提供方的规则复用 cache。非表层重试事件不会改变 cache 身份。

## 已知限制与暂缓事项

- **agent 轮次是唯一重试边界**：直接 `ctx.llm.stream()` 消费方仍只尝试一次，因为原始流无法持久地区分各次尝试已经发出的分片。
- **always mode 会重试永久性失败**：身份验证、配额、无效请求、协议和无法恢复的上下文错误都会继续重试，直至成功、取消或 dispose；部署负责提供方特定的成本与延迟控制。
- **有限插件预算可叠加**：normal mode 只统计已配置 code 和确切提供方策略，上下文溢出压缩（compaction）则拥有独立预算。任何重叠策略都必须定义注册顺序行为。
- **恢复策略按 waterfall 顺序组合**：always mode 会先接受下游重试，再应用自己的回退。后续策略如果忽略取消且永不结算，也会阻止回退、轮次完全停稳和插件 dispose 完成。
- **`llm/retry` 记录调度，不是完成**：后续步骤与轮次事件用于确立成功、耗尽或取消。
