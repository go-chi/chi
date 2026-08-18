# Agent Note: 安装器把已有检出接管进受管布局

Status: implemented
Archived: 2026-08-10

[English](2026-07-31-installer-adopts-existing-checkout.md) | 中文

## Problem

`scripts/install.sh`会产生两种互不兼容的安装布局。`curl … | sh`安装会构建受管布局——`~/.dsh/source/master`处的 master 克隆、位于`dsh-staging/<时间戳>`分支上的 staging worktree，以及 PATH 启动器据以解析的稳定`current`符号链接。而从检出中运行同一脚本时，则依据此前的[检出内跳过克隆决策](../../archived/process/2026-07-22-installer-in-repo-skip-clone.md)，把`dsh`直接链接到该检出的`bin/dsh`。

这种直接链接无法升级。升级重指的正是`current`，因此缺少它的安装无法通过[`dsh-upgrade`](../../../../skills/dsh-upgrade/SKILL.md)升级；检出一旦移动，PATH 符号链接就会失效；而且启动器会解析到贡献者恰好检出的任意分支，这正是升级约定禁止作为启动器目标的情形。升级技能早已把这种布局描述为需要一次性迁移的旧式安装，因此两种布局从安装时起便不相同，只有以后执行迁移才会一致，而迁移也可能永远不执行。

## Decision

检出内模式仍然绝不克隆、绝不修改工作树，但现在它会无条件地把该检出**接管**进受管布局。不存在退出选项：一套布局服务于所有安装。

容器拥有 staging worktree 和`current`；仓库是被*发现*的，而非被拥有的。`git rev-parse --git-common-dir`会解析出该检出背后的共享 git 目录——对于 linked worktree，那是真正的克隆而非 worktree 自身——其父目录即是充当升级基础的仓库。随后以该检出的`HEAD`为起点，在`$DSH_SOURCE`下创建 staging worktree，并让`current`指向它。因此，磁盘上任意位置的克隆都会收敛到与`curl`安装相同的布局，且两条路径共用同一套 worktree/exclude/lock/link 流程：二者的唯一差别，只在于仓库是由`git clone`发现的，还是由`git rev-parse`发现的。

安装器不会记录该仓库位于何处。仓库位于容器之外时，容器就不是自包含的——每个 staging worktree 都持有指向该克隆的绝对 gitdir 指针，删除该克隆就会破坏它们——但这一事实本就由 git 自己掌握：worktree 的`.git`文件写明了该路径，而在该克隆中执行`git worktree list`会列出依赖于它的每一个 worktree。

接管以`HEAD`为分支起点，因此运行的是已提交的内容，未提交的更改仍留在检出中。这一点既不提示也不警告：安装器构建好布局后便不再打扰。把`DSH_SOURCE`设为其他目录，仍是唯一有文档记载的、回到克隆另一棵树的方式。

所有路径比较都通过`resolve_dir`辅助函数在物理路径上进行，且每个参与比较的值都在赋值时解析，而非在比较时解析。git 报告的始终是已解析的路径，因此只要检出之上任意一层存在符号链接，拿它与未解析的路径相比较就会不相等——家目录本身是符号链接即已足够，而 macOS 通过`/var` -> `private/var`使每个`mktemp`路径都如此。这种不匹配会把已有的受管安装误判为外来克隆，并在真正的容器旁再建一个容器。只要比较的一侧未经解析，同类缺陷就会重现——curl 安装的`REPO_ROOT`以及与之比较的容器路径都曾如此。因此`resolve_dir`在路径不存在时原样回显该路径而非失败，这样尚未创建的容器无需在每个调用点单独兜底，也就没有调用点会因遗漏兜底而与空路径比较；需要判断"不存在"的调用方则显式检测该目录。`git rev-parse --path-format=absolute`能完成同样的工作，但要求 git 2.31 及以上版本。

在重指`current`之前，安装器会拒绝解析结果等于仓库自身的 staging 路径，以此落实"启动器绝不解析到 master 克隆"这一升级约定。

## Alternatives considered

