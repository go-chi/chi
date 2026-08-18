# Agent Note: 内置 dsh 徽章 skill

Status: implemented

[English](2026-08-06-bundled-dsh-badge-skill.md) | 中文

## 问题

[Cordis 教程](../../../../docs/cordis-tutorial/index.md)的各个页面都使用官方「powered by dsh」徽章，但交付的 CLI（命令行界面）既没有用于在其他位置应用同样署名的可复用指令，也没有可显式选择加入的提供方。

## 决策

`@deepseek-ai/dsh-skill-badge` 是一个原生 Cordis 插件，会在 `ctx.skills` 上注册一个不可变的内置提供方。该提供方负责 `dsh-badge` 的摘要、指令正文和 PNG 资源基底；`dsh-tool-skill` 仍是面向模型的目录与 loader 渲染的唯一归属方。

交付的 CLI 组合将 `skill-badge` 声明为禁用。启用这个现有配置行就是显式选择加入；禁用它的安装实例不会公开任何徽章 skill（技能），也不会获得任何模型可见内容。

该提供方使用排在项目、自定义及用户文件系统来源之后的内置 rank，因此用户自有的 `dsh-badge` 定义可通过注册表的常规优先级约定覆盖它。提供方释放时，注册表拥有的 effect 会移除该贡献。

## 曾考虑的替代方案

**通过 `dsh-skill-filesystem` 挂载随包文件。** 否决，因为文件系统发现、解析和监视会引入生命周期机制，而不可变的单一 skill 提供方并不需要这些机制。

## 后果

徽章指令和源 PNG 随 DSH 一同纳入版本管理，并通过以随包目录为基础的资源基底解析。该提供方没有配置面。包测试固定提供方生命周期和官方 PNG 的字节内容；无密钥的组装应用快照则固定启用后的目录和已加载的 skill 正文。
