# Agent Note: 在检出目录内运行时安装脚本跳过克隆

Status: implemented
Archived: 2026-07-26

[English](2026-07-22-installer-in-repo-skip-clone.md) | 中文

## 问题

`scripts/install.sh`是为`curl ... | sh`路径编写的：它把 harness 克隆到`~/.dsh/source`，然后安装、软链接并启动。已经有检出的贡献者若直接运行同一脚本（`sh scripts/install.sh`），会在`~/.dsh/source`得到第二份无关的克隆——安装并软链接的是与他们正在工作的树不同的另一棵树，且无从用本地脚本验证本地源码。

## 决策

脚本会检测自身是否在真实检出内执行；在该模式下，它复用该检出并完全跳过克隆/更新步骤，保持工作树不受影响。

检测依据是`$0`：在`curl ... | sh`下脚本文本经由 stdin 到达，因此`$0`是 shell 名称、无路径可解析；运行已检出的副本会使`$0`成为脚本文件本身。当`$0`是一个可读文件、其父目录是一个`scripts/`目录、且该树同时带有`bin/dsh`启动器和`scripts/install.sh`时，脚本会设置`IN_REPO=1`并把`DSH_SOURCE`重新指向该仓库根。步骤 2 随后打印一行"using existing checkout"并不做其他事——不执行`git fetch`、不执行`git checkout -B`，因此用户的工作树和分支绝不会被改动。`DSH_REF`在该模式下仅供参考、被忽略。

显式的`DSH_SOURCE`优先于检测：该值在默认化之前就被捕获，检测只会重新指向未设置的`DSH_SOURCE`（或已经等于检测到的仓库根的那个）。把`DSH_SOURCE`设为其他目录会重新回到正常的克隆/更新路径，因此在检出目录内安装另一棵独立树的退路依然存在。

## 备选方案

**通过对当前目录执行`git rev-parse --show-toplevel`来检测。** 已否决：`curl ... | sh`常常在某个无关的 git 仓库（用户的`cwd`）内运行，这会误判并对一棵并非 dsh 的树跳过克隆。把决策锚定在`$0`自身的位置，使其绑定到脚本实际所在之处，而`bin/dsh` + `scripts/install.sh`标记则确认它确实是一个 dsh 检出。

**只要从文件运行就总是跳过克隆，忽略`DSH_SOURCE`。** 已否决：贡献者可能合理地运行检出内脚本来配置一份独立的`~/.dsh/source`安装；尊重与检出不同的显式`DSH_SOURCE`保留了该路径。

## 影响

现在从检出目录运行`sh scripts/install.sh`会安装、软链接并启动该检出，而不是克隆一份平行副本，这也让本地脚本可以针对本地源码进行测试。代价是一段与仓库布局耦合的检测逻辑（`scripts/`与`bin/dsh`并列）；若启动器或脚本将来移动，标记必须随之移动。该行为记录在脚本头部和两份 README 中，并通过运行四条路径来验证（检出内跳过、curl 式克隆、显式`DSH_SOURCE`指向他处而回到克隆、显式`DSH_SOURCE`等于仓库根仍跳过）。
