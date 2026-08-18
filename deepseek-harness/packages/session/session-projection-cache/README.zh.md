# @deepseek-ai/dsh-session-projection-cache

[English](README.md) | 中文

持久投影缓存（`ctx.sessionProjectionCache`）：把每个已注册投影单元的状态持久化为检查点，基于域数据形态（domain data form）每会话一条记录（`session_projcache` 域——出厂 JSON 后端将其落在配置的存储根目录下、`workspace.json` 旁边）。设计权威：[session-projection RFC](../../../.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md)（persisted projection cache 一节）。

一条存储行 `(key → {ver, seq, val})` 是折叠捷径，绝不是权威：可能陈旧（`seq` 精确说明陈旧到哪），但绝不会错。实现据此承诺：

- **每次后台写入都 fail-soft。** 持久写失败只记一条警告并保持缓存陈旧；下一次写入或冷读自愈。两次写之间崩溃的代价是更长的尾部回放，绝不是错误的值。
- **`ver` 与当前运行单元的 `stateVersion` 不匹配即丢弃，绝不迁移。** 单元递增版本会在读取时使其行失效；该 key 从日志重新折叠。
- **整记录写入。** 每次写入替换该会话的完整检查点（注册表切面始终是完整的），并经无损 JSON 边界快照——违反纯 JSON 约定的单元状态会显式失败并报错。
- **记录绑定到日志生命周期，而不只是 id。** 每条记录存储其折叠来源的 header 身份（`createdAt`、`cwd`）；每次读取先以活 header 或存储 header 为证验证它，再接受任何行——被删后重建的 id、或缓存幸存而持久化存储被换掉时，无关记录被整体丢弃，绝不播种幻影值。
- **日志领先，缓存跟随。** 活会话检查点先把缓冲事件持久 flush，缓存行才落地，因此崩溃只会让缓存落后于日志（更长的尾部回放），绝不领先于它。

## 写策略

两个必写点，其间节流：

| 触发 | 性质 |
|---|---|
| `turn/end` | 必写——冷读要的正是轮次终值。 |
| 会话释放（detach） | 必写——live 转 cold 的时刻；此后冷读阶梯接管该会话。 |
| 累计 `writeEveryEvents` 个已提交事件 | 配置节流（条数）。 |
| 距首个脏事件 `writeIntervalMs` 毫秒 | 配置节流（间隔）。 |

两个 `Config` 字段均必填（无默认值）：写入节奏是部署选择，没有普适正确值，由 cordis.yml 明示。

## 列表读（`cachedSnapshot(meta)`）

零 I/O 一档：从身份匹配的存储记录直接 view 全量值（仅版本匹配的 key），以 `{asOfSeq, values}` 切面返回——`asOfSeq` 取所服务行的最低水位，客户端在 higher-seq-wins 规则下播种值存储时，陈旧列表块永远压不过更新的推送帧。无可用记录（未知 id、无关生命周期、无版本匹配行）时返回 `undefined`；api-proxy 列表载体将其转为列缺席。

## 冷读（`coldSnapshot(id, signal?)`）

读取阶梯，正常路径无需加载全量日志：缓存行 → `sessionProjections.restoreFloor`（锚定在最低可用水位之前一个事件的位置）→ 持久化 `readFrom(id, floor)` → `sessionProjections.restore` → 刷新行的 fail-soft 写回。这个锚使缩短的日志（崩溃修复截断）可被证明：越界的行恰好触发一次从 seq 0 的全量重读，而不是把幽灵值当现值服务。无已注册单元时直接服务 `{asOfSeq: -1, values: {}}`，不触碰持久化；无持久日志的会话以 seam 的 `not found` 拒绝。

`write(session)` 是两个必写点共用的同步切面检查点；载体可以直接调用（非 fail-soft——由 fail-soft 包装层负责遏制）。

## 组合

```yaml
- id: session-projection-cache
  name: '@deepseek-ai/dsh-session-projection-cache'
  config:
    writeEveryEvents: 200
    writeIntervalMs: 5000
```

注入 `storageDomain`、`sessionProjections`、`sessionPersistence`、`sessions`。没有这一行时，投影系统只跑 live（水位缓存；冷读在实现了它的载体处退回全量日志加载）。

## 模型体验

无，因为缓存只持久化并恢复 host 侧的、由已写入日志的会话状态派生的读模型，不触碰任何提示词、消息、schema、流或工具结果。

#### KV Cache 影响

无；缓存从不组装或发送提供方请求。

## 已知局限与延后工作

- **不提供淘汰或保留接口**：记录会按会话持续累积；清理已存储的检查点属于带外维护，与会话持久化采用相同策略。
- **间隔节流采用按会话的粗粒度控制**：一次无脏数据的写入完成后，计时器会在首个脏事件到达时启动；对于持续但未达到条数阈值的事件流，系统每个间隔写入一次，而不采用滑动窗口。
- **`coldSnapshot` 读取不去重**——同一会话的两个并发冷读各跑一遍阶梯；写回最后者胜（行等价），对列表级调用频率可接受。
