# @deepseek-ai/dsh-session-projection

[English](README.md) | 中文

会话投影 Service Definition 与驱动注册表。它拥有 `ctx.sessionProjections`：该注册表在已提交的会话事件上驱动每个已注册的投影单元，并向载体提供完整的最终值，目前包括 api-proxy 历史尾页和 `session/projection` 推送帧。领域注册的只是纯数学；驱动权归框架。[session-projection RFC](../../../.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md) 记录了设计理由。

## 服务：`SessionProjectionRegistry`（ctx 键：`sessionProjections`）

### 公开 API

- `ctx.sessionProjections.register(definition): () => void` 注册一个领域的单元。key 重复或 `stateVersion` 非法都会 throw；注册是挂在调用方 fiber 上的 effect，领域插件卸载后其 key（连同缓存的 cell）从后续驱动与快照中消失——客户端将其读作能力缺失。
- `ctx.sessionProjections.onChanged(listener): () => void` 订阅变更流：每个已提交事件、每个状态引用发生变化的单元各回调一次，携带经 schema 校验的 view 与致因 seq。与 `register` 一样绑定 effect。
- `ctx.sessionProjections.snapshot(session): ProjectionSnapshot` 对全部已注册单元做一次一致的同步切面——`{ asOfSeq, values }`，其中 `asOfSeq` = 所有值共同反映到的最后一个事件的 seq（空日志为 `-1`）。

### 关键类型

- `SessionProjectionMap`——整条链路唯一的 merge-extensible 类型表（host 侧单元、协议块、React 钩子）。值是协议层 JSON 全量值；渲染归 slot 体系管，永远不归本层。
- `ProjectionDefinition<K, S>`——`{ key, schema, init(), apply(state, event), view(state), stateVersion }`：由三个纯同步函数外加若干声明构成的状态驱动计算单元（state-driven computation unit），绝不是一个不透明的 getter。

## 约定

- **框架负责驱动，领域负责计算。** 注册表只订阅一次 `session/event`；每个已提交事件都会主动经过每个单元的 `apply`。领域不持有任何订阅。cell（每会话每单元一份 `{state, observedSeq}`，以 WeakMap 为键）惰性构建——在事件流过之后才注册的单元，或读取一个早于该注册的会话，都在首次触达时从 `init` 出发在内存日志上折叠。
- **同引用即无工作。** 对与单元无关的事件，`apply` 必须返回同一个状态引用；驱动以 `Object.is` 把守变更流，因此不匹配的事件只花一次调用，不产生任何下游工作。
- **全量值事件规则（承重）。** 携带状态的日志事件必须携带变更后的完整状态，绝不携带裸增量——这让每次状态转移始终足够廉价，也让每个被供给的值自描述（对消费方即 last-wins）。
- **单元的同步纪律。**`init`/`apply`/`view` 必须是同步的；载体在切出页面切片的同一 tick 内读取 `snapshot()`，`asOfSeq` 之所以是一个一致切面正系于此。误写成异步的 `view` 会返回 Promise，让边界的 `schema.parse` 当场大声失败。
- **状态是纯 JSON，`stateVersion` 是其失效锚点。** 持久投影缓存（persisted projection cache）存储 `(sessionId, key, ver, seq, val)` 行；状态形状或折叠语义一旦变化就递增 `stateVersion`，使陈旧行被丢弃，而不是被正向 apply 成垃圾。
- **本层没有协议词汇。** 注册表只暴露变更流与快照读取面；载体（api-proxy）据此自铸各自的帧（`session/projection`）与块。
- **可选能力。** 领域插件在 `ctx.inject(['sessionProjections'], …)` 下注册，因此不带注册表的 headless 组装完全不受影响；载体使用 `ctx.get('sessionProjections')`，注册表缺席时完全省略自己的块与帧。

## 职责

本包承担能力 seam 的 Service Definition 与驱动角色：领域 host 插件（如 `dsh-tool-todo`）贡献单元，载体（`dsh-host-apiproxy`）消费快照与变更流，两侧互不相识。

## 模型体验

无——注册表只对已入日志的会话状态计算面向客户端的读模型，不触碰任何提示词、消息、schema、流或工具结果。

#### KV Cache 影响

无；投影从不组装或发送提供方请求。

## 已知限制与暂缓事项

- **每个尾页携带每个已注册的 key**——尚无逐 key 的 opt-out 或惰性 key 请求形状；在值都是 UI 量级的全量状态（一张 todo 清单、一份 goal 快照）时可以接受，若某领域的值变大再重议。
- **单元表是进程级的，因此 key 是否存在不能当作逐会话的能力信号**——只要**任何**一个 agent preset 注册了某个 key，它就出现在每个会话的快照里，包括自身组装完全不产出该值的会话。客户端必须读**值**（`plan.active`、空的 todo 列表），不能把 key 缺席当作功能缺席；如果某个单元的空值与真实值无法区分，它就该待在宿主平面——`dsh-token-meter` 正因如此留在那里。
- **主动驱动（eager drive）逐事件触达每个单元**——按构造开销很低（全量值规则、同引用闸门），但若出现热点路径，可加按单元的事件类型预过滤，约定不变。
- **注册表 cell 只活在内存里**——重启后首次触达时靠折叠日志重建；挂载了 `dsh-session-projection-cache` 的组合改由持久行播种该折叠。
- **单元同步纪律只有部分可机械把关**——边界 `schema.parse` 能拒绝返回 Promise 的 `view`，但阻塞的 `apply`、或读取撕裂的非会话状态的 `apply`，只能靠评审把关；invariant 配套项记载了为何不存在运行时检查。
