# @deepseek-ai/dsh-cordis-host-runner

[English](README.md) | 中文

由模型挂载的动态包在 host 侧的那一半：定义注册表、host 半所用的 `node:vm` 沙箱与 fiber 生命周期、invoke handler 表，以及由某个浏览器页面执行的 run 往返。以 `ctx.dynamicCordisRunner` 提供。面向模型的工具在 [`@deepseek-ai/dsh-tool-cordis`](../tool-cordis/README.md) 中；浏览器半由 [`@deepseek-ai/dsh-cordis-client-runner`](../cordis-client-runner/README.md) 装载。

## 功能

分两个阶段：`define` 只做登记，一切带副作用的动作都挂在一次 run 上。

- `define`／`undefine` 掌管一个定义的生命周期。`define` 对元数据做首尾去空白与必填校验，通过编译预检每一半的语法（不执行任何代码），铸出 `dyn-<n>`，并把该定义登记在发起调用的会话名下——它没有任何可回滚的副作用，所以无法解析的代码在拿到 id 之前就被拒绝。`undefine` 先停掉正在运行的定义，再把它忘掉。两者都不上 wire：只有模型自己的工具调用才会 define。
- `run` 回答模型「运行某个定义」的请求，它的两种形态取决于这个包是谁的事。只有 host 半的包是本进程自己的事：host 半在 `cordis-dynamic` group fiber 之下于 vm 中求值，调用随即返回。带浏览器半的包必须由一个页面来执行，于是 `run` 变成一次可作答的往返——它 emit `cordis/request-run`、挂起，并由某个人允许或拒绝来结束。这里没有定时器；调用方的 `AbortSignal`（提问的那一轮次被取消）是唯一的另一条出路，而且它会把这次取消播报出去，让其他页面不再提供作答入口。请求发出时**并不知道**会不会有人作答——收到它的页面也可能永远不答，所以没有页面连接的部署与其他未作答请求一样挂起，最终以 `cancelled` 收场。`run` 没有 wire 面——`cordis_run` 在进程内调用它。
- `runHostHalf`／`getClientCode` 是获得允许的页面依次走的步骤，host 半在先，因此 host 半失败会在浏览器还没动作之前短路。`runHostHalf` 在约定上是幂等的：已在运行的包只做绑定，不再求值；针对同一个定义的并发调用只求值一次，`startedHere` 指出求值的是哪一个调用方。随后 `getClientCode` 把浏览器半的源码交给这一个页面；定义已消失、没有浏览器半、或未在运行时，它会拒绝。代码从不搭乘任何播报，所以这是它到达浏览器的唯一途径。
- `resolveRequestRun` 用作答页面的结论结束这次往返，并 emit `cordis/request-run-resolved`，让其他每个页面撤下待作答的入口。首答即成；更晚的或未知的 request id 会被接受并忽略。命名了注册表已越过的版本的成功结论会被拒绝而非应用（`accepted: false`，请求仍处于挂起），因为作答的那个页面装载的是一个已不再存活的下发。失败的结论只会在 host 半正是由这次请求求值时才将它回退，因此某个页面装不上自己那一半，绝不会把其他页面正在使用的包停掉。
- `stop` 回退一次存活的下发——丢弃 handler、把 host 半 fiber dispose（资源释放）到完全停稳、emit `dynamicCordisRunner/retract`——并让该定义仍然可运行。
- `inventory` 回答整个注册表，不按会话寻址，且每一行都指明拥有该定义的会话，因为运行控制面是全局的。能列出不等于能操作：每个有实际动作的动词仍会检查这份归属。每一行还会指明该定义有没有浏览器半，因此运行控制面只在确有可装载的半时，才提供「装入当前页面」。`snapshot` 是它按会话限定的 host 本地对侧，携带每个存活 host 半的 fiber，供 `cordis_inspect` 自行渲染 provides／waiting／state（fiber 无法跨 wire）。
- `reportRenderFailure` 记录某个页面看到一个**已装载**的浏览器半在渲染时做错了什么。渲染严格发生在装载成功之后，因此到那时 run 早已回答了 `ok`：这份上报是 fire-and-forget 的，不带任何结算权威，也绝不触碰 `resolveRequestRun` 或 run 结论的任何部分——**它不是那个已退役的 v2 `report`／ack**。host 按定义保留跨所有页面的最后一次失败（第二个页面上报即覆盖），而一次全新的 run、一次 stop 或一次 undefine 都会清掉它，因此模型绝不会看到一次已不存在的下发留下的失败。浏览器半的契约面自己保留一份「**这个页面**当前正在显示什么」；两者回答的是不同的问题，不是同一个问题的两份答案。上报的会话若并不拥有该定义，这次上报会被丢弃，因为上报路径绝不能让一次渲染失败。
- `invoke` 把一个包的浏览器半发起的一次调用，路由到它自己的 host 半用 `harness.handle` 注册的方法。这套基础设施只做路由：不存在 host 到浏览器的方向。

`run` 或 `stop` 的拒绝会给出 `definition-missing`、`host-half-failed`、`client-half-failed`、`rejected`、`cancelled`、`not-running` 之一；后三者是答复而非缺陷——有人拒绝了、提问的那一轮次已结束，或本来就没有在运行的东西可停。

别的会话登记的定义读起来是不存在，而不是被禁止，因此不会跨会话泄漏任何东西。`invoke` 与 `resolveRequestRun` 完全不携带会话：组件的一次调用和页面的一次作答都是页面全局的事实，不属于某一个会话。

