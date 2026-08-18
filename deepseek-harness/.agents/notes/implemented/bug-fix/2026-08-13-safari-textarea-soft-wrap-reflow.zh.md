# Agent Note: Safari textarea 软换行收缩恢复

Status: implemented

[English](2026-08-13-safari-textarea-soft-wrap-reflow.md) | 中文

## 问题

composer 把光标与选区留在透明的原生 textarea 中，由 backdrop 绘制可见字形，并由隐藏的镜像层决定完整草稿高度。因此，[单滚动容器决策](2026-07-31-composer-text-layers-share-one-scrollport.md)依赖 textarea 不持有可滚动溢出：每次草稿提交后，它的 `scrollHeight` 与 `clientHeight` 相等，`scrollTop` 为零。

当 Backspace 让草稿跨过软换行阈值，同时 React 更新镜像层时，Safari 26.5.2 可能保留 textarea 原先的原生行布局。在复现出的两行变一行转换中，镜像层、backdrop、自增高栈和 textarea 盒都变为 28px 高，但 textarea 仍报告 `scrollHeight=52` 与 `scrollTop=20`。光标留在陈旧的原生行中，而 backdrop 已正确绘制为一行。

`color` 声明不是布局输入。修改 inline style 会改变计算后的颜色，却让陈旧的 `52/28/20` 状态保持不变。编辑样式表规则会碰巧触发范围更广的规则失效，并把状态清为 `28/28/0`，这正是 Web Inspector 让该声明显得像成因的原因。

## 决策

`InputBar` 通过 Apple vendor 与 `Version/... Safari/...` 形式的 user agent 一次性识别 Safari，同时排除 `CriOS`、`FxiOS`、`EdgiOS`、`OPiOS` 等已知的 iOS 其他浏览器 token。仅凭这些 identity 字段无法区分的浏览器壳仍必须先违反 textarea 溢出不变量，恢复逻辑才会修改布局。

原生 textarea change handler 会记录本次编辑是否缩短受控草稿。草稿提交后，除非同时存在已缓存的 Safari identity 与原生缩短信号，否则 layout effect 会在读取几何前直接返回。随后它才检查单滚动容器不变量：`scrollHeight` 与 `clientHeight` 相等即为稳定态，不会触发强制布局。出现差异时，逻辑先把 textarea 的实际高度改变一个像素，强制布局，再恢复其自有高度并再次强制布局。这样无需改变值、选区、输入法组合状态或撤销事务，即可重建 Safari 的原生文本控件布局。

即使 textarea 已正确恢复，临时的原生溢出仍可能让草稿滚动容器的 auto 高度停在原行数。因此，恢复逻辑会在修复 textarea 后，对 `[data-input-scroll]` 重复一次单像素失效。两个元素都会在绘制前恢复各自拥有的样式；稳定的一行状态为 `scrollHeight=clientHeight=28`、`scrollTop=0`，滚动容器高度为 28px。

## 验证

组件测试会合成 Safari 的陈旧度量，断言先 textarea 后滚动容器的失效顺序，保留选区，并证明原生草稿增长不会读取几何。浏览器 identity 测试覆盖桌面与移动 Safari、桌面 Chromium、iOS Chrome／Edge／Opera 和 Apple web view。

组装后的包还会在 Safari 26.5.2 中通过原生的 51 字符到 50 字符 Backspace 路径验证。Playwright WebKit 26.5 在组装应用与最小化页面中都无需本绕法即可正确稳定，因此仓库的 Chromium 浏览器泳道无法复现这个 Safari 应用缺陷；在可自动化的 Safari 泳道出现之前，由聚焦组件测试固定该引擎状态。

## 备选方案

**修改 `color` 或使用 `-webkit-text-fill-color`。** 被否决，因为 inline color 修改与透明 text fill 都不会改变陈旧的原生几何。编辑样式表规则之所以有效，只是因为其失效范围比该声明的绘制语义更广。

**设置 `scrollTop=0`。** 被否决，因为这只会移动陈旧的原生内容，不会重建其两行 `scrollHeight`；光标可能从错位变为被裁剪。

**重写 textarea 的值。** 清空再恢复值能够重建 Safari 文本控件，但会改动拥有输入法组合与选区的编辑状态。高度失效不会触碰值。

**使用 `field-sizing: content`。** 被否决，因为相同删除后 Safari 的两行固有高度仍会陈旧，并且 composer 仍需要镜像层充当光标标尺与 backdrop 的度量对端。

**只让 textarea 或滚动容器失效。** 被否决，因为只恢复 textarea 虽能清除 `52/28/20`，却可能把滚动容器留在 52px；只恢复滚动容器则不会改变 textarea 的原生溢出。这个有序二元操作是最小的完整恢复。

**每次 Safari 草稿提交后都检查几何。** 被否决，因为 React 改变镜像层后读取 `scrollHeight` 或 `clientHeight`，即使草稿健康增长也可能同步执行布局。原生缩短信号把不变量读取限制在可能产生已观测收缩缺陷的编辑中。

**在所有浏览器中运行恢复逻辑。** 被否决，因为 Chromium、Playwright WebKit 与 Firefox 无需强制布局即可维持该不变量。Safari identity 与已观测到的差异共同限定同步工作范围。

## 影响

非 Safari 浏览器、程序化草稿更新，以及不会缩短草稿的原生编辑都不会读取几何。Safari 的原生缩短会读取溢出不变量，并且仅在 textarea 违反不变量时承担四次强制布局。例外路径以绘制前的罕见局部工作换取光标对齐、原生编辑语义与单一滚动盒。尚未观测到仅由 resize 或侧栏宽度变化引发的同类陈旧状态，本恢复触发器也不覆盖它。浏览器测试缺口保持显式：真实 Safari 证据负责引擎缺陷，确定性的组件覆盖负责恢复逻辑与浏览器门控。
