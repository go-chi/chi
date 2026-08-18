# dsh-brand

[English](README.md) | 中文

`Branded<B>` 名义类型原语：一个微小的**仅类型**包，无运行时代码，也不依赖其他 harness 包；所有负责跨边界 id 的包都会共享它。

## `Branded` 是什么

品牌使 `SessionId` 和 `CallId` 这样结构相同的字符串在类型层面不可互换，尽管两者在运行时都是普通 `string`。

```ts
import type { Branded } from '@deepseek-ai/dsh-brand'

export type SessionId = Branded<'SessionId'>

/** Brand a string as a SessionId (a plain cast — zero runtime cost). */
export function SessionId(id: string): SessionId {
  return id as SessionId
}
```

构造操作通过所属包中各 id 专用的工厂完成。比较、日志记录、JSON 序列化和协议格式（wire format）的行为与普通字符串相同；品牌信息会在编译时被擦除。

## 策略：为跨包边界的 id 添加品牌

包为自己拥有的 id 添加品牌：`CallId` 位于 `dsh-llm`，共享的 agent/会话 `SessionId` 位于 `dsh-session`，`JobId` 位于 `dsh-jobs`。为可能被混淆的跨包 id 添加品牌，但无需为每个字符串都添加。

该包只负责这一原语。保持无依赖意味着，例如 `dsh-jobs` 可以为 `JobId` 使用品牌类型，而无需仅为使用 `Branded` 而导入不相关的功能包。
