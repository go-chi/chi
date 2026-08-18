# AGENTS.md — Agent Notes

Agent Notes are effectively RFCs written by agents: durable proposals and decision records that preserve rationale, alternatives, consequences, and required verification. Follow the [documentation standard](../../docs/AGENTS.md) and the [Agent Note rules](README.md).

**Every new Agent Note triggers a supersession check.** Search the active tree for older notes covering the same decision or mechanism, classify any full or partial supersession with [`dsh-archive-agent-notes`](../skills/dsh-archive-agent-notes/SKILL.md), and archive every qualifying implemented triplet in the same PR. Keep partial supersessions active and cross-linked.

Files under [`archived/`](archived/AGENTS.md) are frozen historical snapshots: never edit them or treat them as current authority.
