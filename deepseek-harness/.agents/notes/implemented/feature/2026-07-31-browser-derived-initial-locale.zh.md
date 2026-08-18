# Agent Note: 全新浏览器打开的设置语言由浏览器决定

Status: implemented

[English](2026-07-31-browser-derived-initial-locale.md) | 中文

## Problem

设置里的语言行在每一次首访时都以中文开场：`LocaleRuntime` 从 localStorage 读取 `dsh.locale`，读不到就直接回落到 `zh`。浏览器本已声明其使用者阅读哪些语言——`navigator.languages` 就是这份声明——而应用对此视而不见，于是英文读者迎面撞上一个中文产品，还得先找到一行中文标签的设置项才能脱身。回落值当时同时承担两份职责：既是无法解析出 locale 时的最后兜底，也是所有从未做过选择的用户拿到的答案。

## Decision

**暂定 locale 先经浏览器、再经 `FALLBACK_LOCALE` 解析；显式 Host 偏好会实时替换它。** `packages/client/locale/src/client/index.ts` 中的 `resolveInitialLocale()` 在服务构造时运行，并表达浏览器／回落顺序。随后，非阻塞 settings 生命周期会应用 `$DSH_HOME/settings.yaml` 中可选的 `locale.preference`；若该值缺失，则继续使用由浏览器派生的值。

**浏览器匹配按主子标签进行，且遍历有序列表。** `detectBrowserLocale()` 遍历 `[...(navigator.languages ?? []), navigator.language]`，返回主子标签命中已提供 locale 的首个条目，因此 `zh-Hans-CN` 与 `zh-TW` 同归 `zh`、`en-GB` 归 `en`；而只请求本应用不提供的语言（`fr`、`de`）的浏览器则什么都匹配不到，交由 `FALLBACK_LOCALE` 接管。`navigator.language` 排在列表之后，并兜住那些 Navigator 上没有 `languages` 的宿主——DOM 库把它标注为必然存在，所以这份容忍带一条窄口径 lint 例外，与 `localStorage` 守卫表达的环境边界不信任同源。

**判定浏览器用的是 `window` 而非 `navigator`。** Node ≥ 21 暴露全局 `navigator` 并报告机器自身语言（CI runner 上是 `en-US`），因此以 `navigator` 把关会让 node 启动客户端树时解析成 `en`，而非文档约定的回落值。以 `window` 把关可使所有非浏览器运行都停留在 `FALLBACK_LOCALE`。

**显式选择具有持久性。** `setLocale` 通过 Host settings API 写入，因此选过语言的用户可在共享同一 DSH home 的不同浏览器 origin 与系统语言之间保留原选择。没有任何代码把探测到的 locale 写回：探测在每次启动时重新推导，对「用户是否做过选择」这一问题始终不可见。

**浏览器 e2e 车道固定浏览器语言。** 断言中文文案的场景（`access-confirmation`、`models-settings`、`onboarding-deepseek-config`、`settings-chrome`）以 `apps/web/tests/support.ts` 的 `locale: ZH_BROWSER_LOCALE` 打开页面；`newEnglishPage` 声明 `en-US`。`settings-chrome.e2e.ts` 使用没有显式 locale 的全新 Host home，断言其英文浏览器会生成英文 settings 界面：这是本功能在组装后应用中的证据。

## Alternatives considered

- **`Intl.DateTimeFormat().resolvedOptions().locale` 或单读 `navigator.language`**：两者都把用户的有序偏好列表塌缩成一个标签，于是 `['de', 'en', 'zh']` 的读者拿到的是 zh 而非 en。列表恰恰是浏览器这份声明里最值得读的部分。
- **首次启动即持久化探测结果**：那会把探测变成一次性事件，让一次陈旧的首访凌驾于此后改变的浏览器语言之上，也摧毁了整个解析顺序所依赖的区分——存储值将不再意味着「用户选了它」。
- **完整的 BCP 47 协商（`Intl.LocaleMatcher` 式查找、地区与文字权重）**：在只提供两个语言互异的 locale 时，主子标签匹配就是正确答案的全部；协商层只会带来无行为支撑、也无从测试的表面积。
- **为默认 locale 增加一个 Cordis 配置键**：此处部署之间并无差异——回落值是产品对「完全没有信号」给出的答案，不是旋钮。仓库策略把 `Config` 字段留给有当前消费方、且随部署变化的选择。
- **让 e2e 车道的中文场景继续钉存储项（`dsh.locale=zh`）**：那会让套件保持绿色，却抹掉浏览器推导路径在组装后应用中唯一的运行处；改钉浏览器语言才能端到端地演练新的解析过程。

## Consequences

- 来自英文浏览器的首访落在英文界面，而语言行依然呈现同样两个以自身语言自述的选项，两个方向的脱身通道都未改变。
- `FALLBACK_LOCALE` 收窄回它真正的职责——字典回落与无信号时的答案——不再兼职充当「用户尚未选择」。
- 在 jsdom 下构造 `LocaleRuntime` 的测试现在依赖环境的 `navigator`：断言本地化文案的用例以一行套件级 `usePinnedBrowserLanguages('zh-CN')`（dsh-client-test-runtime）声明其浏览器，今后任何断言默认值的用例同样如此。本包自己的用例直接给全局打桩，因为它们需要该 helper 刻意不表达的形状（`languages` 缺失、列表与 `language` 解耦、完全没有 `window`）。
- 探测的代价是每次服务构造遍历一次数组，且不会隐式写入 settings；插件激活后，显式 Host 偏好可能引发一次实时收敛。