本功能拥有四条转发事件，由本包在其 client-safe 的 [`./types`](src/types.ts) 子路径上声明，并由 [`@deepseek-ai/dsh-api-remotes`](../../api/remotes/README.md) 的白名单准许投递——正是这一点让浏览器能经 `ctx.remote.$on` 收到它们：`cordis/request-run`（`{requestId, agentId, id, name, purpose}`——只有元数据，绝无代码）、`cordis/request-run-resolved`（`{requestId, outcome}`）、`dynamicCordisRunner/package`（`{id, name, rev}`），以及 `dynamicCordisRunner/retract`（`{id, rev}`）。后两者是对称的一对运行状态播报：每次全新启动与每次停止都播，与该包有没有浏览器半无关。

## 存储立场

注册表就是进程内存，也是唯一真源。会话日志只承载一次 define 调用的元数据，绝不承载它的代码：因此进程重启后确实没有任何定义，这是合理的；而 id 已无法解析的卡片会如实说明这一点，不会假装自己还能运行。本包不向磁盘写任何东西，也不会自动恢复任何定义；刷新过的页面手上什么都没有，直到有人再次运行某个包——正是这一步让它绑定存活的 host 半并重新取回浏览器半。

## 信任立场

vm 沙箱隔离全局变量，但不是安全边界：Node 全局变量不存在，或重定向到 Cordis 服务（`ctx.fs`、`ctx.web`、`ctx.bash` 以及定时器 helper），host 半收到的是不含框架内部机制的 façade，但它声明的服务仍会触达存活运行时。应当像对待 bash 访问一样对待动态包，参见[自引用工具集 Agent Note](../../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md)。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `vmTimeoutMs` | `5000` | host 半在 vm 中同步执行的那部分被中止求值前可运行的毫秒数 |

就这一个字段：一次 run 请求等的是人，所以这趟往返本身没有任何截止期限。

## 导出形状

服务包：默认导出 `DynamicCordisRunnerService`（服务键 `dynamicCordisRunner`），`./types` 则承载 `dynamicCordisRunner` remote namespace 与其消费方共享的载荷形状。`define`／`undefine` 的形状留在包内部，因为它们从不跨 wire。

## 模型体验

### 经 cordis 工具转达的拒绝与教学式错误

#### 模型看到的内容

没有直接可见的内容：本包不注册任何工具，也不注入提示词。它的拒绝经调用它的 `cordis_*` 工具结果到达模型——无法解析的半会指出出错的那一行，缺失的定义会解释定义只活在内存里，`rejected` 或 `cancelled` 的 run 报告的是有人拒绝或该轮次已结束而非出了故障，浏览器半装载失败则带上作答页面自己的错误文本。

#### Token 影响

本包自身没有：上述每条消息都由调用它的那个工具的结果承载。

#### KV Cache 影响

注册工具的 host 半会改变下一次请求的工具视图，从第一个变化的 schema token 起使前缀复用失效；运行或停止一个不注册任何工具的包对前缀不产生影响。

## 已知限制与暂缓事项

- **run 成功不等于 UI 渲染成功。** 只要作答页面**已装载**浏览器半，`run` 就会返回；React 是随后才渲染的，因此一个抛异常的组件根本不可能出现在 run 的回执里。该失败经 `reportRenderFailure` 浮现，并通过 `cordis_inspect what:"temporary"` 读回；run 的结果会把这一点说出来，而不是暗示成功。

- 带浏览器半的包在**没有页面连接的地方会挂起**——headless 与 ACP（Agent Client Protocol）部署会把这次 run 一直挂到提问的轮次被取消，因为转发事件不回报谁收到了它。只有 host 半的包不受影响。
- 挂起的 run 请求**没有超时**：它一直等人，直到提问的那一轮次被取消，因此无人值守的自动化用不了带浏览器半的包。
- `vmTimeoutMs` 只约束同步求值；async 的 host 半函数体会逃出该上限，这与该工具集基于协作的信任立场一致。
- `runHostHalf` 不携带 request id，因此「这个 host 半是哪次请求求值的」由 host 侧归因到该定义最近一次挂起的请求；若同一个定义出现多个并发 run 请求，这条规则需要重新审议。
- 命名了已被取代版本的成功结论会被拒绝（`accepted: false`）并让该请求继续挂起，因此模型这次调用只能靠一次有效作答或自身被取消才结束。要把它结算掉，需要对着存活版本重新走一遍编排，而当前没有任何页面会这么做——[浏览器半](../cordis-client-runner/README.md)不读这个 ack——所以这类请求实际上由别的页面作答、或由调用方取消来收尾。
- 浏览器半声明的 `inject` 是从它在页面里返回的插件上读出的，因此播报完全不携带服务声明字段。
- **`zod` 是生成的 TypeRT 契约面的运行时依赖，不是 `src` 的依赖。** `./typert` 与 `./remote` 解析到 `lib/typert.*.js`，`tsc` 以不打包的形式产出它们，其中带有裸的 `import { z } from 'zod'`，所以本包必须声明它（沿用 `@deepseek-ai/dsh-goal` 的先例），而 `knip.json` 必须在这个 workspace 里忽略它：knip 读的是源码，而这些契约面是构建产物。`src` 里没有任何代码 import zod。
