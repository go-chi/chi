# Translation rules

English | [中文](translation-rules.zh.md)

How to translate between the two sides of a documentation pair in this repo. Both languages carry equal authority ([README.md](README.md)): a change is authored in either language, and that side is the source for that update — these rules govern producing or updating the counterpart. They bind humans and agents equally. Routine agent work translates the changed content directly in one terminology-guided pass; the extended [.agents/skills/dsh-translate-docs](../../.agents/skills/dsh-translate-docs/SKILL.md) workflow runs only when the user explicitly invokes it. Rule levels follow RFC 2119 usage: **MUST** / **MUST NOT** are gate- or review-blocking; **SHOULD** needs a stated reason to deviate; **MAY** is discretionary.

## Faithfulness

- The counterpart *MUST* say what the authored side says — no added behavior, prerequisites, warnings, version claims, or examples, and no dropped ones. If the pair disagrees on substance, neither language wins by default: fix the side that is wrong, then bring the other along in the same change.
- The counterpart *SHOULD* read as natural technical writing in its own language, not word-by-word gloss. Translate meaning, restructure sentences where the target grammar wants it, and keep the author's register — terse stays terse.
- Do not translate the untranslatable: if a sentence resists natural rendering because it leans on an idiom of the source language, translate the idea, not the idiom.

## Voice

- The register is calibrated by [style-samples.md](style-samples.md) — human-approved gold pairs, one per document genre. The counterpart MUST match the target-language side of the nearest sample; where its voice and a prose voice rule disagree, the sample wins. Chinese targets use institutional technical Chinese; English targets use concise professional developer prose.
- Write as a native technical author restating the content, not as a translator transposing sentences, while preserving every source clause: nothing added, nothing dropped — fluency never justifies losing a clause.
- Give sentences an explicit actor when the target language would otherwise obscure it; for Chinese, replace vague passives or abstract subjects with the actual actor (系统、门禁、评审人).
- Prefer established target-language engineering idiom over calques (误报／漏检 for false positive/negative, 执行红线 for enforcement frontier); localize metaphors instead of transplanting them, and unpack noun chains where the target language requires it.
- Split long paragraphs by semantic unit — one idea per paragraph. Paragraph boundaries MAY differ from the source; the structural signature does not count paragraphs.
- When translating into Chinese, category nouns use Chinese with a first-mention English annotation (实操手册（cookbook）); when translating into English, use the conventional English category name. Literal directory or file references stay code-formatted English.

## Structure preservation

The pairing gate checks heading depths, fenced code blocks, table row and column counts, list kinds, ordered-list starts, list item counts, and link targets. Preserve the rest of the frame manually; the paired files MUST match one to one in:

