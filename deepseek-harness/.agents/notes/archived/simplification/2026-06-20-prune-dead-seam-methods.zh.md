# Agent Note: 从持久化 seam 中移除无用方法

Status: implemented
Archived: 2026-07-26

[English](2026-06-20-prune-dead-seam-methods.md) | 中文

> **实现说明：** 仅移除了 `SessionPersistence.has()` 和 `.delete()`。`BashExecutor.get()` 和 `.list()` 仍然保留，因为删除它们的单行查找表面会要求消费方增加显著更多的完成跟踪机制。其 id 品牌化由[品牌化 id Agent Note（agent 决策记录）](../architecture/2026-06-20-branded-ids.md)负责。

## 问题

能力 seam（[接口 / 实现 / 消费方](../architecture/2026-06-13-capability-seams.md)）承载了没有消费方调用的抽象方法。seam 的存在是为了让实现和消费方独立演进——但没有消费方以之编程的方法不是 seam，而是每个实现仍必须实现和测试的推测性表面。

### `SessionPersistence.has()` 与 `.delete()`

该抽象服务在 create/append 之外声明了更多操作：`load`、`list`、`has`、`delete`。生产消费方用 `load()` 和 `list()` 完成恢复与会话发现，而没有任何生产调用方使用持久化的 `has()` 或 `delete()`。协议和 UI 代码中名称相似的内存集合调用与此无关。持久化 `has`/`delete` 的唯一调用者是契约测试套件和各后端的 spec。

`has()` 不仅未被使用：在 `loadStored(id)` 已负责持久化存在性检查的情况下，它仍增加了协调器的已跟踪/未跟踪探测和一个契约分支。`delete()` 则拖入每个后端都必须实现的 `deleteStored` 后端钩子。这属于[删除可变会话 summary](2026-06-19-drop-mutable-session-summary.md) 的同类模式：契约测试覆盖了两者，但已发布代码从不会询问“这个会话是否已持久化？”或删除某个会话。

## 决策

没有消费方使用的方法被移除——从抽象 seam、实现，以及仅为覆盖它们而存在的契约/spec 测试套件中移除：

- `SessionPersistence.has()` / `.delete()` 已移除：抽象声明、协调器的 `has`/`delete`/`deleteCore`，以及 `PersistenceBackend.deleteStored` 钩子均消失（jsonl 和 sqlite 都只是为了满足该钩子才实现 `deleteStored`，这些实现也一并移除）。后端属于[双后端](../architecture/2026-06-14-session-persistence.md)设计，其他方面不在范围内；删除它们为没有消费方的钩子所做的实现，是删除钩子的一部分，而非重新设计后端。
- 所有文档和源码注释引用都已更新为保留下来的四方法、仅含 `list()` 的契约——不仅包括字面上的 `has(`/`delete(`/`deleteStored` 拼写，还包括 `{@link has}`/`{@link delete}` JSDoc 链接和“六个公共方法”的计数——涉及 seam 和后端 README、[docs/architecture.md](../../../../docs/architecture.md)、[会话持久化](../architecture/2026-06-14-session-persistence.md)与[写入协调器](../architecture/2026-06-18-shared-persistence-write-coordinator.md) Agent Note，以及协调器/后端 JSDoc。

## 曾考虑的替代方案

### 为什么不以「seam 应当完整」为由保留？

「持久化 seam 理应提供 delete」这种直觉是真实的——但它恰恰是预发布阶段所警惕的投机性完整（[AGENTS.md](../../../../AGENTS.md)：为正确的基础优化，而非为你并不拥有的假想调用者优化）。`delete()` 是一个方法，等消费方真正需要时再加回来即可：一个删除旧会话的会话管理 UI 会需要它——到那时再加，基于该 UI 的真实需求来设计（软删除？级联？确认？），而非现在猜测。

在有活跃消费方的情况下重新添加一个 seam 方法，成本低且设计更优，因为消费方锚定了契约。在无人使用的情况下保留它，意味着每个实现（以及未来的每个后端）都必须实现和测试一个无实际作用的方法。

## 验证

`has`/`delete`/`deleteStored` 已从持久化 seam、实现和契约测试套件中移除，没有新增无用导出；剩余操作（`create`/`append`/`load`/`list`）未受影响，基于持久化的会话查询和崩溃恢复行为完全一致；seam README 和 `docs/architecture.md` 仅列出存留的方法。

## 后果

- **`delete()` 是产品最终会需要的操作。** 确实如此，但「最终」正是关键。现在删除、将来基于真实消费方重新添加，严格优于发布一份猜测的契约。两个后端各自减少了一个 `deleteStored` 实现，这是在本次范围之外的包中的有限改动。
- **低耦合。** 移除局限于持久化 seam + 实现 + 测试；没有跨包消费方引用被移除的方法，因此除文档外没有涟漪效应。

规模不大，但它将 seam 从「实现必须为无人提供什么」恢复为「恰好是消费方使用的东西」。
