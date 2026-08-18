# Agent Note: Windows 写入权限语义：继承 DACL，而非权限模式位

Status: implemented
Archived: 2026-07-26

[English](2026-07-05-windows-fs-permissions.md) | 中文

本记录中关于替换文件的决策已由 [Windows DACL 保留机制](../bug-fix/2026-07-19-windows-atomic-write-dacl-preservation.md)取代。

## 问题

`writeFileAtomic` 在 `@deepseek-ai/dsh-fs-local` 中使用 POSIX 权限模式位保护正在写入的内容：以 `0o700` 创建暂存目录，以 `0o600` 打开临时文件，新文件也默认使用 `0o600`。在 POSIX 上，无论父目录的权限如何，这些设置都能保证临时内容仅对所有者可见。

Windows 在同一 API 背后没有可用的对等机制。Node 的 `chmod` 在 Windows 上只会驱动只读属性（此包传入的每种模式都包含所有者写权限，因此这些调用是无害的空操作），`stat().mode` 则报告合成的 `0o666`/`0o444` 权限位。真正的安全状态由文件的 DACL 决定：新建文件或目录会从父目录继承，替换操作则需要由取代本文的 Agent Note 所定义的显式处理。

## 决策

Windows 新建文件使用目录继承，而不使用合成的权限模式位：暂存目录在目标的父目录（`dirname(absolutePath)`）内创建，因此它和临时文件都会继承目标目录的 DACL。替换文件遵循更严格的 [DACL 保留契约](../bug-fix/2026-07-19-windows-atomic-write-dacl-preservation.md)。

测试仅在 POSIX 上断言权限模式位。Windows 原生覆盖率锁定由本包（package）负责的替换行为；新文件继承仍属于操作系统契约，而不是针对特定机器的 ACL 允许清单。

## 备选方案

**为新文件显式设置仅所有者可用的 DACL。** 不予采纳，因为这会破坏继承，也会使特意共享项目目录的用户感到意外。替换写入会复制目标现有的 DACL，而不会自行设计仅所有者可用的策略。

**在测试中验证 ACL。** `Get-Acl` SID 允许清单或 `icacls` 验证的是 Windows 继承机制以及当前机器的 `%TEMP%` ACL，而非包的行为；`icacls` 还会对知名账户名进行本地化，导致解析容易受语言区域影响。

**在 Windows 上跳过 `chmod`。** 为无害的空操作调用增加平台守卫分支，不会改变任何行为。

## 后果

无论父目录的权限如何，POSIX 都会继续将临时内容限制为仅所有者可用。Windows 中的新目标如果位于广泛可访问的目录内，将按设计继承这种可访问性；如果替换目标存在更严格的 DACL，则会保留该 DACL。

在 Windows 上，替换时的模式保留会退化为空操作：可写文件的探测结果为 `0o666`，通过 `chmod` 重放该模式会使只读属性继续保持清除状态。由于发布操作会在合成模式发挥作用前失败，Windows 上无法替换只读目标。
