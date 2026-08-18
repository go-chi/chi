# Agent Note: 移除首次启动内测声明

Status: implemented

[English](2026-08-13-remove-first-run-beta-notice.md) | 中文

## 问题

GUI 每次首启都会先显示占满视口的内测声明：内部测试的定位表述，加上通过 `DSH_TELEMETRY_MODE` 开启 Session Log 上传的说明。会话遥测在 mode 未设置时已解析为 `DISABLED`（[遥测默认关闭](../feature/2026-08-10-telemetry-default-off.md)），因此引导流程中关于遥测的全部内容就是一段教用户如何开启的提示，而内部测试的定位表述本身也不应出现在发布版本里。

## 决策

本决策当时把首启声明从组装后的产品中整体移除，而不是改写。`ui-settings-general` 不再注册任何 `settings.onboarding` 步骤；声明组件、确认 store、文案所有者文件和 locale 键均被删除，Host 则保留 `ui-onboarding` namespace，使既有设置文档继续有效。后续的[共用弹窗产品引导](../feature/2026-08-13-shared-modal-product-onboarding.md)在 `ui-settings-models` 中恢复了一份新的简洁测试阶段声明，复用该字段与后端契约，但不会恢复已移除的接管式布局或遥测说明。遥测的开启仍是显式的部署环境变量选择，记录在 [CLI reference README](../../../../apps/cli/reference/README.md) 中；恢复后的声明不涉及如何开启遥测。

## 曾考虑的替代方案

**保留声明，只删除其中的遥测段落。** 不予采用：发布版本不应呈现的正是内部测试的定位表述本身，而一个没有实质内容的强制首启插页只剩下打扰。

**改为询问上传同意（版本化的同意步骤）。** 本次发布不予采用：首启询问是否开启上传仍然是一个遥测提示。未来的同意流程可以通过保持不变的 `settings.onboarding` seam 注册，并使用新的版本化字段做重新确认。

**连 `ui-onboarding` namespace 一起注销。** 不予采用：既有设置文档已经包含该分节，而设置 seam 会用已注册的 namespace 校验存储文档；保留注册就能让这些文档继续有效，且没有额外成本。

## 后果

这次移除消除了占满视口的声明及其遥测文案。后续恢复有意采用不同的展示与文案版本：共用弹窗先于行内凭据弹窗出现，远程场景重新覆盖进程内确认，既有 `welcomeNoticeVersion` 字段记录新的文案版本。历史上的遥测提示仍未恢复。
