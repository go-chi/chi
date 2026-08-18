# Agent Note: 每个会话只使用一个表层管理器

Status: implemented
Archived: 2026-07-26

[English](2026-07-19-use-one-session-surface-manager.md) | 中文

## 问题

`Session` 曾针对同一份仅追加事件日志维护两个 `SurfaceManager` 实例。一个实例负责校验种子事件和追加候选事件，另一个延迟创建的实例则独立折叠已提交事件，供 `session.surface`、派生消息、压缩（compaction）和工作区上下文使用。一旦读取公共表层，之后的每个事件都会推进两份重复的节点状态与替换代数状态，却没有形成独立真源或失败边界。

## 决策

每个 `Session` 主动创建并只持有一个 `SurfaceManager`。种子事件与追加事件的接纳流程在提交事件之前调用该管理器的 `validateNext()`，`session.surface` 则通过以下只读契约返回同一个对象：

```ts
export interface SessionSurface {
  readonly nodes: readonly number[]
  readonly replaceGeneration: number
}
```

候选事件校验仍保持原子性。`validateNext()` 可以同步已提交的日志事件，但对尚未提交的候选事件只制定变更计划。候选事件在 `log.push()` 之后、下一次增量同步时才进入管理器状态，因此表层校验失败或提交前 `internal/dispatch` 否决都不会留下虚假节点或替换代数。

`foldSurface()` 仍是离线校验与重建使用的分离式完整日志回放函数。它使用相同的状态转换，并且对每个已提交前缀都与活跃管理器一致，但不共享可变状态。

## 备选方案

**继续分离接纳状态与投影视图。** 两个独立实例看似能够隔离公共读取和校验，但调用方取得的本来就是借用的表层状态，声明的只读契约会阻止普通修改。复制管理器并不能构成运行时信任边界。

**每次读取都根据完整日志重新计算公共表层。** 该方案能消除重复缓存状态，但会放弃增量派生，使每次请求构造都随完整会话历史增长。

## 影响

- 接纳流程、`session.surface`、派生消息、压缩和工作区上下文观察同一份增量状态。
- `Session.surface` 不暴露校验方法，同时保持对象标识和借用的只读节点数组稳定。
- 恶意类型断言仍可破坏借用状态；刻意绕过只读契约的 JavaScript 调用方不属于受支持的同进程边界。
- 表层、种子、调度否决、请求重建、压缩和工作区上下文测试覆盖共享管理器与分离回放路径。
