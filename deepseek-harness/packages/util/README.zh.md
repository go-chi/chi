# util/：底层共享工具

[English](README.md) | 中文

这些零依赖包提供由多个能力家族共享的小型原语。业务语义仍归各个消费这些原语的能力所有。

| 包 | 职责 |
|---|---|
| [`brand/`](brand/README.md) | 提供带名义品牌的类型 |
| [`paths/`](home-paths/README.md) | 解析 Harness 数据根目录和共享路径 |
| [`timeout/`](timeout/README.md) | 提供截止时间和超时分类原语 |
| [`retention/`](output-retention/README.md) | 限制保留文本和项集合的大小 |
| [`atomic-write/`](atomic-write/README.md) | 以原子方式替换文件 |
| [`native-command/`](native-command/README.md) | 不经 shell 运行宿主原生命令 |