**把`~/.dsh/source/master`做成指向该任意克隆的符号链接。** 已否决。Git 会解析该符号链接并记录*真实*路径：经由它创建的 worktree 会存储`gitdir: …/<克隆>/.git/worktrees/<名称>`，而`git worktree list`报告的是该克隆。因此这个符号链接纯属装饰——没有任何代码读取它——却又暗示容器拥有该仓库。它还会静默失效：移动克隆后，`master`看似仍在却已悬空，而每个 staging worktree 都会以`fatal: not a git repository`失败。最糟的是，它把两个名称别名到同一棵树上，于是"current 绝不能是 master 克隆"这项检查会在字符串比较下通过，实则为假。`~/.dsh/source/master`是位置而非名称，且只有位置具有权威性。

**把检出自身提升为`current`的目标。** 已否决：升级约定要求`current`指向 staging 分支上的干净 staging worktree，绝不能指向 feature、review 或 detached 检出。这还会使每次升级都改写贡献者正在编辑的那棵树。

**把就地链接保留在提示或`DSH_ADOPT`开关之后。** 已否决；本次变更的早期修订版本正是如此实现，之后被移除。第二种布局本身就是缺陷，因此把它保留为一个选项等于保留了问题，并使此后每次改动必须处理的状态翻倍——提示、开关、工作树不干净的警告，以及第二条链接路径，全都只为维持一种本不该产生的布局而存在。就地链接最初的动机——让脚本能针对本地源码进行测试——在接管方案下依然成立：以检出的`HEAD`为起点创建的 staging worktree 运行的是同一份代码。`DSH_SOURCE`仍可用于安装另一棵树。

**在工作树不干净时发出警告或提示。** 已否决：以`HEAD`为起点的`worktree add`本就无法带上未提交的内容，因此该行为是确定的，提示只会增加一个用户无法做出不同选择的决策点。改为在文档中说明该约定。

**把被接管克隆的 staging worktree 放在该克隆旁边**（`~/src/staging-*`），而非放进`~/.dsh/source`。已否决：`current`和 PATH 启动器都是每用户唯一的，因此把 worktree 散落到各个克隆的父目录中，会重新引入 source 容器本就为之而设、意在杜绝的同级克隆蔓延问题。

## Consequences

现在一套布局服务于所有安装，因此被接管的克隆无需该技能所述的一次性迁移，即可由`dsh-upgrade`升级，而且安装器不再有任何一条分支会产生无法升级的布局。检出内运行仍然绝不改动工作树。

代价是：贡献者不能再把 PATH 指向某个检出、并让`dsh`随其切换分支而跟随该工作树；启动器现在解析到的是一个固定在安装时所接管`HEAD`上的 staging worktree。重新运行安装器会再次接管当前的`HEAD`。

此外，接管外部克隆的容器不再自包含：删除该克隆会破坏其 staging worktree。这是复用已有克隆的固有属性，而非本设计带来的性质——被否决的符号链接方案只是掩盖它，而非修复它——诊断依据则是 git 自身的 worktree 记录。

## Testing

`scripts/install.sh` 现有一套位于 `apps/cli/tests/install-script.spec.ts` 的真实 shell PTY 回归测试，使用 stub 依赖覆盖接管路径和 curl 风格路径。curl 风格安装默认使用公开的 `deepseek-ai/deepseek-harness-sdk` 源，而以 pnpm/npx 替换安装器仍是另一项工作。

验证是手工完成的，通过一个一次性测试装置以打桩的`pnpm`驱动真实脚本：接管独立克隆；从 linked worktree 接管进其已有容器；显式`DSH_SOURCE`仍回到克隆路径；工作树不干净时静默接管、既不提示也不警告，且其未提交文件留在原处；非 git 检出失败并给出指引；以及`curl`式克隆安装断言所构建的布局——该检查能捕获未解析的`REPO_ROOT`。交互路径在 tmux 下从一个不干净的检出走通，确认整个过程不出现接管提示即可到达启动器，最终`dsh`从新的 staging worktree 运行，而原检出保持其分支不变、未提交文件仍在。