- heading hierarchy (same levels, same order — heading TEXT is translated),
- list shape and numbering,
- tables (same columns, same row order; header cells translated per terminology),
- fenced code blocks — **byte-identical, including comments**; the pairing signature compares their info strings and contents, and ` ```ts ` blocks compile under `doc-typecheck`,
- inline code spans (commands, flags, config keys, file paths, event names, API names, version numbers) — verbatim, never translated or reformatted,
- links and anchors: every relative link MUST point at the same target in both files — by convention the `.md` path, not the `.zh.md` sibling — so links never dangle when one pair lands before its neighbors. The ONLY zh-specific link is the language switcher. A README rendered outside GitHub MAY use the canonical public repository URL to its exact counterpart as documented in [README.md](README.md). Link TEXT is translated; the target is not.

The repo's Markdown conventions apply to `.zh.md` files unchanged: one physical line per paragraph (`verify-md-wrap`), resolving relative links (`verify-md-links`), exactly one trailing newline.

## Terminology

- [terminology.md](terminology.md) is the source of truth in both directions. Before translating, load it; every listed term MUST follow its row and its "不要译作" prohibitions. A Chinese target uses the "中文" column and its "首次出现" annotation; an English target uses the "English" column without adding a Chinese gloss.
- For a Chinese target, an unlisted technical term MAY use an established rendering from a major Chinese-language OSS or vendor source (K8s/Vue/MDN Chinese docs, 微软简中风格指南, big-tech project docs), cited in the PR. Without such precedent it MUST stay in English and be listed under 「待定术语」(pending terms) with a suggested rendering.
- For an English target, use the established English technical term. If the source term has no unambiguous established equivalent, preserve it with a short explanatory gloss and list it under pending terms. Neither direction may invent a rendering inline; a decided term enters [terminology.md](terminology.md) in the same PR or a follow-up.

## Typography

These rules govern the Chinese side; the English side follows the repo's normal Markdown conventions (root `AGENTS.md`). The mixed-script rules below follow the cross-project consensus of the [MDN Simplified Chinese translation guide](https://github.com/mdn/translated-content/blob/main/docs/zh-cn/translation-guide.md), the [Kubernetes zh-cn localization guide](https://kubernetes.io/zh-cn/docs/contribute/localization_zh/), the [Vue.js Chinese translation conventions](https://github.com/vuejs-translations/docs-zh-cn/wiki/%E7%BF%BB%E8%AF%91%E9%A1%BB%E7%9F%A5), and [中文文案排版指北](https://github.com/sparanoid/chinese-copywriting-guidelines), which in turn ground in [W3C clreq](https://www.w3.org/TR/clreq/) and GB/T 15834—2011:

- MUST put one half-width space between Chinese text and Latin words, and between Chinese text and numerals: `每个 plugin 注册 3 个 tool`。No space between a full-width punctuation mark and anything.
- MUST use full-width (Chinese) punctuation in Chinese prose: `，。：；？！（）「」`. Half-width punctuation stays inside code spans, inside complete English sentences quoted as-is, and in numbers (`3.5`, `1,024`).
- Chinese prose *SHOULD* prefer colons, periods, commas, or parentheses over em dashes. Keep an em dash only when no other punctuation preserves the sentence naturally.
- Enumeration commas: a Chinese list of parallel items uses 顿号（、）, not commas.
- MUST NOT use full-width digits or full-width Latin letters — `１２３` never, `123` always.
- Proper nouns keep their canonical casing: GitHub, TypeScript, DeepSeek — never `github`/`Github` unless quoting code.
- Second person is 你, not 您 (matches the Vue and Kubernetes Chinese conventions and this repo's direct voice).
- Emphasis markers (`**bold**`, `*italic*`) stay on the same spans as the source; Chinese has no italics, so the rendered emphasis may look identical — do not substitute quotation marks or other decoration.

## Quality bar

- A pair is done when a bilingual engineer reading either file alone gets everything a reader of the other gets — same facts, same caveats, same tone — and nothing extra.
- Run `pnpm run verify-translation-pairing` and the rest of `doc-sync` for records, switchers, heading depths, code blocks, table row and column counts, list kinds, ordered-list starts, list item counts, links, and repository Markdown rules. Human review owns list and table order, noncanonical list numbering, inline code, emphasis, meaning, terminology, and tone.

## References

Authorities cited by these rules, for humans and agents who want the underlying reasoning:

- [中文文案排版指北](https://github.com/sparanoid/chinese-copywriting-guidelines) — the de-facto community standard for mixed CJK/Latin spacing and punctuation.
- [MDN zh-CN translation guide](https://github.com/mdn/translated-content/blob/main/docs/zh-cn/translation-guide.md) — an in-repo translation-rules file of the same shape as this one; spacing, punctuation, and glossary practice.
- [Kubernetes zh-cn localization guide](https://kubernetes.io/zh-cn/docs/contribute/localization_zh/) — terminology-first-occurrence and punctuation practice from the largest zh localization team.
- [Vue.js docs-zh-cn 翻译须知](https://github.com/vuejs-translations/docs-zh-cn/wiki/%E7%BF%BB%E8%AF%91%E9%A1%BB%E7%9F%A5) — per-term translate/keep decisions and tone.
- [zh-style-guide](https://zh-style-guide.readthedocs.io) — a community Chinese technical-writing style guide whose rule-level taxonomy (and RFC 2119 keyword levels) this file borrows; aggregates GB/T 15834/15835, clreq, and vendor guides.
- [W3C clreq](https://www.w3.org/TR/clreq/) and the [Microsoft Simplified Chinese style guide](https://learn.microsoft.com/en-us/globalization/reference/microsoft-style-guides) — the formal typographic and vendor-localization baselines.
- GB/T 19682-2005《翻译服务译文质量要求》 — the national standard whose three base requirements (忠实原文、术语统一、行文通顺) this file's Faithfulness and Terminology sections operationalize.
